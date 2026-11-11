/* ===== 世界:随机赛道生成 / 地形生态 / 障碍与拾取 / 粒子 ===== */
'use strict';

const SEG_LEN = 10;        // 每段长度
const ROAD_HALF = 5;       // 路面半宽
const GEN_AHEAD = 75;      // 前方预生成段数
const KEEP_BEHIND = 10;    // 后方保留段数
const BIOME_LEN = 260;     // 每个生态的段数
const BIOME_ORDER = ['desert', 'valley', 'city'];

const BIOMES = {
  desert: {
    name: '荒漠 DESERT', sky: 0xffc98a, fogNear: 55, fogFar: 230,
    hemiSky: 0xffe6c0, hemiGround: 0xb08050, sun: 0xffe0c0, sunInt: 1.0,
    ground: 0xd9a860, roadTint: new THREE.Color(0xd8c8a8), maxLat: 60, curve: 0.045,
  },
  valley: {
    name: '山谷 VALLEY', sky: 0x87c5e8, fogNear: 45, fogFar: 200,
    hemiSky: 0xcfe8ff, hemiGround: 0x4f6a3a, sun: 0xfff0d0, sunInt: 0.9,
    ground: 0x6f9a4f, roadTint: new THREE.Color(0xbdbdbd), maxLat: ROAD_HALF + 3.5, curve: 0.085,
  },
  city: {
    name: '城市 CITY', sky: 0x2e2a4e, fogNear: 40, fogFar: 180,
    hemiSky: 0x8a8ac8, hemiGround: 0x2a2a34, sun: 0xffb070, sunInt: 0.55,
    ground: 0x5c5c66, roadTint: new THREE.Color(0x9a9aa8), maxLat: ROAD_HALF + 4, curve: 0.06,
  },
};

/* ---------- 像素粒子系统 ---------- */
class Particles {
  constructor(scene, max) {
    this.max = max || 300;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.baseCol = new Float32Array(this.max * 3);
    this.grav = new Float32Array(this.max);
    this.pos.fill(-999);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.55, map: Tex.particle, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0;
  }
  spawn(x, y, z, opts) {
    const n = opts.n || 8, spread = opts.spread || 3, up = opts.up || 3;
    const life = opts.life || 0.7, grav = opts.gravity === undefined ? 9 : opts.gravity;
    const c = new THREE.Color(opts.color || 0xffffff);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.baseCol[i * 3] = c.r; this.baseCol[i * 3 + 1] = c.g; this.baseCol[i * 3 + 2] = c.b;
      this.grav[i] = grav;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.baseCol[i * 3] * f;
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/* ---------- 世界 ---------- */
class World {
  constructor(scene) {
    this.scene = scene;
    this.layer = new THREE.Group();
    scene.add(this.layer);

    // 灯光
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sun.position.set(60, 120, 40);
    scene.add(this.hemi); scene.add(this.sun);
    scene.fog = new THREE.Fog(0xffffff, 50, 220);

    // 地面(按瓦片步进跟随,纹理世界锁定)
    this.GROUND_SIZE = 900; this.TILE = 16;
    this.groundMat = new THREE.MeshLambertMaterial({ map: Tex.ground.desert, color: 0xffffff });
    this.groundMat.map.repeat.set(this.GROUND_SIZE / this.TILE, this.GROUND_SIZE / this.TILE);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(this.GROUND_SIZE, this.GROUND_SIZE), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    scene.add(this.ground);

    // 路面
    this.roadMat = new THREE.MeshLambertMaterial({ map: Tex.road, vertexColors: true });
    this.roadMesh = null;

    // 共享几何/材质
    this._initAssets();
    this.pools = {};
    this.activeProps = new Map();   // segIdx -> Group
    this.activeObs = new Map();     // segIdx -> [obj]
    this.activePick = new Map();    // segIdx -> [obj]
    this.activeStation = new Map(); // segIdx -> station

    this.envFrom = null; this.envTo = null; this.envT = 1;
    this.biome = 'desert';
  }

  _initAssets() {
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.mat = {
      cactus: L(0x3e8a3a), rock: L(0x8a7a6a), rockDark: L(0x6a5a4a),
      trunk: L(0x7a5230), leaf: L(0x4a7a3a), dune: L(0xcaa06a),
      wall: L(0x9a7a58), wallTop: L(0x7a5a3a),
      barrel: L(0xc23a2a), cone: L(0xe87a2a), crate: L(0xa8763a),
      pole: L(0x3a3a44), lampOn: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
      pump: L(0xc23a2a), pumpTop: L(0xe8e8e8), slab: L(0x4a4a52),
      coin: new THREE.MeshBasicMaterial({ color: 0xffd54f }),
      fuel: L(0xd23a2a), wrench: L(0xb0b8c0), cargo: L(0x8a5a2a),
      roof: L(0xd23a2a),
    };
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      rock: new THREE.DodecahedronGeometry(1, 0),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
      cone: new THREE.ConeGeometry(1, 1, 6),
      coin: new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10),
      sign: new THREE.PlaneGeometry(3.2, 1.6),
      signSmall: new THREE.PlaneGeometry(1.4, 1.4),
    };
    this.buildingMats = Tex.buildings.map((t) => new THREE.MeshLambertMaterial({ map: t }));
    this.signGasMat = new THREE.MeshBasicMaterial({ map: Tex.signGas, side: THREE.DoubleSide });
    this.signHiddenMat = new THREE.MeshBasicMaterial({ map: Tex.signHidden, side: THREE.DoubleSide });

    // 组合体模板
    this.makers = {
      cactus: () => {
        const g = new THREE.Group(), m = this.mat.cactus;
        const t = new THREE.Mesh(this.geo.box, m); t.scale.set(0.7, 3, 0.7); t.position.y = 1.5;
        const a1 = new THREE.Mesh(this.geo.box, m); a1.scale.set(0.5, 1.4, 0.5); a1.position.set(0.7, 1.8, 0);
        const a2 = new THREE.Mesh(this.geo.box, m); a2.scale.set(0.5, 1.0, 0.5); a2.position.set(-0.7, 1.4, 0);
        g.add(t, a1, a2); return g;
      },
      rock: () => new THREE.Mesh(this.geo.rock, this.mat.rock),
      tree: () => {
        const g = new THREE.Group();
        const t = new THREE.Mesh(this.geo.cyl, this.mat.trunk); t.scale.set(0.25, 1.2, 0.25); t.position.y = 0.6;
        const l = new THREE.Mesh(this.geo.cone, this.mat.leaf); l.scale.set(1.6, 3, 1.6); l.position.y = 2.8;
        g.add(t, l); return g;
      },
      dune: () => new THREE.Mesh(this.geo.cone, this.mat.dune),
      wall: () => new THREE.Mesh(this.geo.box, this.mat.wall),
      building: () => new THREE.Mesh(this.geo.box, this.buildingMats[0]),
      lamp: () => {
        const g = new THREE.Group();
        const p = new THREE.Mesh(this.geo.box, this.mat.pole); p.scale.set(0.18, 5, 0.18); p.position.y = 2.5;
        const h = new THREE.Mesh(this.geo.box, this.mat.lampOn); h.scale.set(0.7, 0.25, 0.35); h.position.set(0, 5, -0.6);
        g.add(p, h); return g;
      },
    };
    // 障碍物池 maker(形状固定,按类型分桶)
    const obsMakers = {
      barrel: () => { const m = new THREE.Mesh(this.geo.cyl, this.mat.barrel); m.scale.set(0.8, 1.4, 0.8); m.userData.y0 = 0.7; return m; },
      cone: () => { const m = new THREE.Mesh(this.geo.cone, this.mat.cone); m.scale.set(0.7, 1.1, 0.7); m.userData.y0 = 0.55; return m; },
      crate: () => { const m = new THREE.Mesh(this.geo.box, this.mat.crate); m.scale.setScalar(1.4); m.userData.y0 = 0.7; return m; },
      rock: () => { const m = new THREE.Mesh(this.geo.rock, this.mat.rockDark); m.scale.set(1.5, 1.1, 1.5); m.userData.y0 = 0.5; return m; },
    };
    for (const t in obsMakers) this.makers['obs_' + t] = obsMakers[t];
  }

  _poolGet(type) {
    const p = this.pools[type];
    if (p && p.length) { const m = p.pop(); m.visible = true; this.layer.add(m); return m; }
    const m = this.makers[type]();
    this.layer.add(m);
    return m;
  }
  _poolPut(type, m) {
    this.layer.remove(m);
    m.visible = false;
    (this.pools[type] = this.pools[type] || []).push(m);
  }

  reset(seed) {
    let s = seed >>> 0;
    this.rng = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // 清空
    for (const [k, g] of this.activeProps) this._removeProps(k);
    for (const [k, arr] of this.activeObs) for (const o of arr) this._poolPut('obs_' + o.type, o.mesh);
    for (const [k, arr] of this.activePick) for (const o of arr) this._poolPut('pick_' + o.kind, o.mesh);
    for (const [k, st] of this.activeStation) this._removeStation(st);
    this.activeProps.clear(); this.activeObs.clear(); this.activePick.clear(); this.activeStation.clear();

    this.segs = [];
    this.heading = 0; this.curve = 0; this.targetCurve = 0;
    this.lastObs = -10; this.stationSide = 1;
    this.curLo = -1; this.curHi = -1;
    this.biome = 'desert';
    this._applyEnv(BIOMES.desert, 1);
    this._genTo(GEN_AHEAD + 2);
  }

  biomeOf(i) { return BIOME_ORDER[Math.floor(i / BIOME_LEN) % 3]; }

  _genTo(idx) {
    while (this.segs.length <= idx) this._genSegment(this.segs.length);
  }

  _genSegment(i) {
    const r = this.rng;
    const prev = this.segs[i - 1] || { x: 0, z: 0 };
    const biome = this.biomeOf(i);
    const inBiome = i % BIOME_LEN;
    const B = BIOMES[biome];

    // 弯道演化(生态切换前拉直)
    if (inBiome > BIOME_LEN - 25) this.targetCurve = 0;
    else if (r() < 0.07) this.targetCurve = (r() * 2 - 1) * B.curve;
    this.curve += (this.targetCurve - this.curve) * 0.08;
    this.heading += this.curve;
    const x = prev.x + Math.sin(this.heading) * SEG_LEN;
    const z = prev.z + Math.cos(this.heading) * SEG_LEN;
    const seg = { i, x, z, heading: this.heading, biome, obs: [], picks: [], props: [], station: null };
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading); // 侧向单位向量

    // --- 加油站 ---
    if (i > 40 && i % 170 === 0) {
      this.stationSide *= -1;
      const d = ROAD_HALF + 7;
      seg.station = { x: x + sx * d * this.stationSide, z: z + sz * d * this.stationSide, r: 7.5, hidden: false, used: false };
    } else if (i > 40 && i % 260 === 140) { // 隐藏加油站:远离路面
      const side = r() < 0.5 ? -1 : 1, d = 40 + r() * 25;
      seg.station = { x: x + sx * d * side, z: z + sz * d * side, r: 6, hidden: true, used: false };
    }

    // --- 障碍(路上) ---
    const nearStation = seg.station;
    if (i > 25 && !nearStation && i - this.lastObs > 3 && r() < 0.17) {
      this.lastObs = i;
      const types = biome === 'city' ? ['barrel', 'cone', 'crate'] : biome === 'valley' ? ['rock', 'rock', 'crate'] : ['rock', 'cone', 'crate'];
      const n = r() < 0.25 ? 2 : 1;
      const usedLanes = [];
      for (let k = 0; k < n; k++) {
        let lane = (r() * 2 - 1) * (ROAD_HALF - 1.6);
        if (usedLanes.some((l) => Math.abs(l - lane) < 2.4)) lane = -lane; // 留出生路
        usedLanes.push(lane);
        const type = types[(r() * types.length) | 0];
        seg.obs.push({ type, x: x + sx * lane, z: z + sz * lane });
      }
    }

    // --- 拾取物 ---
    if (i > 15 && r() < 0.11) {
      const lane = (r() * 2 - 1) * (ROAD_HALF - 1.2);
      const roll = r();
      const kind = roll < 0.45 ? 'coin' : roll < 0.72 ? 'fuel' : roll < 0.9 ? 'wrench' : 'cargo';
      seg.picks.push({ kind, x: x + sx * lane, z: z + sz * lane });
    }

    // --- 装饰道具 ---
    const side1 = r() < 0.5 ? -1 : 1;
    if (biome === 'desert') {
      if (r() < 0.26) seg.props.push({ type: 'cactus', side: side1, d: 7 + r() * 20, s: 0.7 + r() * 0.7 });
      if (r() < 0.18) seg.props.push({ type: 'rock', side: -side1, d: 6.5 + r() * 16, s: 0.5 + r() * 1.2 });
      if (r() < 0.08) seg.props.push({ type: 'dune', side: r() < 0.5 ? -1 : 1, d: 34 + r() * 30, s: 8 + r() * 10 });
    } else if (biome === 'valley') {
      seg.props.push({ type: 'wall', side: -1, d: ROAD_HALF + 4.5, h: 6 + r() * 4 });
      seg.props.push({ type: 'wall', side: 1, d: ROAD_HALF + 4.5, h: 6 + r() * 4 });
      if (r() < 0.12) seg.props.push({ type: 'tree', side: side1, d: ROAD_HALF + 10 + r() * 8, s: 0.8 + r() * 0.6 });
    } else {
      if (r() < 0.7) seg.props.push({ type: 'building', side: -1, d: ROAD_HALF + 9 + r() * 8, w: 8 + r() * 6, h: 9 + r() * 24, v: (r() * 3) | 0 });
      if (r() < 0.7) seg.props.push({ type: 'building', side: 1, d: ROAD_HALF + 9 + r() * 8, w: 8 + r() * 6, h: 9 + r() * 24, v: (r() * 3) | 0 });
      if (i % 4 === 0) seg.props.push({ type: 'lamp', side: i % 8 === 0 ? -1 : 1, d: ROAD_HALF + 1.2 });
    }

    this.segs.push(seg);
  }

  /* ----- 窗口重建 ----- */
  rebuildWindow(ci) {
    const lo = Math.max(0, ci - KEEP_BEHIND), hi = ci + GEN_AHEAD;
    if (lo === this.curLo && hi === this.curHi) return;
    this.curLo = lo; this.curHi = hi;
    this._genTo(hi + 1);
    this._buildRoad(lo, hi);
    this._sync(lo, hi);
  }

  _buildRoad(lo, hi) {
    const n = hi - lo + 1;
    const pos = [], uv = [], col = [], idx = [];
    const cA = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const seg = this.segs[lo + k];
      const sx = Math.cos(seg.heading), sz = -Math.sin(seg.heading);
      pos.push(seg.x - sx * ROAD_HALF, 0.04, seg.z - sz * ROAD_HALF);
      pos.push(seg.x + sx * ROAD_HALF, 0.04, seg.z + sz * ROAD_HALF);
      const v = seg.i * SEG_LEN / 8;
      uv.push(0, v, 1, v);
      // 生态交界处颜色渐变
      const inBiome = seg.i % BIOME_LEN;
      cA.copy(BIOMES[seg.biome].roadTint);
      if (inBiome < 12 && seg.i >= BIOME_LEN) {
        const prevB = BIOMES[this.biomeOf(seg.i - 12)];
        cA.lerpColors(prevB.roadTint, BIOMES[seg.biome].roadTint, inBiome / 12);
      }
      col.push(cA.r, cA.g, cA.b, cA.r, cA.g, cA.b);
      if (k < n - 1) {
        const a = k * 2; // L0,R0,L1,R1 → 法线朝上的绕序
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(g, this.roadMat);
    this.scene.add(this.roadMesh);
  }

  _sync(lo, hi) {
    for (const k of [...this.activeProps.keys()]) if (k < lo - 2 || k > hi + 2) this._removeProps(k);
    for (const k of [...this.activeObs.keys()]) if (k < lo - 2 || k > hi + 2) {
      for (const o of this.activeObs.get(k)) this._poolPut('obs_' + o.type, o.mesh);
      this.activeObs.delete(k);
    }
    for (const k of [...this.activePick.keys()]) if (k < lo - 2 || k > hi + 2) {
      for (const o of this.activePick.get(k)) this._poolPut('pick_' + o.kind, o.mesh);
      this.activePick.delete(k);
    }
    for (const k of [...this.activeStation.keys()]) if (k < lo - 2 || k > hi + 2) {
      this._removeStation(this.activeStation.get(k));
      this.activeStation.delete(k);
    }
    for (let i = lo; i <= hi; i++) {
      const seg = this.segs[i];
      if (!seg) continue;
      if (!this.activeProps.has(i)) this._makeProps(seg);
      if (!this.activeObs.has(i) && seg.obs.length) this._makeObs(seg);
      if (!this.activePick.has(i) && seg.picks.length) this._makePicks(seg);
      if (!this.activeStation.has(i) && seg.station) this._makeStation(seg);
    }
  }

  _makeProps(seg) {
    const g = new THREE.Group();
    const sx = Math.cos(seg.heading), sz = -Math.sin(seg.heading);
    for (const p of seg.props) {
      const m = this._poolGet(p.type);
      m.position.set(seg.x + sx * p.d * p.side, 0, seg.z + sz * p.d * p.side);
      m.rotation.y = seg.heading;
      if (p.type === 'cactus' || p.type === 'tree') m.scale.setScalar(p.s);
      else if (p.type === 'rock') { m.scale.set(p.s, p.s * 0.7, p.s); m.rotation.y = p.s * 7; }
      else if (p.type === 'dune') m.scale.set(p.s, p.s * 0.35, p.s);
      else if (p.type === 'wall') {
        m.scale.set(3.5, p.h, SEG_LEN + 0.6);
        m.position.y = p.h / 2 - 0.5;
        m.material = this.mat.wall;
      } else if (p.type === 'building') {
        m.scale.set(p.w, p.h, p.w);
        m.position.y = p.h / 2 - 0.2;
        m.material = this.buildingMats[p.v];
      }
      g.userData.items = g.userData.items || [];
      g.userData.items.push({ type: p.type, mesh: m });
    }
    this.activeProps.set(seg.i, g);
  }
  _removeProps(k) {
    const g = this.activeProps.get(k);
    if (g && g.userData.items) for (const it of g.userData.items) this._poolPut(it.type, it.mesh);
    g && (g.userData.items = []);
    this.activeProps.delete(k);
  }

  _obsDef(type) {
    if (type === 'barrel') return { r: 1.0, dmg: 16 };
    if (type === 'cone') return { r: 0.7, dmg: 6 };
    if (type === 'crate') return { r: 1.1, dmg: 12 };
    return { r: 1.3, dmg: 22 };
  }
  _makeObs(seg) {
    const arr = [];
    for (const d of seg.obs) {
      const def = this._obsDef(d.type);
      const m = this._poolGet('obs_' + d.type);
      m.position.set(d.x, m.userData.y0 || 0, d.z);
      m.rotation.y = this.rng() * 6.28;
      arr.push({ mesh: m, x: d.x, z: d.z, r: def.r, dmg: def.dmg, type: d.type, seg: seg.i, alive: true });
    }
    this.activeObs.set(seg.i, arr);
  }
  removeObstacle(segIdx, obj) {
    const arr = this.activeObs.get(segIdx);
    if (arr) {
      const i = arr.indexOf(obj);
      if (i >= 0) arr.splice(i, 1);
    }
    this._poolPut('obs_' + obj.type, obj.mesh);
  }

  _pickMake(kind) {
    // 每种拾取物一个池,形状固定
    const key = 'pick_' + kind;
    if (!this.makers[key]) {
      this.makers[key] = () => {
        if (kind === 'coin') { const m = new THREE.Mesh(this.geo.coin, this.mat.coin); m.rotation.x = Math.PI / 2; return m; }
        if (kind === 'fuel') {
          const g = new THREE.Group();
          const b = new THREE.Mesh(this.geo.box, this.mat.fuel); b.scale.set(0.9, 1.1, 0.6);
          const t = new THREE.Mesh(this.geo.box, this.mat.pumpTop); t.scale.set(0.4, 0.25, 0.3); t.position.y = 0.65;
          g.add(b, t); return g;
        }
        if (kind === 'wrench') { const m = new THREE.Mesh(this.geo.box, this.mat.wrench); m.scale.set(1.1, 0.3, 0.45); return m; }
        const g = new THREE.Group(); // cargo
        const b = new THREE.Mesh(this.geo.box, this.mat.cargo); b.scale.setScalar(1.2);
        const t = new THREE.Mesh(this.geo.box, this.mat.pumpTop); t.scale.set(1.24, 0.15, 0.3);
        g.add(b, t); return g;
      };
    }
    return this._poolGet(key);
  }
  _makePicks(seg) {
    const arr = [];
    for (const d of seg.picks) {
      const m = this._pickMake(d.kind);
      m.position.set(d.x, 1.0, d.z);
      arr.push({ mesh: m, x: d.x, z: d.z, r: 1.9, kind: d.kind, seg: seg.i, phase: this.rng() * 6.28 });
    }
    this.activePick.set(seg.i, arr);
  }
  removePickup(segIdx, obj) {
    const arr = this.activePick.get(segIdx);
    if (arr) {
      const i = arr.indexOf(obj);
      if (i >= 0) arr.splice(i, 1);
    }
    this._poolPut('pick_' + obj.kind, obj.mesh);
  }

  _makeStation(seg) {
    const st = seg.station;
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = seg.heading;
    const slab = new THREE.Mesh(this.geo.box, this.mat.slab); slab.scale.set(10, 0.15, 8); slab.position.y = 0.07;
    g.add(slab);
    for (const dx of [-1.6, 1.6]) {
      const pump = new THREE.Mesh(this.geo.box, this.mat.pump); pump.scale.set(0.9, 1.7, 0.7); pump.position.set(dx, 0.85, 0);
      const top = new THREE.Mesh(this.geo.box, this.mat.pumpTop); top.scale.set(0.95, 0.3, 0.75); top.position.set(dx, 1.8, 0);
      g.add(pump, top);
    }
    if (!st.hidden) {
      const roof = new THREE.Mesh(this.geo.box, this.mat.roof); roof.scale.set(9, 0.3, 6); roof.position.y = 4.4;
      g.add(roof);
      for (const dx of [-3.8, 3.8]) {
        const leg = new THREE.Mesh(this.geo.box, this.mat.pole); leg.scale.set(0.3, 4.4, 0.3); leg.position.set(dx, 2.2, 0);
        g.add(leg);
      }
      const pole = new THREE.Mesh(this.geo.box, this.mat.pole); pole.scale.set(0.25, 6.5, 0.25); pole.position.set(5.5, 3.25, 2);
      const sign = new THREE.Mesh(this.geo.sign, this.signGasMat); sign.position.set(5.5, 6.8, 2);
      g.add(pole, sign);
    } else {
      const pole = new THREE.Mesh(this.geo.box, this.mat.pole); pole.scale.set(0.18, 2.6, 0.18); pole.position.set(2.5, 1.3, 1.5);
      const sign = new THREE.Mesh(this.geo.signSmall, this.signHiddenMat); sign.position.set(2.5, 2.9, 1.5);
      g.add(pole, sign);
    }
    this.scene.add(g);
    st.group = g;
    this.activeStation.set(seg.i, st);
  }
  _removeStation(st) { if (st.group) { this.scene.remove(st.group); st.group = null; } }

  /* ----- 查询 ----- */
  // 车所在段 + 横向偏移(在 hint 附近搜索;偏离过远时全图搜索)
  locate(x, z, hint) {
    let best = -1, bestD = Infinity;
    const scan = (from, to) => {
      from = Math.max(0, from); to = Math.min(this.segs.length - 1, to);
      for (let i = from; i <= to; i++) {
        const s = this.segs[i];
        const dx = x - s.x, dz = z - s.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    scan(hint - 3, hint + 12);
    if (bestD > 900) { best = -1; bestD = Infinity; scan(0, this.segs.length - 1); } // 丢失→全图
    const s = this.segs[best];
    const sx = Math.cos(s.heading), sz = -Math.sin(s.heading);
    const lat = (x - s.x) * sx + (z - s.z) * sz;
    return { idx: best, lat, seg: s };
  }

  obstaclesNear(ci) {
    const out = [];
    for (let i = ci - 1; i <= ci + 2; i++) {
      const arr = this.activeObs.get(i);
      if (arr) out.push(...arr);
    }
    return out;
  }
  pickupsNear(ci) {
    const out = [];
    for (let i = ci - 1; i <= ci + 2; i++) {
      const arr = this.activePick.get(i);
      if (arr) out.push(...arr);
    }
    return out;
  }
  stationsActive() {
    const out = [];
    for (const st of this.activeStation.values()) out.push(st);
    return out;
  }
  nearestStation(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const st of this.activeStation.values()) {
      const dx = x - st.x, dz = z - st.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = st; }
    }
    return best ? { st: best, dist: Math.sqrt(bd) } : null;
  }

  /* ----- 每帧 ----- */
  update(dt, carX, carZ, time) {
    // 地面瓦片步进跟随(纹理保持世界锁定)
    const T = this.TILE;
    this.ground.position.set(Math.round(carX / T) * T, 0, Math.round(carZ / T) * T);
    // 拾取物旋转/浮动
    for (const arr of this.activePick.values()) {
      for (const p of arr) {
        p.mesh.rotation.y = time * 2 + p.phase;
        p.mesh.position.y = 1.0 + Math.sin(time * 3 + p.phase) * 0.25;
      }
    }
    // 环境过渡
    if (this.envT < 1) {
      this.envT = Math.min(1, this.envT + dt / 2.5);
      this._lerpEnv(this.envT);
    }
  }

  setBiome(b) {
    if (b === this.biome) return false;
    this.envFrom = this._snapshotEnv();
    this.envTo = BIOMES[b];
    this.envT = 0;
    this.biome = b;
    this.groundMat.map = Tex.ground[b];
    this.groundMat.map.repeat.set(this.GROUND_SIZE / this.TILE, this.GROUND_SIZE / this.TILE);
    this.groundMat.needsUpdate = true;
    return true;
  }
  _snapshotEnv() {
    return {
      sky: this.scene.background.getHex(), fogNear: this.scene.fog.near, fogFar: this.scene.fog.far,
      hemiSky: this.hemi.color.getHex(), hemiGround: this.hemi.groundColor.getHex(),
      sun: this.sun.color.getHex(), sunInt: this.sun.intensity,
    };
  }
  _applyEnv(B, t, from) {
    const sky = new THREE.Color(from ? from.sky : B.sky);
    if (from) sky.lerp(new THREE.Color(B.sky), t);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = from ? from.fogNear + (B.fogNear - from.fogNear) * t : B.fogNear;
    this.scene.fog.far = from ? from.fogFar + (B.fogFar - from.fogFar) * t : B.fogFar;
    const hs = new THREE.Color(from ? from.hemiSky : B.hemiSky);
    if (from) hs.lerp(new THREE.Color(B.hemiSky), t);
    this.hemi.color.copy(hs);
    const hg = new THREE.Color(from ? from.hemiGround : B.hemiGround);
    if (from) hg.lerp(new THREE.Color(B.hemiGround), t);
    this.hemi.groundColor.copy(hg);
    const sc = new THREE.Color(from ? from.sun : B.sun);
    if (from) sc.lerp(new THREE.Color(B.sun), t);
    this.sun.color.copy(sc);
    this.sun.intensity = from ? from.sunInt + (B.sunInt - from.sunInt) * t : B.sunInt;
  }
  _lerpEnv(t) { this._applyEnv(this.envTo, t, this.envFrom); }
}
