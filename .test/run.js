/* PIXEL RALLY 8 冒烟测试:真实 THREE + DOM 桩件,驱动游戏主循环 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node run.js <game-dir>'); process.exit(1); }

/* ---------- DOM 桩件 ---------- */
const ctx2d = new Proxy({}, {
  get(t, k) { if (!(k in t)) t[k] = () => {}; return t[k]; },
  set(t, k, v) { t[k] = v; return true; },
});
function elStub(tag) {
  return {
    tag, style: {}, children: [], textContent: '', innerHTML: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { const has = this._s.has(c); const want = f === undefined ? !has : f; want ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, appendChild(c) { this.children.push(c); },
    getContext() { return ctx2d; },
    width: 0, height: 0, disabled: false, onclick: null,
  };
}
const ids = {};
const listeners = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  navigator: {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } },
  document: {
    getElementById(id) { return ids[id] || (ids[id] = elStub('div')); },
    createElement(tag) { return elStub(tag); },
    addEventListener() {},
  },
};
sandbox.window = {
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  innerWidth: 1280, innerHeight: 720,
};
sandbox.self = sandbox.window;

const ctx = vm.createContext(sandbox);
function runFile(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, ctx, { filename: rel });
}

/* ---------- 加载 ---------- */
runFile('lib/three.min.js');
if (!ctx.THREE) throw new Error('THREE not loaded');
// WebGL 无法在无头环境运行 → 桩掉渲染器,保留真实数学/场景图
ctx.THREE.WebGLRenderer = class {
  constructor() {}
  setPixelRatio() {} setSize() {} render() {}
  setAnimationLoop(fn) { this._loop = fn; }
};
for (const f of ['js/textures.js', 'js/audio.js', 'js/input.js', 'js/world.js', 'js/car.js', 'js/ui.js', 'js/game.js']) runFile(f);

// 触发 window load → Game.init()
(listeners.load || []).forEach((fn) => fn());
const Game = vm.runInContext('Game', ctx);
const Input = vm.runInContext('Input', ctx);
if (!Game || !Game.car) throw new Error('Game.init failed');

/* ---------- 驱动 ---------- */
let simT = 0;
Game.clock = { getDelta: () => { simT += 1 / 60; return 1 / 60; }, get elapsedTime() { return simT; } };

const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAIL: ' + msg); process.exitCode = 1; } };

assert(Game.state === 'title', 'initial state title');
Game.toGarage();
assert(Game.state === 'garage', 'state garage');
Game.save.up = { eng: 5, tank: 5, arm: 5, tir: 5 }; // 满配测试长距离
Game.startRun();
assert(Game.state === 'countdown', 'state countdown');

// 自动驾驶输入:沿公路行驶(PD 循迹)+ 躲避障碍,偶尔漂移
let frame = 0;
Input.getState = () => {
  const car = Game.car;
  let steer = 0;
  if (Game.state === 'playing' && Game.world.segs.length) {
    const loc = Game.world.locate(car.x, car.z, car.segIdx);
    let dh = loc.seg.heading - car.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // 目标横向位置:默认居中,前方有障碍则避让
    let targetLat = 0, danger = 0;
    const obs = Game.world.obstaclesNear(car.segIdx);
    for (const o of obs) {
      const dx = o.x - car.x, dz = o.z - car.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 32) {
        const s = loc.seg, sx = Math.cos(s.heading), sz = -Math.sin(s.heading);
        const oLat = (o.x - s.x) * sx + (o.z - s.z) * sz;
        if (Math.abs(oLat - loc.lat) < 3) { targetLat = oLat > 0 ? -3.2 : 3.2; danger = d; }
      }
    }
    steer = Math.max(-1, Math.min(1, dh * 2.5 + (targetLat - loc.lat) * 0.09));
    const braking = danger > 0 && danger < 20 && car.vf > 8;
    return {
      steer, throttle: braking ? 0.2 : 1, brake: braking ? 0.5 : 0,
      drift: frame % 900 > 860, cam: frame % 700 === 0, pause: false, confirm: false, any: false,
    };
  }
  return { steer: 0, throttle: 0, brake: 0, drift: false, cam: false, pause: false, confirm: false, any: false };
};

let restarts = 0, maxSeg = 0, maxSegs = 0, sawStation = false, sawBiomes = new Set();
let minFuel = 999, sawPickupWindow = false;
for (frame = 0; frame < 20000; frame++) {
  Game._frame();
  const car = Game.car;
  if (!isFinite(car.x) || !isFinite(car.z) || !isFinite(car.vf) || !isFinite(car.fuel)) {
    assert(false, 'NaN/Inf in car state at frame ' + frame);
    break;
  }
  maxSeg = Math.max(maxSeg, car.segIdx);
  maxSegs = Math.max(maxSegs, Game.world.segs.length);
  minFuel = Math.min(minFuel, car.fuel);
  sawBiomes.add(Game.world.biome);
  if (Game.world.segs.some((s) => s.station)) sawStation = true;
  if (Game.world.activePick.size > 0) sawPickupWindow = true;
  if (Game.state === 'over' && Game.overShown) { restarts++; Game.startRun(); }
  if (sawBiomes.size >= 3 && maxSeg > 600) break; // 三大生态覆盖
}

console.log('frames driven:', frame);
console.log('max segment reached:', maxSeg);
console.log('biomes seen:', [...sawBiomes].join(','));
console.log('stations generated:', sawStation);
console.log('pickups activated:', sawPickupWindow);
console.log('min fuel seen:', minFuel.toFixed(1));
console.log('restarts (game overs):', restarts);
console.log('final state:', Game.state);
console.log('car dist:', Math.floor(Game.car.dist), 'fuel:', Game.car.fuel.toFixed(1), 'durability:', Game.car.durability.toFixed(1));

assert(maxSeg > 200, 'car progressed along track (seg=' + maxSeg + ')');
assert(sawStation, 'gas stations generated');
assert(sawPickupWindow, 'pickups activated');
assert(minFuel < Game.car.fuelCap - 5, 'fuel consumed');
assert(maxSegs > maxSeg, 'segments generated ahead');

// 直接传送到城市生态,确定性验证生态切换
{
  const BIOME_LEN = vm.runInContext('BIOME_LEN', ctx);
  if (Game.state !== 'playing') { Game.startRun(); for (let i = 0; i < 300; i++) Game._frame(); }
  const w = Game.world;
  const cityIdx = BIOME_LEN * 2 + 30;
  w._genTo(cityIdx + 5);
  const cs = w.segs[cityIdx];
  Game.car.x = cs.x; Game.car.z = cs.z; Game.car.heading = cs.heading;
  Game.car.vf = 20; Game.car.vl = 0; Game.car.segIdx = cityIdx; Game.car.fuel = 50;
  for (let i = 0; i < 150; i++) Game._frame();
  assert(Game.world.biome === 'city', 'city biome active after teleport (got ' + Game.world.biome + ')');
  sawBiomes.add(Game.world.biome);
  console.log('biomes after teleport:', [...sawBiomes].join(','));
}
assert(sawBiomes.size >= 3, 'all 3 biomes seen: ' + [...sawBiomes]);

// 暂停/恢复
if (Game.state === 'playing') {
  Game.togglePause(); assert(Game.state === 'pause', 'pause');
  Game.togglePause(); assert(Game.state === 'playing', 'resume');
}
// 车库升级购买(作弊给钱,先降级)
Game.save.coins = 1000;
Game.save.up.eng = 0;
const lv0 = Game.save.up.eng;
Game.buyUpgrade('eng');
assert(Game.save.up.eng === lv0 + 1, 'buy upgrade');
Game.setPaint(3);

console.log(process.exitCode ? '*** SMOKE TEST FAILED ***' : '*** SMOKE TEST PASSED ***');
