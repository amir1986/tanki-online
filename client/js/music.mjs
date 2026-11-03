// Generative soundtrack: a lookahead sequencer playing synthesized pads, bass, arpeggios and drums.
// Two moods: 'menu' (calm) and 'battle' (driving). No audio files needed.
const A2 = 45; // midi
const CHORDS = [
  [0, 3, 7, 10],   // i7   (A minor 7)
  [-4, 0, 3, 7],   // VI   (F major 7)
  [3, 7, 10, 14],  // III  (C major 7)
  [-2, 2, 5, 10],  // VII  (G major 7)
];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.mode = null;
    this.volume = 0.35;
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.gain = null;
    this.bar = 0;
    this.enabled = true;
    this.fill = 0;
  }

  ensure() {
    const ctx = this.audio.ctx;
    if (!ctx) return false;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      this.gain.connect(comp);
      comp.connect(this.audio.master);
      this.lowpass = ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 2400;
      this.lowpass.connect(this.gain);
    }
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.setTargetAtTime(this.enabled ? v : 0, this.audio.ctx.currentTime, 0.2);
  }

  play(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (!mode) { this.stop(); return; }
    if (!this.ensure()) { this.pending = mode; return; }
    this.bpm = mode === 'battle' ? 128 : 96;
    if (!this.timer) {
      this.nextTime = this.audio.ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = setInterval(() => this.schedule(), 60);
    }
    this.gain.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.audio.ctx.currentTime, 0.5);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.gain && this.audio.ctx) this.gain.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.4);
    this.mode = null;
  }

  /** Call on user gesture once the AudioContext exists. */
  resume() {
    if (this.pending && this.ensure()) { const m = this.pending; this.pending = null; this.mode = null; this.play(m); }
  }

  schedule() {
    const ctx = this.audio.ctx;
    if (!ctx || !this.mode) return;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  tone(freq, t, dur, { type = 'sine', vol = 0.2, attack = 0.01, release = 0.1, detune = 0, filter = null } = {}) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
    o.connect(g);
    g.connect(filter || this.lowpass);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(t, dur, { vol = 0.15, type = 'highpass', freq = 6000 } = {}) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.lowpass);
    src.start(t); src.stop(t + dur + 0.02);
  }

  kick(t) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + 0.3);
  }

  playStep(step, t, dt) {
    const battle = this.mode === 'battle';
    const barLen = 16;
    const bar = Math.floor(step / barLen);
    const inBar = step % barLen;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const root = A2 + chord[0];
    // pad on bar start
    if (inBar === 0 && bar % 2 === 0) {
      const dur = dt * barLen * 2;
      for (let i = 0; i < 4; i++) {
        const m = A2 + 12 + chord[i];
        this.tone(midiHz(m), t, dur, { type: 'sawtooth', vol: battle ? 0.035 : 0.05, attack: 0.6, release: 1.2, detune: -6 });
        this.tone(midiHz(m), t, dur, { type: 'sawtooth', vol: battle ? 0.035 : 0.05, attack: 0.6, release: 1.2, detune: 6 });
      }
    }
    // arpeggio
    const arpOn = battle ? (inBar % 2 === 0) : (inBar % 4 === 0);
    if (arpOn) {
      const seq = [0, 2, 1, 3, 2, 1, 3, 0];
      const idx = seq[Math.floor(inBar / (battle ? 2 : 4)) % seq.length];
      const octave = battle && bar % 4 === 3 ? 36 : 24;
      this.tone(midiHz(A2 + octave + chord[idx]), t, dt * (battle ? 1.6 : 3.2), { type: 'triangle', vol: battle ? 0.09 : 0.07, attack: 0.005, release: 0.08 });
    }
    if (battle) {
      // bass
      const bassPattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
      if (bassPattern[inBar]) this.tone(midiHz(root - 12), t, dt * 1.8, { type: 'sawtooth', vol: 0.14, attack: 0.005, release: 0.06 });
      // drums
      if (inBar % 4 === 0) this.kick(t);
      if (inBar === 4 || inBar === 12) this.noise(t, 0.18, { vol: 0.18, type: 'bandpass', freq: 1800 });
      if (inBar % 2 === 0) this.noise(t, 0.04, { vol: inBar % 4 === 2 ? 0.08 : 0.05 });
      if (bar % 8 === 7 && inBar >= 12) this.noise(t, 0.08, { vol: 0.1, type: 'bandpass', freq: 2500 });
    } else if (inBar === 0 && bar % 4 === 0) {
      this.tone(midiHz(root - 12), t, dt * barLen, { type: 'sine', vol: 0.12, attack: 0.2, release: 0.8 });
    }
  }
}
