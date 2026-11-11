/* ===== 主循环 / 状态机 / 相机 / 碰撞与规则 ===== */
'use strict';

const Game = {
  state: 'title',
  camMode: 0,
  RENDER_W: 426, RENDER_H: 240, // 低内部分辨率 → 像素化放大

  init() {
    // --- 渲染器 ---
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.RENDER_W, this.RENDER_H, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, this.RENDER_W / this.RENDER_H, 0.1, 600);
    this._fit();
    window.addEventListener('resize', () => this._fit());

    // --- 模块 ---
    Tex.init();
    Input.init();
    UI.init();
    this.world = new World(this.scene);
    this.car = new Car(this.scene);
    this.particles = new Particles(this.scene, 320);

    // --- 存档 ---
    this.save = { coins: 0, best: 0, paint: 0, up: { eng: 0, tank: 0, arm: 0, tir: 0 } };
    try {
      const s = JSON.parse(localStorage.getItem('pixelrally8'));
      if (s && s.up) this.save = Object.assign(this.save, s);
    } catch (e) { /* 隐私模式等 */ }

    this.runCoins = 0;
    this.camPos = new THREE.Vector3(0, 5, -10);
    this.camLook = new THREE.Vector3();
    this.shakeT = 0;
    this.alarmT = 0; this.refuelT = 0; this.dustT = 0;
    this.garageAngle = 0;
    this.clock = new THREE.Clock();
    this.fpsFrames = 0; this.fpsT = 0;

    // 首次交互初始化音频(浏览器手势要求)
    const gesture = () => { Audio8.init(); Audio8.resume(); if (Audio8._pendingTrack !== undefined) { Audio8.playTrack(Audio8._pendingTrack); Audio8._pendingTrack = undefined; } };
    window.addEventListener('pointerdown', gesture, { once: false });
    window.addEventListener('keydown', gesture, { once: false });

    // --- 界面事件 ---
    document.getElementById('screen-title').addEventListener('click', () => this.toGarage());
    document.getElementById('btn-start').addEventListener('click', () => this.startRun());
    document.getElementById('btn-resume').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-restart').addEventListener('click', () => { this.startRun(); });
    document.getElementById('btn-quit').addEventListener('click', () => this.toGarage());
    document.getElementById('btn-retry').addEventListener('click', () => this.startRun());
    document.getElementById('btn-garage').addEventListener('click', () => this.toGarage());
    document.getElementById('btn-music').addEventListener('click', () => {
      Audio8.setMusicOn(!Audio8.musicOn);
      document.getElementById('btn-music').textContent = '音乐 MUSIC: ' + (Audio8.musicOn ? 'ON' : 'OFF');
    });

    UI.el.titleBest.textContent = this.save.best > 0 ? '最佳纪录 BEST: ' + Math.floor(this.save.best) + ' m' : '';
    this.prepScene();
    UI.showScreen('title');
    // 测试钩子:?auto=garage|run 跳过标题直接进车库/开局
    try {
      const m = /[?&]auto=(\w+)/.exec(location.search);
      if (m && m[1] === 'garage') this.toGarage();
      else if (m && m[1] === 'run') { this.toGarage(); this.startRun(); }
    } catch (e) {}
    this.renderer.setAnimationLoop(() => this._frame());
  },

  _fit() {
    const W = window.innerWidth, H = window.innerHeight, ar = this.RENDER_W / this.RENDER_H;
    let w = W, h = W / ar;
    if (h > H) { h = H; w = H * ar; }
    const c = this.canvas.style;
    c.width = w + 'px'; c.height = h + 'px';
    c.left = (W - w) / 2 + 'px'; c.top = (H - h) / 2 + 'px';
  },

  /* ---------- 存档/车库 ---------- */
  persist() { try { localStorage.setItem('pixelrally8', JSON.stringify(this.save)); } catch (e) {} },
  setPaint(i) { this.save.paint = i; this.car.setPaint(PAINTS[i]); this.persist(); UI.renderGarage(this); },
  buyUpgrade(key) {
    const u = UPGRADES[key], lv = this.save.up[key], cost = u.base * (lv + 1);
    if (lv >= u.max || this.save.coins < cost) return;
    this.save.coins -= cost;
    this.save.up[key]++;
    this.persist();
    this.car.applyUpgrades(this.save.up);
    Audio8.sfxSell();
    UI.renderGarage(this);
  },

  /* ---------- 场景准备(车库/开局共用) ---------- */
  prepScene() {
    this.world.reset((Math.random() * 1e9) | 0);
    this.world.rebuildWindow(0);
    this.car.cargo = 0;
    this.car.applyUpgrades(this.save.up);
    this.car.setPaint(PAINTS[this.save.paint]);
    const s0 = this.world.segs[0];
    this.car.reset(s0.x, s0.z, s0.heading);
    this.car.segIdx = 0;
  },

  toGarage() {
    if (this.state === 'garage') return;
    Audio8.init(); Audio8.resume();
    Audio8.setEngine(0, 0, false); Audio8.setDrift(0); Audio8.setRumble(0);
    Audio8.playTrack(0);
    this.state = 'garage';
    this.prepScene();
    UI.showHUD(false);
    UI.showScreen('garage');
    UI.renderGarage(this);
    Audio8.duckMusic(0.5);
  },

  startRun() {
    Audio8.init(); Audio8.resume();
    this.prepScene();
    this.runCoins = 0;
    this.overShown = false;
    this.gasHint = null;
    this.state = 'countdown';
    this.countT = 3.6;
    this.countLast = '';
    UI.showScreen(null);
    UI.showHUD(true);
    UI.banner('— ' + BIOMES.desert.name + ' —');
    Audio8.playTrack(1);
  },

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'pause';
      UI.showScreen('pause');
      Audio8.duckMusic(0.12);
      Audio8.setEngine(0, 0, false); Audio8.setDrift(0); Audio8.setRumble(0);
    } else if (this.state === 'pause') {
      this.state = 'playing';
      UI.showScreen(null);
      Audio8.duckMusic(0.5);
    }
  },

  gameOver(cause) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.overT = 1.5;
    this.overCause = cause;
    this.distBonus = Math.floor(this.car.dist / 100);
    this.earnedCoins = this.runCoins + this.distBonus;
    this.save.coins += this.earnedCoins;
    if (this.car.dist > this.save.best) this.save.best = this.car.dist;
    this.persist();
    Audio8.setEngine(0, 0, false); Audio8.setDrift(0); Audio8.setRumble(0);
    if (cause === 'wreck') {
      Audio8.sfxExplode();
      this.shakeT = 1.0;
      this.particles.spawn(this.car.x, 1, this.car.z, { n: 60, color: 0xff7020, spread: 9, up: 9, life: 1.2 });
      this.particles.spawn(this.car.x, 1, this.car.z, { n: 30, color: 0xffe080, spread: 6, up: 7, life: 0.8 });
    } else {
      Audio8.sfxAlarm();
    }
    Audio8.stopMusic();
  },

  /* ---------- 主循环 ---------- */
  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    const input = Input.getState();

    // FPS
    this.fpsFrames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { UI.setFps(Math.round(this.fpsFrames / this.fpsT)); this.fpsFrames = 0; this.fpsT = 0; }
    UI.setPad(Input.padConnected);

    switch (this.state) {
      case 'title':
        if (input.confirm || input.any) this.toGarage();
        this._garageCam(dt);
        break;
      case 'garage':
        if (input.confirm) this.startRun();
        this._garageCam(dt);
        break;
      case 'countdown': {
        this.countT -= dt;
        const t = this.countT;
        const label = t > 2.6 ? '3' : t > 1.6 ? '2' : t > 0.6 ? '1' : 'GO!';
        if (label !== this.countLast) {
          this.countLast = label;
          UI.countdown(label);
          Audio8.sfxCount(label === 'GO!');
          if (label === 'GO!') { this.state = 'playing'; setTimeout(() => UI.countdown(null), 600); }
        }
        this._chaseCam(dt);
        Audio8.setEngine(0.12, 0, true);
        break;
      }
      case 'playing':
        if (input.pause) { this.togglePause(); break; }
        if (input.cam) this.camMode = (this.camMode + 1) % 3;
        this._updatePlaying(dt, input, time);
        break;
      case 'pause':
        if (input.pause) this.togglePause();
        break;
      case 'over':
        this.overT -= dt;
        if (this.overT <= 0 && !this.overShown) {
          this.overShown = true;
          UI.renderOver(this, this.overCause);
          UI.showScreen('over');
          UI.showHUD(false);
          Audio8.playTrack(0);
        }
        if (this.overShown && input.confirm) { this.overShown = false; this.startRun(); }
        this._chaseCam(dt);
        break;
    }

    this.world.update(dt, this.car.x, this.car.z, time);
    this.particles.update(dt);
    Input.endFrame();
    this.renderer.render(this.scene, this.camera);
  },

  _garageCam(dt) {
    this.garageAngle += dt * 0.4;
    const r = 9;
    this.camera.position.set(
      this.car.x + Math.sin(this.garageAngle) * r, 3.2,
      this.car.z + Math.cos(this.garageAngle) * r);
    this.camera.lookAt(this.car.x, 1, this.car.z);
    this.car.group.rotation.y += dt * 0.3;
  },

  _chaseCam(dt) {
    const car = this.car;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const zoom = Input.camZoom;
    let tx, ty, tz, lx, ly, lz, k;
    if (this.camMode === 2) { // 引擎盖视角
      tx = car.x + fx * 0.6; ty = 1.35; tz = car.z + fz * 0.6;
      lx = car.x + fx * 30; ly = 1.2; lz = car.z + fz * 30;
      k = 1 - Math.exp(-22 * dt);
    } else {
      const conf = this.camMode === 0 ? { d: 9.5, h: 4.2, la: 6 } : { d: 15, h: 8, la: 8 };
      const d = conf.d * zoom, h = conf.h * zoom;
      tx = car.x - fx * d; ty = h; tz = car.z - fz * d;
      lx = car.x + fx * conf.la; ly = 1.2; lz = car.z + fz * conf.la;
      k = 1 - Math.exp(-6 * dt);
    }
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    this.camLook.x += (lx - this.camLook.x) * k;
    this.camLook.y += (ly - this.camLook.y) * k;
    this.camLook.z += (lz - this.camLook.z) * k;
    // 震屏
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeT * 0.6;
      this.camPos.x += (Math.random() - 0.5) * s;
      this.camPos.y += (Math.random() - 0.5) * s;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  },

  _updatePlaying(dt, input, time) {
    const car = this.car, world = this.world;

    // 定位 / 越野 / 边界
    const loc = world.locate(car.x, car.z, car.segIdx);
    car.segIdx = loc.idx;
    const B = BIOMES[world.biome];
    const offroad = Math.abs(loc.lat) > ROAD_HALF + 0.4;
    if (Math.abs(loc.lat) > B.maxLat) {
      const seg = loc.seg;
      const sx = Math.cos(seg.heading), sz = -Math.sin(seg.heading);
      const excess = Math.abs(loc.lat) - B.maxLat, sign = Math.sign(loc.lat);
      car.x -= sx * sign * excess; car.z -= sz * sign * excess;
      car.vl = -car.vl * 0.35; car.vf *= 0.94;
      if (car.speed > 6) {
        if (car.damage(6 * dt + car.speed * 0.02)) return this.gameOver('wreck');
        if (Math.random() < 0.3) Audio8.sfxScrape();
        this.particles.spawn(car.x, 0.5, car.z, { n: 2, color: 0xffc040, spread: 3, up: 2, life: 0.3 });
        this.shakeT = Math.max(this.shakeT, 0.12);
      }
    }

    car.update(dt, input, offroad);
    world.rebuildWindow(car.segIdx);

    // 生态切换
    const nb = world.biomeOf(car.segIdx);
    if (world.setBiome(nb)) {
      UI.banner('— ' + BIOMES[nb].name + ' —');
      Audio8.playTrack({ desert: 1, valley: 2, city: 3 }[nb]);
    }

    // --- 障碍碰撞 ---
    for (const o of world.obstaclesNear(car.segIdx)) {
      const dx = o.x - car.x, dz = o.z - car.z, r = o.r + 1.2;
      if (dx * dx + dz * dz < r * r) {
        const dmg = o.dmg * (0.6 + car.speed / 45);
        world.removeObstacle(o.seg, o);
        this.particles.spawn(o.x, 1, o.z, { n: 18, color: 0xc0a080, spread: 6, up: 5, life: 0.7 });
        Audio8.sfxCrash();
        this.shakeT = 0.45;
        car.vf *= -0.25;
        car.vl = (Math.random() - 0.5) * 9;
        if (car.damage(dmg)) return this.gameOver('wreck');
        UI.flashMsg('-' + Math.round(dmg) + ' BODY');
        break;
      }
    }

    // --- 拾取 ---
    for (const p of world.pickupsNear(car.segIdx)) {
      const dx = p.x - car.x, dz = p.z - car.z;
      if (dx * dx + dz * dz < (p.r + 1) * (p.r + 1)) {
        world.removePickup(p.seg, p);
        if (p.kind === 'coin') {
          const n = 1 + (Math.random() < 0.25 ? 2 : 0);
          this.runCoins += n; Audio8.sfxCoin();
          this.particles.spawn(p.x, 1.2, p.z, { n: 10, color: 0xffd54f, spread: 3, up: 4, life: 0.5 });
          UI.flashMsg('+' + n + ' COIN');
        } else if (p.kind === 'fuel') {
          car.fuel = Math.min(car.fuelCap, car.fuel + 30); Audio8.sfxFuel();
          this.particles.spawn(p.x, 1.2, p.z, { n: 10, color: 0xff7043, spread: 3, up: 4, life: 0.5 });
          UI.flashMsg('+30 FUEL');
        } else if (p.kind === 'wrench') {
          car.durability = Math.min(car.durabilityMax, car.durability + 25); Audio8.sfxWrench();
          this.particles.spawn(p.x, 1.2, p.z, { n: 10, color: 0x9adfff, spread: 3, up: 4, life: 0.5 });
          UI.flashMsg('+25 BODY');
        } else { // cargo
          if (car.cargo < 5) {
            car.cargo++;
            car.applyUpgrades(this.save.up);
            Audio8.sfxCargo();
            UI.flashMsg('📦 货物 +60kg (送到加油站换币)');
          } else UI.flashMsg('货物已满 CARGO FULL');
        }
      }
    }

    // --- 加油站 ---
    this.gasHint = null;
    let inStation = false;
    for (const st of world.stationsActive()) {
      const dx = st.x - car.x, dz = st.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < st.r * st.r) {
        inStation = true;
        if (!st._in) {
          st._in = true;
          if (st.hidden && !st.used) { st.used = true; this.runCoins += 15; UI.flashMsg('★ 发现隐藏加油站 +15币'); Audio8.sfxSell(); }
          if (car.cargo > 0) {
            const gain = car.cargo * 5;
            this.runCoins += gain;
            UI.flashMsg('📦 货物送达 +' + gain + ' 币');
            car.cargo = 0;
            car.applyUpgrades(this.save.up);
            Audio8.sfxSell();
          }
        }
        if (car.speed < 10 && car.fuel < car.fuelCap - 0.5) {
          car.refuel(dt);
          this.refuelT -= dt;
          if (this.refuelT <= 0) { Audio8.sfxRefuelTick(car.fuel / car.fuelCap); this.refuelT = 0.15; }
          UI.flashMsg('⛽ 加油中...');
        }
      } else st._in = false;
    }
    void inStation;
    // 油量低时指引最近加油站
    if (car.fuel / car.fuelCap < 0.45) {
      const ns = world.nearestStation(car.x, car.z, 500);
      if (ns) {
        const ang = Math.atan2(ns.st.x - car.x, ns.st.z - car.z) - car.heading;
        this.gasHint = { angle: ang, dist: ns.dist };
      }
    }

    // --- 警告 ---
    const fuelP = car.fuel / car.fuelCap;
    if (fuelP < 0.22) {
      this.alarmT -= dt;
      if (this.alarmT <= 0) { Audio8.sfxAlarm(); this.alarmT = 2; }
    }
    if (car.fuel <= 0 && car.speed < 0.5) return this.gameOver('fuel');

    // --- 粒子:漂移尘/越野尘/损伤烟 ---
    this.dustT -= dt;
    if (this.dustT <= 0) {
      if (car.drifting && car.speed > 10) {
        this.particles.spawn(car.x, 0.3, car.z, { n: 3, color: 0xcfc0a0, spread: 2, up: 2, life: 0.5, gravity: 2 });
        this.dustT = 0.05;
      } else if (offroad && car.speed > 6) {
        this.particles.spawn(car.x, 0.3, car.z, { n: 2, color: 0xb0a080, spread: 2, up: 2.5, life: 0.4, gravity: 2 });
        this.dustT = 0.08;
      }
      if (car.durability / car.durabilityMax < 0.3) {
        this.particles.spawn(car.x, 1.1, car.z, { n: 2, color: 0x333333, spread: 0.8, up: 2, life: 0.8, gravity: -1 });
        this.dustT = Math.min(this.dustT <= 0 ? 0.12 : this.dustT, 0.12);
      }
    }

    // --- 音频 ---
    const rpm = Math.abs(car.vf) / car.topSpeed;
    Audio8.setEngine(rpm, input.throttle, true);
    Audio8.setDrift(car.drifting ? Math.min(1, Math.abs(car.vl) / 10 + 0.4) : 0);
    Audio8.setRumble(offroad && car.speed > 4 ? 1 : 0);

    this._chaseCam(dt);
    UI.updateHUD(this, dt);
  },
};

window.addEventListener('load', () => Game.init());
