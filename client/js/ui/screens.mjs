// Menu screens: login, main menu, lobby, create battle, settings, pause, results.
import { RANKS, rankProgress } from '/shared/items.mjs';
import { MODES, BATTLE_DEFAULTS, GAME_VERSION, TEAM_NAMES } from '/shared/constants.mjs';
import { buildMap, MAP_LIST } from '/shared/maps.mjs';
import { KEY_LABELS, DEFAULT_BINDS } from '../input.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => { if (s < 0) return '∞'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${r.toString().padStart(2, '0')}`; };
const thumbs = new Map();

/** Top-down map thumbnail. */
export function mapThumb(id, size = 160) {
  if (thumbs.has(id)) return thumbs.get(id);
  const map = buildMap(id);
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const theme = { grass: ['#4f7a2e', '#9ccc5a'], sand: ['#b89e68', '#e6d3a3'], snow: ['#9fb4c4', '#ffffff'], asphalt: ['#2e3136', '#6d7278'] }[map.theme.ground] || ['#333', '#999'];
  const img = ctx.createImageData(size, size);
  const hex2 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = hex2(theme[0]), b = hex2(theme[1]);
  const range = Math.max(0.01, map.maxH - map.minH);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = -map.halfW + (x / (size - 1)) * map.size[0], wz = -map.halfL + (y / (size - 1)) * map.size[1];
    const t = (map.heightAt(wx, wz) - map.minH) / range;
    const i = (y * size + x) * 4;
    img.data[i] = a[0] + (b[0] - a[0]) * t; img.data[i + 1] = a[1] + (b[1] - a[1]) * t; img.data[i + 2] = a[2] + (b[2] - a[2]) * t; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const sx = size / map.size[0], sz = size / map.size[1];
  for (const p of map.props) {
    if (p.kind === 'wall') continue;
    ctx.save();
    ctx.translate((p.pos[0] + map.halfW) * sx, (p.pos[2] + map.halfL) * sz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = p.kind === 'tree' ? 'rgba(20,80,20,0.8)' : p.kind === 'rock' ? 'rgba(70,70,70,0.8)' : p.kind === 'ramp' ? 'rgba(200,200,200,0.5)' : p.mat === 'building' ? 'rgba(40,45,55,0.9)' : 'rgba(90,90,100,0.85)';
    ctx.fillRect(-p.size[0] / 2 * sx, -p.size[2] / 2 * sz, p.size[0] * sx, p.size[2] * sz);
    ctx.restore();
  }
  const dot = (pos, color, r = 4) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc((pos[0] + map.halfW) * sx, (pos[2] + map.halfL) * sz, r, 0, Math.PI * 2); ctx.fill(); };
  dot(map.flags.red, '#e53935', 5); dot(map.flags.blue, '#1e88e5', 5);
  for (const p of map.points) dot(p.pos, '#ffffff', 3);
  const url = c.toDataURL();
  thumbs.set(id, url);
  return url;
}

export class Screens {
  constructor(app) {
    this.app = app;
    this.$ = (id) => document.getElementById(id);
    this.selectedBattle = null;
    this.selectedTeam = 0;
    this.pendingResultsTimer = null;
  }

  topbar() {
    const p = this.app.profile;
    const rp = rankProgress(p.xp);
    return `<div class="topbar">
      <div class="logo">TANKI <span>ONLINE</span></div>
      <div class="grow"></div>
      <div class="rank-badge"><div class="rank-icon">${rp.rank.index}</div><div><div><b>${esc(p.name)}</b> <span class="muted small">${esc(rp.rank.name)}</span></div><div class="xp-bar" title="${p.xp} XP"><div style="width:${(rp.frac * 100).toFixed(1)}%"></div></div><div class="small muted">${rp.next ? `${rp.toNext} XP to ${esc(rp.next.name)}` : 'Max rank'}</div></div></div>
      <div class="crystals" title="Crystals">${p.crystals}</div>
      <div class="muted small">${this.app.online || 1} online</div>
    </div>`;
  }

  renderLogin() {
    const saved = localStorage.getItem('tanki.name') || '';
    this.$('screen-login').innerHTML = `<div class="panel login-box">
      <div class="logo">TANKI <span>ONLINE</span></div>
      <p class="muted">Enter your nickname to enter the battle</p>
      <input type="text" id="login-name" maxlength="16" placeholder="Nickname" value="${esc(saved)}">
      <button class="btn big wide" id="login-btn">Enter</button>
      <p class="small muted" style="margin-top:14px">3-16 characters. Your progress is saved under this name.</p>
    </div>`;
    const input = this.$('login-name');
    const go = () => { const n = input.value.trim(); if (n.length >= 3) this.app.login(n); else this.app.toast('Nickname must be at least 3 characters', 'error'); };
    this.$('login-btn').onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => input.focus(), 50);
  }

  renderMenu() {
    const app = this.app;
    this.$('screen-menu').innerHTML = `${this.topbar()}
      <div class="menu-main">
        <button class="btn big" id="menu-play">▶ Play</button>
        <button class="btn secondary big" id="menu-garage">Garage</button>
        <button class="btn secondary big" id="menu-settings">Settings</button>
        ${app.isElectron ? '<button class="btn secondary big" id="menu-exit">Exit</button>' : ''}
      </div>
      <div class="menu-footer"><span>v${GAME_VERSION}${app.dev ? ' · dev mode (type /help in battle chat)' : ''}</span><span>Battles: ${app.profile.stats.battles} · Kills: ${app.profile.stats.kills} · Flags: ${app.profile.stats.flags} · Gold boxes: ${app.profile.stats.gold}</span></div>`;
    this.$('menu-play').onclick = () => { app.audio.play('click'); app.showScreen('lobby'); };
    this.$('menu-garage').onclick = () => { app.audio.play('click'); app.showScreen('garage'); };
    this.$('menu-settings').onclick = () => { app.audio.play('click'); app.showScreen('settings'); };
    if (app.isElectron) this.$('menu-exit').onclick = () => app.quit();
  }

  renderLobby() {
    const app = this.app;
    const lobby = app.lobbyData;
    const battles = lobby ? lobby.battles : [];
    if (this.selectedBattle && !battles.some((b) => b.id === this.selectedBattle)) this.selectedBattle = null;
    if (!this.selectedBattle && battles.length) this.selectedBattle = battles[0].id;
    const sel = battles.find((b) => b.id === this.selectedBattle);
    const card = (b) => `<div class="battle-card ${b.id === this.selectedBattle ? 'selected' : ''}" data-id="${b.id}" style="${b.id === this.selectedBattle ? 'border-color:var(--accent)' : ''}">
      <div class="mode ${b.mode}">${b.mode}</div>
      <div><div class="name">${esc(b.name)}</div><div class="small muted">${esc(b.mapName)} · ${b.timeLimit ? b.timeLimit + ' min' : 'no limit'}${b.scoreLimit ? ' · limit ' + b.scoreLimit : ''}${b.friendlyFire ? ' · FF' : ''}</div></div>
      <div class="teams">${MODES[b.mode].teams ? `<span class="r">${b.red}</span><span class="muted">vs</span><span class="b">${b.blue}</span>` : `<span>${b.players} tanks</span>`}</div>
      <div class="muted small">${b.humans} player${b.humans === 1 ? '' : 's'} · ${b.bots} bots</div>
      <div class="right">${b.state === 'ended' ? '<span class="muted">restarting</span>' : `<b>${fmtTime(b.timeLeft)}</b>`}<div class="small muted">${b.players}/${b.max}</div></div>
    </div>`;
    const teams = sel && MODES[sel.mode].teams;
    this.$('screen-lobby').innerHTML = `${this.topbar()}
      <div class="lobby-body">
        <div class="battle-list" id="battle-list">${battles.map(card).join('') || '<div class="muted">No battles yet. Create one!</div>'}</div>
        <div class="lobby-side">
          ${sel ? `<div class="panel">
            <img class="map-thumb" src="${mapThumb(sel.map)}" alt="">
            <h2 style="margin-top:10px">${esc(sel.name)}</h2>
            <div class="muted small">${esc(sel.mapName)} · ${MODES[sel.mode].name}</div>
            <p class="small muted">${esc(MODES[sel.mode].desc)}</p>
            <div class="small muted">Supplies: ${sel.supplies ? 'on' : 'off'} · Drops: ${sel.drops ? 'on' : 'off'} · Friendly fire: ${sel.friendlyFire ? 'on' : 'off'}</div>
            ${teams ? `<div class="team-pick" style="margin-top:12px">
              <button class="btn red grow" id="join-red">Red (${sel.red})</button>
              <button class="btn blue grow" id="join-blue">Blue (${sel.blue})</button>
            </div><button class="btn wide" id="join-auto" style="margin-top:8px">Auto team</button>` : `<button class="btn big wide" id="join-auto" style="margin-top:12px">Join battle</button>`}
          </div>` : ''}
          <button class="btn secondary wide" id="lobby-create">+ Create battle</button>
          <button class="btn secondary wide" id="lobby-back">Back</button>
        </div>
      </div>`;
    for (const el of this.$('battle-list').querySelectorAll('.battle-card')) {
      el.onclick = () => { this.selectedBattle = +el.dataset.id; app.audio.play('click'); this.renderLobby(); };
      el.ondblclick = () => { this.selectedBattle = +el.dataset.id; app.joinBattle(this.selectedBattle, 0); };
    }
    if (sel) {
      const j = (team) => () => { app.audio.play('click'); app.joinBattle(sel.id, team); };
      if (teams) { this.$('join-red').onclick = j(1); this.$('join-blue').onclick = j(2); }
      this.$('join-auto').onclick = j(0);
    }
    this.$('lobby-create').onclick = () => { app.audio.play('click'); app.showScreen('create'); };
    this.$('lobby-back').onclick = () => { app.audio.play('click'); app.showScreen('menu'); };
  }

  renderCreate() {
    const app = this.app;
    const d = BATTLE_DEFAULTS;
    this.$('screen-create').innerHTML = `<div class="panel create-box">
      <h2>Create battle</h2>
      <label class="field">Name<input type="text" id="cb-name" maxlength="32" value="${esc(app.profile.name)}'s battle"></label>
      <label class="field">Map<select id="cb-map">${MAP_LIST.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field">Mode<select id="cb-mode">${Object.values(MODES).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field">Time limit (minutes, 0 = none)<input type="number" id="cb-time" min="0" max="60" value="${d.timeLimit}"></label>
      <label class="field">Score limit (0 = none)<input type="number" id="cb-score" min="0" max="999" value="${d.scoreLimit}"></label>
      <label class="field">Max players<input type="number" id="cb-max" min="2" max="20" value="${d.maxPlayers}"></label>
      <label class="field">Bots<input type="number" id="cb-bots" min="0" max="19" value="${d.bots}"></label>
      <div class="row" style="gap:18px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" id="cb-ff"> Friendly fire</label>
        <label class="check"><input type="checkbox" id="cb-sup" checked> Supplies</label>
        <label class="check"><input type="checkbox" id="cb-drops" checked> Drops</label>
      </div>
      <div class="actions"><button class="btn secondary" id="cb-cancel">Cancel</button><button class="btn" id="cb-go">Create & join</button></div>
    </div>`;
    this.$('cb-cancel').onclick = () => { app.audio.play('click'); app.showScreen('lobby'); };
    this.$('cb-go').onclick = () => {
      app.audio.play('click');
      app.createBattle({
        name: this.$('cb-name').value, map: this.$('cb-map').value, mode: this.$('cb-mode').value,
        timeLimit: +this.$('cb-time').value, scoreLimit: +this.$('cb-score').value, maxPlayers: +this.$('cb-max').value, bots: +this.$('cb-bots').value,
        friendlyFire: this.$('cb-ff').checked, supplies: this.$('cb-sup').checked, drops: this.$('cb-drops').checked,
      });
    };
  }

  renderSettings(backTo = 'menu') {
    const app = this.app, s = app.settings;
    const binds = Object.entries(DEFAULT_BINDS).map(([k, v]) => `<div><b>${esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))}</b> ${v.map((c) => KEY_LABELS[c] || c).join(' / ')}</div>`).join('');
    this.$('screen-settings').innerHTML = `<div class="panel settings-box">
      <h2>Settings</h2>
      <h3>Graphics</h3>
      <div class="grid">
        <label class="field">Quality preset<select id="st-quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
        <label class="field">Resolution scale: <span id="st-scale-v">${s.scale}</span><input type="range" id="st-scale" min="0.5" max="1" step="0.05" value="${s.scale}"></label>
        <label class="field">Shadows<select id="st-shadows"><option value="0">Off</option><option value="1">Low</option><option value="2">High</option><option value="3">Ultra</option></select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="st-bloom" ${s.bloom ? 'checked' : ''}> Bloom glow</label>
        <label class="check" style="align-self:end"><input type="checkbox" id="st-ao" ${s.ao ? 'checked' : ''}> Ambient occlusion</label>
        <label class="check" style="align-self:end"><input type="checkbox" id="st-fps" ${s.showFps ? 'checked' : ''}> Show FPS</label>
      </div>
      <h3>Controls</h3>
      <div class="grid">
        <label class="check"><input type="checkbox" id="st-mouse" ${s.mouseAim ? 'checked' : ''}> Mouse aiming (turret follows mouse)</label>
        <label class="check"><input type="checkbox" id="st-invert" ${s.invertY ? 'checked' : ''}> Invert mouse Y</label>
        <label class="field">Mouse sensitivity: <span id="st-sens-v">${s.sensitivity}</span><input type="range" id="st-sens" min="0.2" max="3" step="0.1" value="${s.sensitivity}"></label>
      </div>
      <div class="keys">${binds}</div>
      <h3>Audio</h3>
      <div class="grid">
        <label class="field">Master: <span id="st-vm-v">${Math.round(s.volMaster * 100)}%</span><input type="range" id="st-vm" min="0" max="1" step="0.05" value="${s.volMaster}"></label>
        <label class="field">Effects: <span id="st-vs-v">${Math.round(s.volSfx * 100)}%</span><input type="range" id="st-vs" min="0" max="1" step="0.05" value="${s.volSfx}"></label>
        <label class="field">Engine: <span id="st-ve-v">${Math.round(s.volEngine * 100)}%</span><input type="range" id="st-ve" min="0" max="1" step="0.05" value="${s.volEngine}"></label>
        <label class="field">Interface: <span id="st-vu-v">${Math.round(s.volUi * 100)}%</span><input type="range" id="st-vu" min="0" max="1" step="0.05" value="${s.volUi}"></label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="st-back">Done</button></div>
    </div>`;
    this.$('st-quality').value = s.quality;
    this.$('st-shadows').value = String(s.shadows);
    const apply = () => {
      app.setSettings({
        quality: this.$('st-quality').value, scale: +this.$('st-scale').value, shadows: +this.$('st-shadows').value, bloom: this.$('st-bloom').checked, ao: this.$('st-ao').checked, showFps: this.$('st-fps').checked,
        mouseAim: this.$('st-mouse').checked, invertY: this.$('st-invert').checked, sensitivity: +this.$('st-sens').value,
        volMaster: +this.$('st-vm').value, volSfx: +this.$('st-vs').value, volEngine: +this.$('st-ve').value, volUi: +this.$('st-vu').value,
      });
      this.$('st-scale-v').textContent = this.$('st-scale').value;
      this.$('st-sens-v').textContent = this.$('st-sens').value;
      for (const [id, k] of [['st-vm', 'volMaster'], ['st-vs', 'volSfx'], ['st-ve', 'volEngine'], ['st-vu', 'volUi']]) this.$(id + '-v').textContent = Math.round(app.settings[k] * 100) + '%';
    };
    this.$('st-quality').onchange = () => {
      const q = this.$('st-quality').value;
      const preset = { low: [0.6, 0, false, false], medium: [0.85, 1, true, false], high: [1, 2, true, true], ultra: [1, 3, true, true] }[q];
      this.$('st-scale').value = preset[0]; this.$('st-shadows').value = String(preset[1]); this.$('st-bloom').checked = preset[2]; this.$('st-ao').checked = preset[3];
      apply();
    };
    for (const id of ['st-scale', 'st-shadows', 'st-bloom', 'st-ao', 'st-fps', 'st-mouse', 'st-invert', 'st-sens', 'st-vm', 'st-vs', 'st-ve', 'st-vu']) this.$(id).oninput = () => { if (id !== 'st-quality') { apply(); } };
    this.$('st-back').onclick = () => { app.audio.play('click'); app.showScreen(backTo); };
  }

  renderPause() {
    const app = this.app;
    const b = app.battle;
    const teams = b && b.teams;
    this.$('overlay-pause').innerHTML = `<div class="panel pause-box">
      <h2>Paused</h2>
      <button class="btn big wide" id="pz-resume">Resume</button>
      <button class="btn secondary wide" id="pz-garage">Garage</button>
      <button class="btn secondary wide" id="pz-settings">Settings</button>
      ${teams ? `<div class="team-pick"><button class="btn red grow" id="pz-red">Join Red</button><button class="btn blue grow" id="pz-blue">Join Blue</button></div>` : ''}
      <button class="btn danger wide" id="pz-leave">Leave battle</button>
    </div>`;
    this.$('pz-resume').onclick = () => app.closePause();
    this.$('pz-garage').onclick = () => { app.audio.play('click'); app.showScreen('garage'); };
    this.$('pz-settings').onclick = () => { app.audio.play('click'); app.showScreen('settings', 'pause'); };
    if (teams) { this.$('pz-red').onclick = () => { app.net.send({ t: 'team', team: 1 }); app.closePause(); }; this.$('pz-blue').onclick = () => { app.net.send({ t: 'team', team: 2 }); app.closePause(); }; }
    this.$('pz-leave').onclick = () => { app.audio.play('click'); app.leaveBattle(); };
  }

  renderResults(results) {
    const app = this.app;
    const b = app.battle;
    const myId = b ? b.myId : -1;
    const me = results.players.find((p) => p.id === myId);
    let winner;
    if (results.teams) winner = results.winner === 0 ? 'Draw!' : `${TEAM_NAMES[results.winner]} team wins!`;
    else { const w = results.players.find((p) => p.id === results.winner); winner = w ? `${esc(w.name)} wins!` : 'Battle over'; }
    const row = (p) => `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)}${p.bot ? ' <span class="muted small">bot</span>' : ''}</td><td class="${p.team === 1 ? 'r' : p.team === 2 ? 'b' : ''}" style="color:${p.team === 1 ? '#ff8a80' : p.team === 2 ? '#90caf9' : ''}">${results.teams ? TEAM_NAMES[p.team] : ''}</td><td class="right"><b>${p.score}</b></td><td class="right">${p.kills}</td><td class="right">${p.deaths}</td><td class="right">${p.caps || ''}</td><td class="right">${p.crystals}</td></tr>`;
    this.$('overlay-results').innerHTML = `<div class="panel results-box">
      <div class="winner" style="color:${results.teams ? (results.winner === 1 ? '#ff8a80' : results.winner === 2 ? '#90caf9' : '#fff') : 'var(--accent)'}">${winner}</div>
      ${results.teams ? `<div class="hud-score" style="justify-content:center;margin-bottom:8px"><span class="r">${results.teamScore[1]}</span><span class="muted">:</span><span class="b">${results.teamScore[2]}</span></div>` : ''}
      ${me ? `<div class="reward"><span>Your score: <b>${me.score}</b></span><span class="crystals">+${me.crystals}</span><span style="color:var(--accent)">+${me.xp} XP</span>${me.won ? '<span style="color:var(--gold)">Victory bonus!</span>' : ''}</div>` : ''}
      <div class="scoreboard" style="position:static;transform:none;width:auto"><table><tr><th>Player</th><th>Team</th><th class="right">Score</th><th class="right">Kills</th><th class="right">Deaths</th><th class="right">Caps</th><th class="right">Crystals</th></tr>${results.players.map(row).join('')}</table></div>
      <div class="row" style="justify-content:space-between;margin-top:14px"><span class="muted">Next battle in <b id="res-count">${results.restartIn}</b>s</span><button class="btn secondary" id="res-leave">Leave to lobby</button></div>
    </div>`;
    this.$('overlay-results').classList.remove('hidden');
    this.$('res-leave').onclick = () => { app.audio.play('click'); app.leaveBattle(); };
    clearInterval(this.pendingResultsTimer);
    let left = results.restartIn;
    this.pendingResultsTimer = setInterval(() => { left--; const el = this.$('res-count'); if (el) el.textContent = Math.max(0, left); if (left <= 0) clearInterval(this.pendingResultsTimer); }, 1000);
  }

  hideResults() {
    clearInterval(this.pendingResultsTimer);
    this.$('overlay-results').classList.add('hidden');
  }
}
