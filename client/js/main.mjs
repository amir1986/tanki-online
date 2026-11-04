// App bootstrap: connects to the server, drives screens, the showroom and the battle client.
import { View } from './render/view.mjs';
import { FollowCamera } from './render/camera.mjs';
import { Input } from './input.mjs';
import { GameAudio } from './audio.mjs';
import { Net } from './net.mjs';
import { Screens } from './ui/screens.mjs';
import { Garage, Showroom } from './ui/garage.mjs';
import { BattleClient } from './battle.mjs';
import { C2S } from '/shared/protocol.mjs';
import { Assets } from './render/assets.mjs';
import { Music } from './music.mjs';

export const QUALITY_PRESETS = {
  low: { scale: 0.7, shadows: 1, bloom: false, ao: false },
  medium: { scale: 0.85, shadows: 1, bloom: true, ao: false },
  high: { scale: 1, shadows: 2, bloom: true, ao: true },
  ultra: { scale: 1, shadows: 3, bloom: true, ao: true },
};

const DEFAULT_SETTINGS = {
  quality: 'high', scale: 1, shadows: 2, bloom: true, ao: true, showFps: false, autoQuality: true,
  mouseAim: true, sensitivity: 1, invertY: false,
  volMaster: 0.8, volSfx: 1, volUi: 0.8, volEngine: 0.6, volMusic: 0.5,
};
const SCREENS = ['screen-login', 'screen-menu', 'screen-lobby', 'screen-create', 'screen-garage', 'screen-settings', 'screen-leaderboard', 'screen-clan', 'overlay-pause'];

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.view = new View(this.canvas);
    this.cam = new FollowCamera(this.view.camera);
    this.input = new Input(this.canvas);
    this.audio = new GameAudio();
    this.music = new Music(this.audio);
    this.music.onTrack = (t) => this.toast(`♪ ${t.title} — ${t.author}`);
    this.clanInfo = null;
    this.queueMode = 'any';
    this.net = new Net();
    this.screens = new Screens(this);
    this.garage = new Garage(this);
    this.showroom = new Showroom(this.view);
    this.profile = null;
    this.lobbyData = null;
    this.battle = null;
    this.dev = false;
    this.online = 1;
    this.screen = null;
    this.paused = false;
    this.isElectron = !!(window.tanki && window.tanki.isElectron);
    this.query = new URLSearchParams(location.search);
    this.autoJoined = false;
    this.lastFrame = performance.now();
    this.settingsSendTimer = null;
    this.perf = { frames: 0, t: 0, cooldown: 8 };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('tanki.settings') || '{}'); } catch (e) { saved = {}; }
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.applySettings();
    this.bindNet();
    this.input.onAction('pause', () => { if (this.battle && this.paused && this.screen === 'pause') this.closePause(); });
    const unlock = () => { this.audio.init(); this.music.resume(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('error', (e) => console.error('[tanki] error', e.message));
    requestAnimationFrame(() => this.loop());
  }

  $(id) { return document.getElementById(id); }
  equip() { const p = this.profile; return { hull: p.equipped.hull, turret: p.equipped.turret, paint: p.equipped.paint }; }

  async start() {
    const text = this.$('loading-text');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      text.textContent = 'Loading assets...';
      await Assets.init(this.view.renderer);
      text.textContent = 'Connecting to server...';
      await this.net.connect(`${proto}://${location.host}`);
      this.$('loading-fill').style.width = '60%';
      text.textContent = 'Connected';
    } catch (e) {
      text.innerHTML = 'Could not connect to the game server.<br><button class="btn" style="margin-top:12px" onclick="location.reload()">Retry</button>';
      return;
    }
    const qName = this.query.get('name');
    const saved = localStorage.getItem('tanki.name');
    if (qName) this.login(qName);
    else if (saved && this.query.get('auto')) this.login(saved);
    else { this.$('loading').classList.add('hidden'); this.showScreen('login'); }
  }

  login(name) {
    localStorage.setItem('tanki.name', name);
    this.$('loading-text').textContent = 'Loading profile...';
    this.net.send({ t: C2S.HELLO, name });
  }

  bindNet() {
    const n = this.net;
    n.on('welcome', (m) => {
      this.profile = m.profile;
      this.dev = !!m.dev;
      if (this.profile.settings && Object.keys(this.profile.settings).length && !localStorage.getItem('tanki.settings')) { this.settings = { ...this.settings, ...this.profile.settings }; this.applySettings(); }
      this.$('loading-fill').style.width = '100%';
      this.$('loading').classList.add('hidden');
      this.showroom.build(this.equip());
      this.showScreen('menu');
      this.toast(`Welcome, ${this.profile.name}!`);
    });
    n.on('lobby', (m) => {
      this.lobbyData = m;
      this.online = m.online;
      if (this.screen === 'lobby') this.screens.renderLobby();
      if (this.query.get('auto') === 'battle' && !this.autoJoined && m.battles.length) {
        this.autoJoined = true;
        const want = this.query.get('battle');
        const b = want ? m.battles.find((x) => x.map === want || x.mode === want || String(x.id) === want) || m.battles[0] : m.battles[0];
        this.joinBattle(b.id, 0);
      }
    });
    n.on('profile', (m) => {
      this.profile = m.profile;
      if (this.screen === 'menu') this.screens.renderMenu();
      else if (this.screen === 'garage') this.garage.render();
      else if (this.screen === 'lobby') this.screens.renderLobby();
      else if (this.screen === 'clan') this.screens.renderClan();
      if (this.showroom.built && !this.battle && this.screen !== 'garage') this.showroom.setTank(this.equip());
    });
    n.on('joined', (m) => this.startBattle(m));
    n.on('left', () => { this.endBattle(); this.showScreen('lobby'); });
    n.on('error', (m) => { this.toast(m.msg, 'error'); this.audio.play('error'); });
    n.on('end', (m) => { if (this.battle) { this.screens.renderResults(m.results); this.audio.play('end'); this.input.releaseLock(); } });
    n.on('restart', () => { this.screens.hideResults(); if (this.battle && !this.paused) this.hint('Click to take control'); });
    n.on('garage_ok', (m) => { this.toast(m.msg, m.ok ? '' : 'error'); this.audio.play(m.ok ? 'buy' : 'error'); });
    n.on('leaderboard', (m) => { this.leaderboard = m.top; if (this.screen === 'leaderboard') this.screens.renderLeaderboard(); });
    n.on('clan', (m) => { this.clanInfo = { clan: m.clan, list: m.list }; if (m.msg) { this.toast(m.msg, m.ok ? '' : 'error'); this.audio.play(m.ok ? 'buy' : 'error'); } if (this.screen === 'clan') this.screens.renderClan(); });
    n.on('container', (m) => { this.screens.showReward(m.reward, m.left); this.audio.play('gold'); });
    n.on('close', () => {
      this.$('loading').classList.remove('hidden');
      this.$('loading-text').innerHTML = 'Connection to the server was lost.<br><button class="btn" style="margin-top:12px" onclick="location.reload()">Reconnect</button>';
      if (this.battle) this.endBattle();
    });
  }

  showScreen(name, back) {
    for (const id of SCREENS) this.$(id).classList.add('hidden');
    this.screen = name;
    if (!name) return;
    const el = this.$(name === 'pause' ? 'overlay-pause' : 'screen-' + name);
    if (name === 'login') this.screens.renderLogin();
    else if (name === 'menu') { this.screens.renderMenu(); if (!this.battle && !this.showroom.built) this.showroom.build(this.equip()); }
    else if (name === 'lobby') { this.screens.renderLobby(); this.net.send({ t: C2S.LOBBY }); }
    else if (name === 'create') this.screens.renderCreate();
    else if (name === 'garage') this.garage.open(!!this.battle);
    else if (name === 'settings') this.screens.renderSettings(back || (this.battle ? 'pause' : 'menu'));
    else if (name === 'leaderboard') { this.screens.renderLeaderboard(); this.net.send({ t: C2S.LEADERBOARD }); }
    else if (name === 'clan') { this.screens.renderClan(); this.clanOp('list'); }
    else if (name === 'pause') this.screens.renderPause();
    if (el) el.classList.remove('hidden');
    if (!this.battle) this.music.play('menu');
    if (name !== 'pause' && name !== 'garage' && name !== 'settings') { this.input.enabled = false; }
    if (this.battle && name === 'garage') {
      // garage while in battle shows the showroom in place of the battle scene temporarily? No: keep the battle rendering, overlay panels.
    }
  }

  hint(text) { if (this.battle) this.battle.hud.setHint(text); }

  startBattle(msg) {
    if (this.battle) this.battle.destroy();
    this.showroom.built = false;
    this.screens.hideResults();
    this.paused = false;
    this.showScreen(null);
    this.showroom.cancel();
    this.music.play('battle');
    const battle = new BattleClient(this, msg);
    this.battle = battle;
    const loading = this.$('loading');
    loading.classList.remove('hidden');
    this.$('loading-fill').style.width = '70%';
    this.$('loading-text').textContent = `Loading ${msg.battle && msg.battle.name ? msg.battle.name : 'battle'}...`;
    battle.buildPromise.then(() => {
      if (this.battle !== battle) return;
      this.$('loading-fill').style.width = '100%';
      loading.classList.add('hidden');
      battle.hud.setHint('Click the screen to take control');
      this.perf = { frames: 0, t: 0, cooldown: 8 };
    });
    this.canvas.focus();
    this.audio.play('click');
  }

  endBattle() {
    if (!this.battle) return;
    this.battle.destroy();
    this.battle = null;
    this.paused = false;
    this.screens.hideResults();
    this.input.enabled = false;
    this.showroom.build(this.equip());
    this.music.play('menu');
  }

  openPause() {
    if (!this.battle || this.paused) return;
    this.paused = true;
    this.battle.setPaused(true);
    this.showScreen('pause');
  }

  closePause() {
    if (!this.battle) return;
    this.paused = false;
    this.showScreen(null);
    this.battle.setPaused(false);
    this.hint('Click the screen to take control');
  }

  joinBattle(id, team) { this.net.send({ t: C2S.JOIN, id, team }); }
  createBattle(opts) { this.net.send({ t: C2S.CREATE, opts }); }

  /** Quick play: server-side matchmaking (rank, population and battle age), optionally for one mode. */
  quickPlay(mode = this.queueMode) { this.queue(mode); }
  queue(mode) { this.net.send({ t: C2S.QUEUE, mode: mode || 'any', team: 0 }); }
  clanOp(op, data = {}) { this.net.send({ t: C2S.CLAN, op, ...data }); }

  startTraining() {
    this.createBattle({ name: `${this.profile.name}'s training`, map: 'sandbox', mode: 'DM', bots: 3, timeLimit: 0, scoreLimit: 0, maxPlayers: 4, training: true, supplies: true, drops: true });
  }
  leaveBattle() { this.net.send({ t: C2S.LEAVE }); this.endBattle(); this.showScreen('lobby'); }
  garageOp(op, kind, id, n) { this.net.send({ t: C2S.GARAGE, op, kind, id, n }); }

  setSettings(patch) {
    Object.assign(this.settings, patch);
    localStorage.setItem('tanki.settings', JSON.stringify(this.settings));
    this.applySettings();
    clearTimeout(this.settingsSendTimer);
    this.settingsSendTimer = setTimeout(() => this.net.send({ t: C2S.SETTINGS, settings: this.settings }), 800);
  }

  applySettings() {
    const s = this.settings;
    this.view.setQuality({ scale: s.scale, shadows: s.shadows, bloom: s.bloom, ao: s.ao });
    this.audio.setVolume({ master: s.volMaster, sfx: s.volSfx, ui: s.volUi, engine: s.volEngine });
    this.music.setVolume(s.volMusic ?? 0.5);
    if (this.battle) { this.battle.sky.setShadowQuality(s.shadows); this.battle.mouseAim = s.mouseAim; }
    if (this.showroom && this.showroom.sky) this.showroom.sky.setShadowQuality(s.shadows);
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    this.$('toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3200);
  }

  /** Step the quality preset down when the battle runs below 40 fps for a while. */
  autoQuality(dt) {
    if (!this.settings.autoQuality || !this.battle || !this.battle.ready || this.paused) return;
    const p = this.perf;
    if (p.cooldown > 0) { p.cooldown -= dt; return; }
    p.frames++; p.t += dt;
    if (p.t < 4) return;
    const fps = p.frames / p.t;
    p.frames = 0; p.t = 0;
    const order = ['ultra', 'high', 'medium', 'low'];
    const i = order.indexOf(this.settings.quality);
    if (fps < 40 && i >= 0 && i < order.length - 1) {
      const q = order[i + 1];
      this.setSettings({ quality: q, ...QUALITY_PRESETS[q] });
      this.toast(`Graphics set to ${q} for a smoother frame rate (Settings to change)`);
      p.cooldown = 10;
    }
  }

  quit() { if (window.tanki) window.tanki.quit(); }

  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try {
      if (this.battle) this.battle.update(dt);
      else if (this.showroom.built) this.showroom.update(dt);
      this.view.render(dt);
      this.autoQuality(dt);
    } catch (e) {
      if (!this._loggedLoopError) { this._loggedLoopError = true; console.error('[tanki] frame error', e.stack || e); }
    }
  }
}

window.app = new App();
window.app.start();
