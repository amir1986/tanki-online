// In-battle HUD (DOM overlay).
import { SUPPLIES, RANKS } from '/shared/items.mjs';
import { TEAM_NAMES } from '/shared/constants.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const fmtTime = (s) => { if (s < 0) return '∞'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${r.toString().padStart(2, '0')}`; };

export class Hud {
  constructor(root, { onChat, onSupply } = {}) {
    this.root = root;
    this.onChat = onChat;
    this.onSupply = onSupply;
    root.innerHTML = `
      <div class="damage-vignette" id="hud-vignette"></div>
      <div class="sniper-overlay" id="hud-sniper"></div>
      <div class="crosshair" id="hud-crosshair"></div>
      <div class="charge-bar" id="hud-charge"><div></div></div>
      <div class="hud-top">
        <div class="hud-timer" id="hud-timer">0:00</div>
        <div class="hud-score" id="hud-score"></div>
        <div class="hud-mode" id="hud-mode"></div>
      </div>
      <div class="hud-objectives" id="hud-objectives"></div>
      <div class="killfeed" id="hud-killfeed"></div>
      <div class="notify" id="hud-notify"></div>
      <div class="hud-respawn hidden" id="hud-respawn"></div>
      <div class="hud-bottom">
        <div class="energy-bar hidden" id="hud-energy"><div></div></div>
        <div class="hp-bar" id="hud-hp"><div></div><span class="label" id="hud-hp-label"></span></div>
        <div class="supplies" id="hud-supplies"></div>
      </div>
      <div class="hud-status" id="hud-status"></div>
      <div class="chat" id="hud-chat">
        <div class="chat-log" id="hud-chat-log"></div>
        <div class="chat-input pointer"><span class="mode" id="hud-chat-mode">ALL</span><input type="text" id="hud-chat-text" maxlength="140" placeholder="Type a message..." autocomplete="off"></div>
      </div>
      <div class="scoreboard panel hidden" id="hud-scoreboard"></div>
      <div class="hud-hint" id="hud-hint"></div>
      <div class="fps" id="hud-fps"></div>
    `;
    this.$ = (id) => root.querySelector('#' + id);
    this.supplyEls = {};
    const sup = this.$('hud-supplies');
    for (const s of SUPPLIES) {
      const el = document.createElement('div');
      el.className = 'supply pointer';
      el.innerHTML = `<span class="key">${s.key}</span><div class="icon" style="background:${hex(s.color)}"></div><span>${s.name.split(' ')[0]}</span><span class="count">0</span><div class="cd" style="height:0"></div>`;
      el.title = s.desc;
      el.addEventListener('click', () => this.onSupply && this.onSupply(s.id));
      sup.appendChild(el);
      this.supplyEls[s.id] = el;
    }
    const input = this.$('hud-chat-text');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text && this.onChat) this.onChat(text, this.chatTeam);
        input.value = '';
        this.closeChat();
        e.preventDefault();
      }
      e.stopPropagation();
    });
    this.chatOpen = false;
    this.chatTeam = false;
    this.lastHp = -1;
    this.feed = [];
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); this.closeChat(); }

  setMode(mode, name, teams) {
    this.$('hud-mode').textContent = `${name}`;
    this.teams = teams;
    this.mode = mode;
  }

  setHint(text) { this.$('hud-hint').textContent = text; }
  setFps(n) { this.$('hud-fps').textContent = n ? `${n} fps` : ''; }

  setLocal({ hp, maxHp, energy, energyKind, charge, sniper, alive }) {
    const bar = this.$('hud-hp');
    const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    bar.firstElementChild.style.width = (frac * 100).toFixed(1) + '%';
    bar.classList.toggle('low', frac < 0.3);
    this.$('hud-hp-label').textContent = alive ? `${Math.round(hp)} / ${maxHp}` : 'DESTROYED';
    const en = this.$('hud-energy');
    if (energyKind) {
      en.classList.remove('hidden');
      en.classList.toggle('heat', energyKind === 'heat');
      en.firstElementChild.style.width = Math.max(0, Math.min(100, energy)) + '%';
    } else en.classList.add('hidden');
    const ch = this.$('hud-charge');
    if (charge > 0 && charge < 1.001 && (energyKind === 'charge')) { ch.classList.add('on'); ch.firstElementChild.style.width = (charge * 100) + '%'; }
    else ch.classList.remove('on');
    this.$('hud-sniper').classList.toggle('on', !!sniper);
    this.$('hud-crosshair').style.display = alive ? '' : 'none';
  }

  setSupplies(counts, cooldowns, now, active) {
    for (const s of SUPPLIES) {
      const el = this.supplyEls[s.id];
      const n = counts[s.id] | 0;
      el.querySelector('.count').textContent = n;
      el.classList.toggle('empty', n <= 0);
      const until = cooldowns[s.id] || 0, total = cooldowns[s.id + '_total'] || 1;
      const left = Math.max(0, until - now);
      el.querySelector('.cd').style.height = left > 0 ? `${Math.min(100, (left / total) * 100)}%` : '0';
      el.classList.toggle('active', !!active[s.id]);
    }
  }

  setTimer(left, running) {
    const el = this.$('hud-timer');
    el.textContent = running ? fmtTime(left) : 'ENDED';
    el.style.color = running && left >= 0 && left < 60 ? '#ff8a80' : '';
  }

  setScores(mode, teamScore, limit, leader) {
    const el = this.$('hud-score');
    if (this.teams) el.innerHTML = `<span class="r">${teamScore[0]}</span><span class="muted">:</span><span class="b">${teamScore[1]}</span>${limit ? `<span class="muted small">/ ${limit}</span>` : ''}`;
    else el.innerHTML = leader ? `<span>${esc(leader.name)}</span><span class="muted small">${leader.kills} kills${limit ? ' / ' + limit : ''}</span>` : '';
  }

  setObjectives(mode, flags, points, myTeam, roster, extra) {
    const el = this.$('hud-objectives');
    if (mode === 'JGR') {
      if (extra && extra.name) {
        const frac = extra.maxHp ? Math.max(0, Math.min(1, extra.hp / extra.maxHp)) : 0;
        el.innerHTML = `<div class="flag-status"><span style="color:var(--gold);font-weight:800">JUGGERNAUT</span><b>${esc(extra.name)}</b>${extra.me ? '<span class="muted">(you)</span>' : ''}<div class="hp-bar" style="width:140px;height:12px"><div style="width:${(frac * 100).toFixed(0)}%;background:linear-gradient(#ffd54f,#c69a12)"></div></div></div>`;
      } else el.innerHTML = '<div class="flag-status"><span class="muted">Waiting for a Juggernaut...</span></div>';
      return;
    }
    if (mode === 'CTF' && flags) {
      const line = (color, f) => {
        const team = color === 'r' ? 1 : 2;
        const st = f[0];
        let txt = 'At base';
        if (st === 1) { const c = roster.get(f[4]); txt = `Taken by ${c ? esc(c.name) : '?'}`; }
        else if (st === 2) txt = 'Dropped';
        return `<div class="flag-status"><div class="f" style="background:${team === 1 ? '#e53935' : '#1e88e5'}"></div><b style="color:${team === 1 ? '#ff8a80' : '#90caf9'}">${TEAM_NAMES[team]} flag</b><span class="muted">${txt}</span></div>`;
      };
      el.innerHTML = line('r', flags.r) + line('b', flags.b);
    } else if (mode === 'CP' && points) {
      el.innerHTML = `<div class="cp-status">${points.map((p, i) => `<div class="pt ${p.owner === 1 ? 'r' : p.owner === 2 ? 'b' : ''}" title="${p.id}">${p.id}${p.cap > 0 ? `<svg viewBox="0 0 36 36" style="position:absolute;inset:-2px;width:34px;height:34px"><circle cx="18" cy="18" r="16" fill="none" stroke="${p.capTeam === 1 ? '#ff8a80' : '#90caf9'}" stroke-width="3" stroke-dasharray="${(p.cap * 100.5).toFixed(1)} 100.5" transform="rotate(-90 18 18)"/></svg>` : ''}</div>`).join('')}</div>`;
    } else el.innerHTML = '';
  }

  killfeed(html) {
    const el = this.$('hud-killfeed');
    const d = document.createElement('div');
    d.innerHTML = html;
    el.appendChild(d);
    this.feed.push({ el: d, t: performance.now() });
    while (this.feed.length > 6) { const f = this.feed.shift(); f.el.remove(); }
    setTimeout(() => { d.remove(); this.feed = this.feed.filter((f) => f.el !== d); }, 7000);
  }

  notify(text, cls = '') {
    const el = this.$('hud-notify');
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    el.appendChild(d);
    while (el.children.length > 3) el.firstElementChild.remove();
    setTimeout(() => d.remove(), 2600);
  }

  chat({ name, team, msg, sys, teamOnly, me }) {
    const log = this.$('hud-chat-log');
    const d = document.createElement('div');
    if (sys) { d.className = 'sys'; d.textContent = msg; }
    else {
      const cls = team === 1 ? 'r' : team === 2 ? 'b' : '';
      d.innerHTML = `${teamOnly ? '<span class="team">[TEAM] </span>' : ''}<b class="${cls}">${esc(name)}${me ? ' (you)' : ''}:</b> ${esc(msg)}`;
    }
    log.appendChild(d);
    while (log.children.length > 60) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    if (!this.chatOpen) setTimeout(() => { d.style.transition = 'opacity 1s'; d.style.opacity = '0.35'; }, 9000);
  }

  openChat(team) {
    this.chatOpen = true;
    this.chatTeam = !!team && this.teams;
    const c = this.$('hud-chat');
    c.classList.add('open');
    this.$('hud-chat-mode').textContent = this.chatTeam ? 'TEAM' : 'ALL';
    for (const d of this.$('hud-chat-log').children) d.style.opacity = '1';
    const input = this.$('hud-chat-text');
    input.value = '';
    input.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.$('hud-chat').classList.remove('open');
    this.$('hud-chat-text').blur();
  }

  setScoreboard(visible, roster, scores, myId, mode, teamScore) {
    const el = this.$('hud-scoreboard');
    if (!visible) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const rows = [...roster.values()].map((r) => ({ ...r, ...(scores.get(r.id) || { score: 0, kills: 0, deaths: 0 }) }));
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    const row = (r) => `<tr class="${r.id === myId ? 'me' : ''} ${r.alive === false ? 'dead' : ''}"><td>${esc(r.name)}${r.bot ? ' <span class="muted small">bot</span>' : ''}</td><td class="muted small">${RANKS[r.rank]?.name || ''}</td><td class="muted small">${r.hull} / ${r.turret}</td><td class="right"><b>${r.score}</b></td><td class="right">${r.kills}</td><td class="right">${r.deaths}</td></tr>`;
    const head = `<tr><th>Player</th><th>Rank</th><th>Setup</th><th class="right">Score</th><th class="right">Kills</th><th class="right">Deaths</th></tr>`;
    let body;
    if (this.teams) {
      body = [1, 2].map((t) => `<tr class="team-head ${t === 1 ? 'r' : 'b'}"><td colspan="3">${TEAM_NAMES[t]} team</td><td class="right" colspan="3">${teamScore ? teamScore[t - 1] : ''}</td></tr>` + rows.filter((r) => r.team === t).map(row).join('')).join('');
    } else body = rows.map(row).join('');
    el.innerHTML = `<h2>${mode} — Scoreboard</h2><table>${head}${body}</table>`;
  }

  setRespawn(seconds, killer, hintText) {
    const el = this.$('hud-respawn');
    if (seconds == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `${killer ? `Destroyed by <b>${esc(killer)}</b><br>` : 'Destroyed<br>'}<span class="muted">Respawn in</span> <b>${Math.max(0, Math.ceil(seconds))}</b>${hintText ? `<div class="small muted">${hintText}</div>` : ''}`;
  }

  damageFlash() {
    const v = this.$('hud-vignette');
    v.classList.add('hit');
    clearTimeout(this._vt);
    this._vt = setTimeout(() => v.classList.remove('hit'), 120);
  }

  hitMarker() {
    const c = this.$('hud-crosshair');
    c.classList.add('hit');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => c.classList.remove('hit'), 120);
  }

  setStatus(items) {
    const el = this.$('hud-status');
    el.innerHTML = items.map((i) => `<div class="${i.cls}">${esc(i.text)}</div>`).join('');
  }
}
