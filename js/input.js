/* ===== 输入:键盘 + 手柄双模式 ===== */
'use strict';

const Input = {
  keys: {}, pressed: {}, padPrev: [], padConnected: false,
  camZoom: 1, // 滚轮视角缩放

  init() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    window.addEventListener('wheel', (e) => {
      this.camZoom = Math.min(1.6, Math.max(0.65, this.camZoom + (e.deltaY > 0 ? 0.08 : -0.08)));
    }, { passive: true });
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
  },

  _pad() {
    if (!navigator.getGamepads) return null;
    const gs = navigator.getGamepads();
    for (const g of gs) if (g && g.connected) return g;
    return null;
  },
  _padBtn(g, i) { return g.buttons[i] && g.buttons[i].pressed; },
  _padEdge(g, i) { // 按下沿
    const now = this._padBtn(g, i), was = this.padPrev[i] || false;
    this.padPrev[i] = now;
    return now && !was;
  },

  // 每帧读取合成输入
  getState() {
    const k = this.keys, p = this.pressed;
    const s = { steer: 0, throttle: 0, brake: 0, drift: false, cam: false, pause: false, confirm: false, any: false };

    if (k.ArrowLeft || k.KeyA) s.steer -= 1;
    if (k.ArrowRight || k.KeyD) s.steer += 1;
    if (k.ArrowUp || k.KeyW) s.throttle = 1;
    if (k.ArrowDown || k.KeyS) s.brake = 1;
    s.drift = !!k.Space;
    s.cam = !!p.KeyC;
    s.pause = !!(p.KeyP || p.Escape);
    s.confirm = !!p.Enter;
    s.any = Object.keys(p).length > 0;

    const g = this._pad();
    if (g) {
      const ax = g.axes[0] || 0;
      if (Math.abs(ax) > 0.15) s.steer += ax;
      if (this._padBtn(g, 14)) s.steer -= 1;
      if (this._padBtn(g, 15)) s.steer += 1;
      const rt = g.buttons[7] ? g.buttons[7].value : 0;
      const lt = g.buttons[6] ? g.buttons[6].value : 0;
      s.throttle = Math.max(s.throttle, rt, this._padBtn(g, 0) ? 1 : 0);
      s.brake = Math.max(s.brake, lt);
      if (this._padBtn(g, 1) || this._padBtn(g, 2)) s.drift = true;
      if (this._padEdge(g, 3)) s.cam = true;
      if (this._padEdge(g, 9)) s.pause = true;
      if (this._padEdge(g, 0)) s.confirm = true;
      for (let i = 0; i < g.buttons.length; i++) if (this._padBtn(g, i)) { s.any = true; break; }
    }
    s.steer = Math.max(-1, Math.min(1, s.steer));
    return s;
  },

  endFrame() { this.pressed = {}; },
};
