/* ===== 程序化 8-bit 像素纹理 ===== */
'use strict';

function pxCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  return c;
}
function toTex(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}
// 确定性小随机(纹理用)
function mkRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 噪点地面
function noiseTex(base, dots, seed) {
  const r = mkRng(seed);
  return pxCanvas(32, 32, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = dots[(r() * dots.length) | 0];
      g.fillRect((r() * 32) | 0, (r() * 32) | 0, r() < 0.3 ? 2 : 1, 1);
    }
  });
}

const Tex = {
  init() {
    // --- 公路(灰度,由顶点色染成各地形色调) ---
    this.road = toTex(pxCanvas(32, 32, (g) => {
      const r = mkRng(7);
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = r() < 0.5 ? '#7e7e7e' : '#969696';
        g.fillRect((r() * 32) | 0, (r() * 32) | 0, 1, 1);
      }
      g.fillStyle = '#e8e8e8';                 // 边线
      g.fillRect(0, 0, 2, 32); g.fillRect(30, 0, 2, 32);
      g.fillStyle = '#d8c040';                 // 中央虚线
      g.fillRect(15, 2, 2, 12);
    }), true);

    // --- 地面 ---
    this.ground = {
      desert: toTex(noiseTex('#d9a860', ['#c99850', '#e8bc78', '#b88848', '#e0b070'], 11), true),
      valley: toTex(noiseTex('#6f9a4f', ['#5f8a42', '#82aa5c', '#8a6a42', '#4f7a38'], 22), true),
      city:   toTex(noiseTex('#5c5c66', ['#50505a', '#6a6a74', '#484852', '#62626c'], 33), true),
    };

    // --- 建筑立面(3种,带亮灯窗) ---
    this.buildings = [];
    const bBase = ['#4a4e6a', '#6a4a52', '#3e5a5e'];
    for (let v = 0; v < 3; v++) {
      this.buildings.push(toTex(pxCanvas(32, 64, (g) => {
        const r = mkRng(100 + v);
        g.fillStyle = bBase[v]; g.fillRect(0, 0, 32, 64);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, 32, 3);
        for (let y = 5; y < 60; y += 7) for (let x = 3; x < 28; x += 7) {
          const lit = r() < 0.42;
          g.fillStyle = lit ? (r() < 0.7 ? '#ffd76a' : '#9adfff') : '#20202c';
          g.fillRect(x, y, 4, 5);
        }
      }), false));
    }

    // --- 加油站招牌 ---
    this.signGas = toTex(pxCanvas(48, 24, (g) => {
      g.fillStyle = '#c62828'; g.fillRect(0, 0, 48, 24);
      g.fillStyle = '#fff'; g.fillRect(2, 2, 44, 20);
      g.fillStyle = '#c62828'; g.font = 'bold 12px monospace';
      g.fillText('GAS', 10, 17);
    }), false);
    this.signHidden = toTex(pxCanvas(24, 24, (g) => {
      g.fillStyle = '#f9a825'; g.fillRect(0, 0, 24, 24);
      g.fillStyle = '#3e2723'; g.font = 'bold 16px monospace';
      g.fillText('?', 8, 18);
    }), false);

    // --- 粒子(像素方块) ---
    this.particle = toTex(pxCanvas(8, 8, (g) => {
      g.fillStyle = '#fff'; g.fillRect(1, 1, 6, 6);
    }), false);

    // --- 车辆条纹贴图(车身侧面用) ---
    this.carSide = toTex(pxCanvas(32, 8, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 8);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 6, 32, 2);   // 下沿阴影
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0, 32, 1); // 高光
      g.fillStyle = '#222'; g.fillRect(26, 2, 4, 3);               // 门把/细节
    }), false);
  },
};
