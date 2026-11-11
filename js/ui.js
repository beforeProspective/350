/* ===== UI:HUD / 屏幕切换 / 车库 ===== */
'use strict';

const PAINTS = [0xd23c3c, 0x3c6ed2, 0x3cb54a, 0xe8c832, 0x9a4ad2, 0x3cc8c8, 0xe88232, 0x2a2a2e];

const UPGRADES = {
  eng:  { name: '引擎 ENG',  max: 5, base: 60, wt: 35, desc: '+9% 极速/加速' },
  tank: { name: '油箱 TANK', max: 5, base: 50, wt: 25, desc: '+22 燃油上限' },
  arm:  { name: '装甲 ARMOR',max: 5, base: 50, wt: 55, desc: '+25 耐久上限' },
  tir:  { name: '轮胎 TIRE', max: 5, base: 55, wt: 8,  desc: '+9% 抓地力' },
};

const UI = {
  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), fuel: $('bar-fuel'), body: $('bar-body'), wt: $('bar-wt'),
      cargo: $('hud-cargo'), coins: $('hud-coins'), dist: $('hud-dist'), best: $('hud-best'),
      speed: $('hud-speed'), biome: $('hud-biome'), cam: $('hud-cam'),
      gas: $('hud-gas'), gasArrow: $('gas-arrow'), gasText: $('gas-text'),
      msg: $('hud-msg'), banner: $('hud-banner'), count: $('hud-count'),
      title: $('screen-title'), garage: $('screen-garage'), pause: $('screen-pause'), over: $('screen-over'),
      titleBest: $('title-best'), garageCoins: $('garage-coins'), paintRow: $('paint-row'),
      upgList: $('upg-list'), garageStats: $('garage-stats'),
      overTitle: $('over-title'), overStats: $('over-stats'),
      fps: $('fps'), padInd: $('pad-ind'), btnMusic: $('btn-music'),
    };
    this.msgT = 0; this.bannerT = 0;
  },

  showScreen(name) {
    for (const k of ['title', 'garage', 'pause', 'over']) this.el[k].classList.toggle('hidden', k !== name);
    if (!name) for (const k of ['title', 'garage', 'pause', 'over']) this.el[k].classList.add('hidden');
  },
  showHUD(on) { this.el.hud.classList.toggle('hidden', !on); },

  /* ----- HUD 每帧 ----- */
  updateHUD(g, dt) {
    const car = g.car;
    const fuelP = car.fuel / car.fuelCap * 100;
    const bodyP = car.durability / car.durabilityMax * 100;
    this.el.fuel.style.width = fuelP + '%';
    this.el.body.style.width = bodyP + '%';
    this.el.fuel.classList.toggle('low', fuelP < 22);
    this.el.body.classList.toggle('low', bodyP < 25);
    this.el.wt.style.width = Math.min(100, (car.weight - 900) / 8) + '%';
    this.el.cargo.textContent = car.cargo > 0 ? '📦x' + car.cargo : '';
    this.el.coins.textContent = 'COIN ' + g.save.coins + (g.runCoins > 0 ? ' (+' + g.runCoins + ')' : '');
    this.el.dist.textContent = Math.floor(car.dist) + ' m';
    this.el.best.textContent = 'BEST ' + Math.floor(g.save.best) + ' m';
    this.el.speed.textContent = Math.round(Math.abs(car.vf) * 3.6);
    this.el.biome.textContent = BIOMES[g.world.biome].name;
    this.el.cam.textContent = 'CAM-' + (g.camMode + 1) + ' [C]切换 滚轮缩放';

    // 加油站指引
    if (g.gasHint) {
      this.el.gas.classList.remove('hidden');
      this.el.gasArrow.style.transform = 'rotate(' + g.gasHint.angle + 'rad)';
      this.el.gasText.textContent = '⛽ ' + Math.round(g.gasHint.dist) + 'm';
    } else this.el.gas.classList.add('hidden');

    // 中央消息:持续警告优先,其次瞬时提示
    let warn = '';
    if (bodyP < 25) warn = '⚠ 车身严重受损 CRITICAL';
    else if (fuelP < 22) warn = '⚠ 燃油不足 LOW FUEL';
    if (warn) {
      this.el.msg.textContent = warn;
      this.el.msg.classList.add('blink');
    } else {
      this.el.msg.classList.remove('blink');
      if (this.msgT > 0) {
        this.msgT -= dt;
        this.el.msg.textContent = this.flashText;
        if (this.msgT <= 0) this.el.msg.textContent = '';
      }
    }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.add('hidden'); }
  },
  flashMsg(text) { this.flashText = text; this.msgT = 1.6; this.el.msg.textContent = text; },
  banner(text) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    this.bannerT = 2.6;
  },
  countdown(text) {
    this.el.count.classList.toggle('hidden', !text);
    if (text) this.el.count.textContent = text;
  },

  /* ----- 车库 ----- */
  renderGarage(g) {
    this.el.garageCoins.textContent = 'COIN ' + g.save.coins;
    // 涂装
    this.el.paintRow.innerHTML = '';
    PAINTS.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'swatch' + (g.save.paint === i ? ' sel' : '');
      d.style.background = '#' + c.toString(16).padStart(6, '0');
      d.onclick = () => { g.setPaint(i); Audio8.sfxUI(); };
      this.el.paintRow.appendChild(d);
    });
    // 升级
    this.el.upgList.innerHTML = '';
    for (const key in UPGRADES) {
      const u = UPGRADES[key], lv = g.save.up[key];
      const cost = u.base * (lv + 1);
      const row = document.createElement('div');
      row.className = 'upg-row';
      const pips = '●'.repeat(lv) + '○'.repeat(u.max - lv);
      row.innerHTML =
        '<span class="upg-name">' + u.name + '</span>' +
        '<span class="upg-pips">' + pips + '</span>' +
        '<span class="upg-info">' + u.desc + '<br>+' + u.wt + 'kg/级</span>';
      const btn = document.createElement('button');
      btn.className = 'btn upg-buy';
      if (lv >= u.max) { btn.textContent = 'MAX'; btn.disabled = true; }
      else {
        btn.textContent = cost + ' 币';
        btn.disabled = g.save.coins < cost;
        btn.onclick = () => { g.buyUpgrade(key); };
      }
      row.appendChild(btn);
      this.el.upgList.appendChild(row);
    }
    // 属性预览
    const tmp = { cargo: 0 };
    const up = g.save.up;
    const wt = Math.round(1000 + up.eng * 35 + up.tank * 25 + up.arm * 55 + up.tir * 8);
    const wf = 1000 / wt;
    const top = Math.round(45 * (1 + up.eng * 0.09) * (0.85 + 0.15 * wf) * 3.6);
    this.el.garageStats.innerHTML =
      '车重 WT: ' + wt + ' kg · 极速: ' + top + ' km/h · 油箱: ' + (100 + up.tank * 22) +
      ' · 耐久: ' + (100 + up.arm * 25) + '<br>加速系数: x' + wf.toFixed(2) + ' (越重越慢、越耗油)';
    void tmp;
  },

  /* ----- 结算 ----- */
  renderOver(g, cause) {
    this.el.overTitle.textContent = cause === 'fuel' ? '燃 油 耗 尽' : '车 辆 撞 毁';
    this.el.overTitle.style.color = cause === 'fuel' ? '#f9a825' : '#ff5252';
    const isBest = g.car.dist >= g.save.best;
    this.el.overStats.innerHTML =
      '里程 DIST: <span class="hi">' + Math.floor(g.car.dist) + ' m</span>' + (isBest ? ' ★新纪录' : '') + '<br>' +
      '本次金币: <span class="hi">+' + g.earnedCoins + '</span> (含里程奖励 ' + g.distBonus + ')<br>' +
      '总金币: ' + g.save.coins + ' · 最佳: ' + Math.floor(g.save.best) + ' m';
  },

  setFps(v) { this.el.fps.textContent = v + ' FPS'; },
  setPad(on) { this.el.padInd.classList.toggle('hidden', !on); },
};
