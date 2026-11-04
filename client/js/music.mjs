// Soundtrack: CC0 tracks from OpenGameArt (see client/assets/CREDITS.md and client/assets/music/index.json) streamed
// with HTMLAudio through the game's WebAudio master gain, with crossfades between the menu and battle playlists.
const BASE = '/client/assets/music';

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.mode = null;
    this.volume = 0.5;
    this.enabled = true;
    this.lists = { menu: [], battle: [] };
    this.loaded = false;
    this.current = null;
    this.pending = null;
    this.gain = null;
    this.lastIndex = { menu: -1, battle: -1 };
    this.onTrack = null;
    fetch(`${BASE}/index.json`).then((r) => r.json()).then((j) => {
      this.lists = { menu: j.menu || [], battle: j.battle || [] };
      this.loaded = true;
      if (this.pending) { const m = this.pending; this.pending = null; this.play(m); }
    }).catch((e) => console.warn('[music] playlist unavailable', e));
  }

  ensure() {
    const ctx = this.audio.ctx;
    if (!ctx || !this.audio.master) return false;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = this.enabled ? this.volume : 0;
      this.gain.connect(this.audio.master);
    }
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain && this.audio.ctx) this.gain.gain.setTargetAtTime(this.enabled ? v : 0, this.audio.ctx.currentTime, 0.2);
  }

  /** Switch playlist: 'menu' | 'battle' | null. */
  play(mode) {
    if (this.mode === mode) return;
    if (!mode) { this.stop(); return; }
    if (!this.loaded || !this.ensure()) { this.pending = mode; return; }
    this.mode = mode;
    this.next();
  }

  next() {
    const list = this.lists[this.mode] || [];
    if (!list.length) return;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastIndex[this.mode]) i = (i + 1) % list.length;
    this.lastIndex[this.mode] = i;
    this.start(list[i]);
  }

  start(track) {
    const ctx = this.audio.ctx;
    const el = new Audio(`${BASE}/${encodeURIComponent(track.file)}`);
    el.preload = 'auto';
    el.loop = false;
    let src;
    try { src = ctx.createMediaElementSource(el); } catch (e) { console.warn('[music] cannot route element', e); return; }
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.gain);
    const entry = { el, src, g, track, mode: this.mode };
    el.addEventListener('ended', () => { if (this.current === entry && this.mode === entry.mode) this.next(); });
    el.addEventListener('error', () => { if (this.current === entry) console.warn('[music] failed to play', track.file); });
    const prev = this.current;
    this.current = entry;
    if (prev) this.fadeOut(prev);
    el.play().then(() => {
      g.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
      if (this.onTrack) this.onTrack(track);
    }).catch(() => {
      // autoplay blocked until the first user gesture: resume() retries
      this.pending = entry.mode;
      this.mode = null;
      this.current = null;
      try { src.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
    });
  }

  fadeOut(entry) {
    const ctx = this.audio.ctx;
    entry.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    setTimeout(() => { try { entry.el.pause(); entry.el.src = ''; entry.src.disconnect(); entry.g.disconnect(); } catch (e) { /* ignore */ } }, 2500);
  }

  stop() {
    if (this.current) { this.fadeOut(this.current); this.current = null; }
    this.mode = null;
    this.pending = null;
  }

  /** Call on a user gesture once the AudioContext exists. */
  resume() {
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume().catch(() => {});
    if (this.pending) { const m = this.pending; this.pending = null; this.play(m); }
    else if (this.current && this.current.el.paused) this.current.el.play().catch(() => {});
  }

  nowPlaying() { return this.current ? this.current.track : null; }
}
