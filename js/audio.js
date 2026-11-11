/* ===== 8-bit 芯片音频引擎:BGM 音序器 + 程序化音效 ===== */
'use strict';

const Audio8 = {
  ctx: null, ready: false, musicOn: true,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.55; this.master.connect(c.destination);
    this.musicGain = c.createGain(); this.musicGain.gain.value = 0.5; this.musicGain.connect(this.master);
    this.sfxGain = c.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);

    // 噪声缓冲
    const len = c.sampleRate * 1.2, buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // --- 引擎声(持续) ---
    this.engOsc1 = c.createOscillator(); this.engOsc1.type = 'sawtooth';
    this.engOsc2 = c.createOscillator(); this.engOsc2.type = 'square';
    this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 500;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.engOsc1.connect(this.engFilter); this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.sfxGain);
    this.engOsc1.start(); this.engOsc2.start();

    // --- 漂移/越野噪声(持续,增益控制) ---
    this.driftSrc = this._loopNoise(900, 'bandpass'); this.driftGain = this.driftSrc.gain;
    this.rumbleSrc = this._loopNoise(160, 'lowpass'); this.rumbleGain = this.rumbleSrc.gain;

    this.ready = true;
    this._musicTimer = setInterval(() => this._schedule(), 30);
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  _loopNoise(freq, type) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start();
    return { src, gain: g };
  },

  /* ---------- 引擎 ---------- */
  setEngine(rpm, throttle, on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 45 + rpm * 165 + throttle * 25;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 1.494, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 900 + throttle * 500, t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.055 + rpm * 0.05 : 0, t, 0.1);
  },
  setDrift(v) { if (this.ready) this.driftGain.gain.setTargetAtTime(v * 0.14, this.ctx.currentTime, 0.05); },
  setRumble(v) { if (this.ready) this.rumbleGain.gain.setTargetAtTime(v * 0.12, this.ctx.currentTime, 0.08); },

  /* ---------- 一次性音效 ---------- */
  _blip(freq, dur, type, vol, when, slideTo) {
    if (!this.ready) return;
    const c = this.ctx, t = when || c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  },
  _noise(dur, vol, filterFreq, type) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'highpass'; f.frequency.value = filterFreq || 1000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + dur + 0.02);
  },
  sfxCount(final) { this._blip(final ? 880 : 440, final ? 0.35 : 0.12, 'square', 0.18); },
  sfxCoin()  { this._blip(988, 0.06, 'square', 0.14); this._blip(1319, 0.14, 'square', 0.14, this.ctx ? this.ctx.currentTime + 0.06 : 0); },
  sfxFuel()  { this._blip(330, 0.2, 'square', 0.15, 0, 660); },
  sfxWrench(){ this._blip(520, 0.07, 'square', 0.14); this._blip(780, 0.12, 'square', 0.14, this.ctx ? this.ctx.currentTime + 0.07 : 0); },
  sfxCargo() { this._blip(196, 0.1, 'square', 0.16); this._blip(147, 0.14, 'square', 0.16, this.ctx ? this.ctx.currentTime + 0.09 : 0); },
  sfxCrash() { this._noise(0.25, 0.4, 700, 'lowpass'); this._blip(110, 0.2, 'sawtooth', 0.25, 0, 40); },
  sfxScrape(){ this._noise(0.12, 0.2, 2500, 'highpass'); },
  sfxExplode(){ this._noise(0.9, 0.5, 400, 'lowpass'); this._blip(90, 0.7, 'sawtooth', 0.3, 0, 30); },
  sfxAlarm() { this._blip(880, 0.09, 'square', 0.1); },
  sfxUI()    { this._blip(660, 0.05, 'square', 0.1); },
  sfxRefuelTick(p) { this._blip(300 + p * 500, 0.05, 'triangle', 0.12); },
  sfxSell()  { this._blip(659, 0.07, 'square', 0.14); this._blip(880, 0.07, 'square', 0.14, this.ctx ? this.ctx.currentTime + 0.07 : 0); this._blip(1108, 0.12, 'square', 0.14, this.ctx ? this.ctx.currentTime + 0.14 : 0); },

  /* ---------- BGM 音序器 ---------- */
  // 简谱格式: 空格分隔,每 token 一个16分音符; "C4"/"F#3" 音符, "-" 延长, "." 休止, 鼓用 "x"
  _parse(str) {
    const N = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
    const toks = str.trim().split(/\s+/), steps = [];
    for (const tk of toks) {
      if (tk === '-') { steps.push('tie'); continue; }
      if (tk === '.') { steps.push(null); continue; }
      if (tk === 'x') { steps.push('hat'); continue; }
      const m = tk.match(/^([A-G]#?)(\d)$/);
      if (m) steps.push({ midi: N[m[1]] + (parseInt(m[2], 10) + 1) * 12, dur: 1 });
      else steps.push(null);
    }
    for (let i = 0; i < steps.length; i++) {   // 解析延音
      if (steps[i] && steps[i] !== 'tie' && steps[i] !== 'hat') {
        let j = i + 1;
        while (j < steps.length && steps[j] === 'tie') { steps[i].dur++; steps[j] = null; j++; }
      }
    }
    return steps;
  },
  _tracks() {
    return [
      { // 0 标题/车库
        bpm: 116,
        lead: 'E5 - G5 - A5 - - - G5 - E5 - D5 - E5 - - - G5 - A5 - - - B5 - A5 - G5 - - -',
        bass: 'A2 - - - A2 - - - F2 - - - F2 - - - C3 - - - C3 - - - G2 - - - G2 - - -',
        hat:  'x . . x . . x .',
      },
      { // 1 荒漠
        bpm: 142,
        lead: 'A4 . C5 . D5 - C5 . A4 . G4 . A4 . . . E5 . D5 . C5 . D5 - C5 . A4 . G4 . A4 . . .',
        bass: 'A2 A2 . A2 A2 . A2 . F2 F2 . F2 G2 . G2 .',
        arp:  'A3 C4 E4 A4 C4 E4 A4 E4',
        hat:  'x . x x . x . x',
      },
      { // 2 山谷
        bpm: 120,
        lead: 'E4 - - - G4 - - - A4 - - - - - - - C5 - - - B4 - - - A4 - - - - - - -',
        bass: 'A2 . . . F2 . . . C3 . . . G2 . . .',
        arp:  'A3 C4 E4 A4 C4 E4 A4 C4 F3 A3 C4 F4 A3 C4 F4 A3 C3 E3 G3 C4 E3 G3 C4 E3 G2 B2 D3 G3 B2 D3 G3 B2',
        hat:  'x . . x . . x .',
      },
      { // 3 城市
        bpm: 152,
        lead: 'F4 . A4 . C5 - A4 . F4 . D4 . F4 . . . G4 . A4 . G4 . F4 . D4 . E4 . . .',
        bass: 'D3 D3 . D3 . D3 C3 . D3 D3 . D3 . F3 G3 .',
        arp:  'D4 F4 A4 D5 A4 F4 D4 F4',
        hat:  'x . x x . x x .',
      },
    ];
  },
  playTrack(idx) {
    if (!this.ready) { this._pendingTrack = idx; return; }
    if (this._trackIdx === idx) return;
    this._trackIdx = idx;
    const raw = this._tracks()[idx];
    this._song = {
      bpm: raw.bpm,
      chans: {},
      len: 0,
    };
    const defs = [
      ['lead', 'square', 0.16], ['bass', 'triangle', 0.22], ['arp', 'square', 0.07],
    ];
    for (const [name, type, vol] of defs) {
      if (!raw[name]) continue;
      const steps = this._parse(raw[name]);
      this._song.chans[name] = { steps, type, vol };
      this._song.len = Math.max(this._song.len, steps.length);
    }
    if (raw.hat) this._song.chans.hat = { steps: this._parse(raw.hat), hat: true, vol: 0.08 };
    this._step = 0;
    this._nextT = this.ctx.currentTime + 0.06;
  },
  stopMusic() { this._trackIdx = -1; this._song = null; },
  setMusicOn(on) {
    this.musicOn = on;
    if (this.ready) this.musicGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.1);
  },
  duckMusic(v) { if (this.ready && this.musicOn) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15); },

  _schedule() {
    if (!this._song || !this.musicOn) return;
    const c = this.ctx, stepDur = 60 / this._song.bpm / 4;
    while (this._nextT < c.currentTime + 0.12) {
      const s = this._step % this._song.len;
      for (const name in this._song.chans) {
        const ch = this._song.chans[name];
        const st = ch.steps[s % ch.steps.length];
        if (!st) continue;
        if (st === 'hat') {
          const src = c.createBufferSource(); src.buffer = this.noiseBuf;
          const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
          const g = c.createGain();
          g.gain.setValueAtTime(ch.vol, this._nextT);
          g.gain.exponentialRampToValueAtTime(0.001, this._nextT + 0.04);
          src.connect(f); f.connect(g); g.connect(this.musicGain);
          src.start(this._nextT); src.stop(this._nextT + 0.05);
        } else {
          const freq = 440 * Math.pow(2, (st.midi - 69) / 12);
          const o = c.createOscillator(); o.type = ch.type; o.frequency.value = freq;
          const g = c.createGain();
          const dur = st.dur * stepDur;
          g.gain.setValueAtTime(0.0001, this._nextT);
          g.gain.linearRampToValueAtTime(ch.vol, this._nextT + 0.01);
          g.gain.setValueAtTime(ch.vol, this._nextT + dur * 0.7);
          g.gain.linearRampToValueAtTime(0.0001, this._nextT + dur * 0.95);
          o.connect(g); g.connect(this.musicGain);
          o.start(this._nextT); o.stop(this._nextT + dur);
        }
      }
      this._step++;
      this._nextT += stepDur;
    }
  },
};
