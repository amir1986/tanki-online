// Procedural WebAudio sound effects (no audio files needed).
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.uiGain = null;
    this.volume = { master: 0.8, sfx: 1, ui: 0.8, engine: 0.6 };
    this.listener = { pos: [0, 0, 0], yaw: 0 };
    this.engine = null;
    this.loops = new Map();
    this.noiseBuf = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
    this.uiGain = this.ctx.createGain(); this.uiGain.connect(this.master);
    this.applyVolume();
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    Object.assign(this.volume, v);
    this.applyVolume();
  }
  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.volume.master;
    this.sfxGain.gain.value = this.volume.sfx;
    this.uiGain.gain.value = this.volume.ui;
  }

  setListener(pos, yaw) { this.listener.pos = pos; this.listener.yaw = yaw; }

  /** Spatialize: returns [gain, pan] for a world position. */
  spatial(pos) {
    if (!pos) return [1, 0];
    const dx = pos[0] - this.listener.pos[0], dz = pos[2] - this.listener.pos[2];
    const d = Math.hypot(dx, dz, pos[1] - this.listener.pos[1]);
    const gain = 1 / (1 + d / 18) * (d > 140 ? 0 : 1);
    const yaw = this.listener.yaw;
    const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const pan = d > 1 ? Math.max(-1, Math.min(1, rx / Math.max(d, 1) * 0.8)) : 0;
    return [gain, pan];
  }

  node(pos, vol = 1, dest = null) {
    const g = this.ctx.createGain();
    const [sg, pan] = this.spatial(pos);
    g.gain.value = vol * sg;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(dest || this.sfxGain);
    return g;
  }

  noise(duration, { pos, vol = 1, freq = 1000, q = 0.7, type = 'lowpass', attack = 0.002, decay = duration, pitchDrop = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (pitchDrop) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitchDrop), t0 + decay);
    const g = this.node(pos, vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(g.gain.value || 0.0001, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(f); f.connect(g);
    src.start(t0); src.stop(t0 + decay + 0.05);
  }

  tone(freq, duration, { pos, vol = 0.5, type = 'sine', slide = 1, attack = 0.005, dest = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + duration);
    const g = this.node(pos, vol, dest);
    const peak = g.gain.value || 0.0001;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    o.connect(g);
    o.start(t0); o.stop(t0 + duration + 0.05);
  }

  /** Named one-shots. */
  play(name, pos = null, vol = 1) {
    if (!this.ctx) return;
    switch (name) {
      case 'smoky': this.noise(0.25, { pos, vol: 0.9 * vol, freq: 900, pitchDrop: 0.2 }); this.tone(120, 0.18, { pos, vol: 0.5 * vol, type: 'triangle', slide: 0.4 }); break;
      case 'twins': this.tone(880, 0.12, { pos, vol: 0.25 * vol, type: 'square', slide: 0.5 }); this.noise(0.08, { pos, vol: 0.25 * vol, freq: 2500 }); break;
      case 'thunder': this.noise(0.5, { pos, vol: 1.1 * vol, freq: 500, pitchDrop: 0.15 }); this.tone(70, 0.4, { pos, vol: 0.7 * vol, type: 'triangle', slide: 0.4 }); break;
      case 'railgun': this.noise(0.4, { pos, vol: 1.0 * vol, freq: 3000, type: 'highpass' }); this.tone(1600, 0.35, { pos, vol: 0.4 * vol, type: 'sawtooth', slide: 0.15 }); this.tone(90, 0.3, { pos, vol: 0.5 * vol, type: 'triangle', slide: 0.5 }); break;
      case 'charge': this.tone(200, 1.1, { pos, vol: 0.25 * vol, type: 'sawtooth', slide: 6, attack: 0.3 }); break;
      case 'shaft': this.noise(0.35, { pos, vol: 1.0 * vol, freq: 1800, pitchDrop: 0.1 }); this.tone(220, 0.25, { pos, vol: 0.5 * vol, type: 'square', slide: 0.2 }); break;
      case 'hammer': for (let i = 0; i < 3; i++) setTimeout(() => this.noise(0.3, { pos, vol: 0.8 * vol, freq: 700, pitchDrop: 0.2 }), i * 12); this.tone(90, 0.3, { pos, vol: 0.6 * vol, type: 'triangle', slide: 0.4 }); break;
      case 'vulcan': this.noise(0.06, { pos, vol: 0.5 * vol, freq: 1400, pitchDrop: 0.5 }); this.tone(300, 0.05, { pos, vol: 0.2 * vol, type: 'square', slide: 0.5 }); break;
      case 'ricochet': this.tone(1200, 0.15, { pos, vol: 0.3 * vol, type: 'sine', slide: 0.6 }); this.noise(0.08, { pos, vol: 0.2 * vol, freq: 3000, type: 'highpass' }); break;
      case 'striker': this.noise(0.5, { pos, vol: 0.7 * vol, freq: 600, type: 'bandpass', q: 1.5, pitchDrop: 3 }); break;
      case 'bounce': this.tone(1500, 0.1, { pos, vol: 0.3 * vol, type: 'sine', slide: 0.4 }); break;
      case 'hit': this.noise(0.08, { pos, vol: 0.5 * vol, freq: 2000, type: 'bandpass', q: 2 }); this.tone(400, 0.06, { pos, vol: 0.2 * vol, type: 'square', slide: 0.5 }); break;
      case 'hitme': this.noise(0.12, { pos: null, vol: 0.6 * vol, freq: 900, type: 'bandpass', q: 1 }); this.tone(160, 0.1, { vol: 0.3 * vol, type: 'triangle', slide: 0.6 }); break;
      case 'impact': this.noise(0.12, { pos, vol: 0.4 * vol, freq: 1200, pitchDrop: 0.3 }); break;
      case 'explosion': this.noise(1.1, { pos, vol: 1.4 * vol, freq: 400, pitchDrop: 0.08 }); this.tone(55, 0.9, { pos, vol: 0.9 * vol, type: 'triangle', slide: 0.3 }); break;
      case 'boom': this.noise(0.6, { pos, vol: 1.0 * vol, freq: 500, pitchDrop: 0.12 }); this.tone(70, 0.5, { pos, vol: 0.6 * vol, type: 'triangle', slide: 0.4 }); break;
      case 'mine': this.noise(0.9, { pos, vol: 1.3 * vol, freq: 450, pitchDrop: 0.1 }); this.tone(60, 0.7, { pos, vol: 0.8 * vol, type: 'triangle', slide: 0.3 }); break;
      case 'pickup': [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, { vol: 0.3 * vol, type: 'sine' }), i * 70)); break;
      case 'gold': [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, { vol: 0.35 * vol, type: 'triangle' }), i * 110)); break;
      case 'supply': this.tone(500, 0.15, { vol: 0.3 * vol, type: 'sine', slide: 1.6 }); break;
      case 'spawn': this.tone(300, 0.4, { pos, vol: 0.3 * vol, type: 'sine', slide: 2.5 }); this.noise(0.3, { pos, vol: 0.3 * vol, freq: 2000, type: 'highpass' }); break;
      case 'rankup': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, { vol: 0.4 * vol, type: 'triangle' }), i * 140)); break;
      case 'flag': this.tone(700, 0.2, { vol: 0.35 * vol, type: 'square', slide: 1.5 }); setTimeout(() => this.tone(1050, 0.25, { vol: 0.3 * vol, type: 'square' }), 120); break;
      case 'flagbad': this.tone(500, 0.3, { vol: 0.35 * vol, type: 'square', slide: 0.5 }); break;
      case 'cp': this.tone(600, 0.3, { vol: 0.3 * vol, type: 'sine', slide: 1.3 }); break;
      case 'click': this.tone(1200, 0.05, { vol: 0.25 * vol, type: 'square', dest: this.uiGain }); break;
      case 'hover': this.tone(1800, 0.03, { vol: 0.08 * vol, type: 'sine', dest: this.uiGain }); break;
      case 'buy': [900, 1300].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, { vol: 0.3 * vol, type: 'sine', dest: this.uiGain }), i * 80)); break;
      case 'error': this.tone(220, 0.25, { vol: 0.3 * vol, type: 'square', slide: 0.7, dest: this.uiGain }); break;
      case 'chat': this.tone(1400, 0.08, { vol: 0.15 * vol, type: 'sine', dest: this.uiGain }); break;
      case 'countdown': this.tone(880, 0.12, { vol: 0.3 * vol, type: 'square', dest: this.uiGain }); break;
      case 'end': [784, 659, 523].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, { vol: 0.35 * vol, type: 'triangle', dest: this.uiGain }), i * 180)); break;
      case 'sd': this.tone(300, 1.4, { vol: 0.3 * vol, type: 'sawtooth', slide: 0.3 }); break;
      case 'freeze_hit': this.noise(0.15, { pos, vol: 0.3 * vol, freq: 5000, type: 'highpass' }); break;
      case 'heal': this.tone(900, 0.15, { pos, vol: 0.15 * vol, type: 'sine', slide: 1.3 }); break;
      default: break;
    }
  }

  /** Continuous loops keyed by id (firebird, freeze, isida, vulcan spin). */
  loop(key, kind, pos, on) {
    if (!this.ctx) return;
    let L = this.loops.get(key);
    if (on && !L) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner();
      let osc = null;
      if (kind === 'firebird') { f.type = 'lowpass'; f.frequency.value = 900; }
      else if (kind === 'freeze') { f.type = 'highpass'; f.frequency.value = 3500; }
      else if (kind === 'isida') { f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 6; osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 180; const og = this.ctx.createGain(); og.gain.value = 0.3; osc.connect(og); og.connect(g); osc.start(); }
      else if (kind === 'vulcan') { f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 1; }
      src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxGain);
      g.gain.value = 0;
      src.start();
      L = { src, f, g, p, osc, kind };
      this.loops.set(key, L);
    }
    if (!L) return;
    if (on) {
      const [sg, pan] = this.spatial(pos);
      const base = kind === 'firebird' ? 0.5 : kind === 'freeze' ? 0.35 : kind === 'isida' ? 0.4 : 0.3;
      L.g.gain.setTargetAtTime(base * sg, this.ctx.currentTime, 0.05);
      L.p.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.05);
    } else {
      L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const dead = L;
      this.loops.delete(key);
      setTimeout(() => { try { dead.src.stop(); dead.osc?.stop(); } catch (e) { /* ignore */ } }, 300);
    }
  }

  stopAllLoops() {
    for (const key of [...this.loops.keys()]) this.loop(key, null, null, false);
    if (this.engine) { this.engine.g.gain.value = 0; }
  }

  /** Local tank engine: a soft diesel rumble (filtered noise + low harmonics with a slow throb), speedNorm 0..1. */
  updateEngine(dt, speedNorm, on) {
    if (!this.ctx) return;
    if (!this.engine) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 38;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 76;
      const og = ctx.createGain(); og.gain.value = 0.55;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985; d[i] = last; } // brown-ish noise
      const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 160; nf.Q.value = 0.7;
      const ng = ctx.createGain(); ng.gain.value = 1.6;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.012;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      o.connect(og); o2.connect(og); og.connect(f);
      n.connect(nf); nf.connect(ng); ng.connect(f);
      f.connect(g); g.connect(this.sfxGain);
      o.start(); o2.start(); n.start(); lfo.start();
      this.engine = { o, o2, f, g, lfo, rpm: 0 };
    }
    const E = this.engine;
    E.rpm += ((on ? 0.2 + speedNorm * 0.8 : 0) - E.rpm) * Math.min(1, dt * 2.5);
    const t = this.ctx.currentTime;
    E.o.frequency.setTargetAtTime(34 + E.rpm * 38, t, 0.08);
    E.o2.frequency.setTargetAtTime(68 + E.rpm * 76, t, 0.08);
    E.f.frequency.setTargetAtTime(150 + E.rpm * 260, t, 0.08);
    E.lfo.frequency.setTargetAtTime(5 + E.rpm * 9, t, 0.1);
    E.g.gain.setTargetAtTime(on ? this.volume.engine * (0.06 + E.rpm * 0.08) : 0, t, 0.15);
  }
}
