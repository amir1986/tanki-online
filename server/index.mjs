// Game server: static file hosting for the client + WebSocket battle server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.mjs';
import { ProfileStore, sanitizeName } from './profiles.mjs';
import { garageOp, equipFromProfile } from './garage.mjs';
import { ClanStore } from './clans.mjs';
import { C2S, S2C } from '../shared/protocol.mjs';
import { GAME_VERSION, BATTLE_DEFAULTS, MODES, TEAM, CLAN_CREATE_COST } from '../shared/constants.mjs';
import { MAP_LIST } from '../shared/maps.mjs';
import { rankForXp } from '../shared/items.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.hdr': 'image/vnd.radiance', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain',
};

const STATIC_ROUTES = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/vendor/cannon-es/', path.join(ROOT, 'node_modules', 'cannon-es')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/client/', path.join(ROOT, 'client')],
];

function resolveStatic(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(ROOT, 'client', 'index.html');
  for (const [prefix, dir] of STATIC_ROUTES) {
    if (urlPath.startsWith(prefix)) {
      const rel = urlPath.slice(prefix.length);
      const file = path.normalize(path.join(dir, rel));
      if (!file.startsWith(dir)) return null;
      return file;
    }
  }
  // fall back to client dir for /js, /css etc.
  const file = path.normalize(path.join(ROOT, 'client', urlPath));
  if (!file.startsWith(path.join(ROOT, 'client'))) return null;
  return file;
}

const DEFAULT_ROOMS = [
  { name: 'Sandbox Deathmatch', map: 'sandbox', mode: 'DM', bots: 7, timeLimit: 10, scoreLimit: 30 },
  { name: 'Polygon Team Battle', map: 'polygon', mode: 'TDM', bots: 9, timeLimit: 12, scoreLimit: 40 },
  { name: 'Silence Flags', map: 'silence', mode: 'CTF', bots: 9, timeLimit: 15, scoreLimit: 5 },
  { name: 'Kungur Control', map: 'kungur', mode: 'CP', bots: 9, timeLimit: 15, scoreLimit: 30 },
  { name: 'Sandbox Flags', map: 'sandbox', mode: 'CTF', bots: 7, timeLimit: 12, scoreLimit: 5 },
  { name: 'Polygon Free For All', map: 'polygon', mode: 'DM', bots: 9, timeLimit: 10, scoreLimit: 40 },
  { name: 'Kungur Warzone', map: 'kungur', mode: 'TDM', bots: 11, timeLimit: 15, scoreLimit: 50 },
  { name: 'Silence Control', map: 'silence', mode: 'CP', bots: 7, timeLimit: 12, scoreLimit: 25 },
  { name: 'Sandbox Juggernaut', map: 'sandbox', mode: 'JGR', bots: 7, timeLimit: 10, scoreLimit: 40 },
  { name: 'Ruins Flags', map: 'ruins', mode: 'CTF', bots: 9, timeLimit: 15, scoreLimit: 5 },
  { name: 'Canyon Team Battle', map: 'canyon', mode: 'TDM', bots: 9, timeLimit: 12, scoreLimit: 40 },
  { name: 'Frontier Control', map: 'frontier', mode: 'CP', bots: 9, timeLimit: 15, scoreLimit: 30 },
  { name: 'Ruins Juggernaut', map: 'ruins', mode: 'JGR', bots: 9, timeLimit: 10, scoreLimit: 40 },
  { name: 'Arena Rugby', map: 'arena', mode: 'RGB', bots: 9, timeLimit: 12, scoreLimit: 5 },
  { name: 'Highland Siege', map: 'highland', mode: 'SGE', bots: 9, timeLimit: 20, scoreLimit: 3 },
  { name: 'Oasis Flags', map: 'oasis', mode: 'CTF', bots: 9, timeLimit: 15, scoreLimit: 5 },
  { name: 'Forest Hunt', map: 'forest', mode: 'DM', bots: 9, timeLimit: 10, scoreLimit: 30 },
  { name: 'Factory Control', map: 'factory', mode: 'CP', bots: 9, timeLimit: 12, scoreLimit: 30 },
  { name: 'Factory Rugby', map: 'factory', mode: 'RGB', bots: 9, timeLimit: 12, scoreLimit: 5 },
];

export class GameServer {
  constructor({ dataDir, dev = false, log = console.log } = {}) {
    this.dev = dev;
    this.log = log;
    this.profiles = new ProfileStore(path.join(dataDir, 'profiles'));
    this.clans = new ClanStore(dataDir);
    this.rooms = new Map();
    this.quickCount = 0;
    this.clients = new Set();
    this.nextClientId = 1;
    this.lastTick = Date.now();
    for (const r of DEFAULT_ROOMS) this.createRoom(r, null);
    this.timer = setInterval(() => this.tick(), 16);
    this.lobbyTimer = setInterval(() => this.broadcastLobby(), 2000);
    this.saveTimer = setInterval(() => this.profiles.flush(), 5000);
  }

  createRoom(opts, creator) {
    const room = new Room({ ...opts, creator }, {
      onProfile: (p) => { this.profiles.markDirty(p.profile); if (p.client) p.client.sendProfile(); },
      onEnd: () => { this.profiles.flush(); },
    });
    this.rooms.set(room.id, room);
    return room;
  }

  tick() {
    const now = Date.now();
    const elapsed = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    for (const room of this.rooms.values()) {
      try { room.tick(elapsed); }
      catch (e) { this.log('room tick error', room.id, e.stack || e); }
    }
    // remove abandoned custom rooms
    for (const room of [...this.rooms.values()]) {
      if (room.creator && room.humans().length === 0 && Date.now() - (room.lastHumanAt || room.created) > 120000) {
        room.destroy();
        this.rooms.delete(room.id);
      }
    }
  }

  lobby() {
    return {
      t: S2C.LOBBY,
      battles: [...this.rooms.values()].map((r) => r.summary()),
      maps: MAP_LIST,
      modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, teams: m.teams, desc: m.desc })),
      defaults: BATTLE_DEFAULTS,
      online: this.clients.size,
    };
  }

  leaderboard() {
    const byName = new Map();
    for (const p of this.profiles.list()) byName.set(p.name.toLowerCase(), p);
    for (const [k, p] of this.profiles.cache) byName.set(k, { name: p.name, xp: p.xp, crystals: p.crystals, stats: p.stats });
    return [...byName.values()]
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 50)
      .map((p) => ({ name: p.name, xp: p.xp, crystals: p.crystals, rank: rankForXp(p.xp).index, kills: p.stats?.kills || 0, battles: p.stats?.battles || 0, wins: p.stats?.wins || 0, flags: p.stats?.flags || 0, gold: p.stats?.gold || 0 }));
  }

  /** Matchmaking: place a player into the best running battle of the wanted mode, or spin one up. */
  matchmake(client, mode) {
    const myRank = rankForXp(client.profile.xp).index;
    const wanted = mode && mode !== 'any' && MODES[mode] ? mode : null;
    let best = null, bestScore = -Infinity;
    for (const r of this.rooms.values()) {
      if (r.opts.training || r.state !== 'running') continue;
      if (wanted && r.mode !== wanted) continue;
      if (r.humans().length >= r.opts.maxPlayers) continue;
      if (r.creator && r.humans().length === 0) continue;
      const humans = r.humans();
      const avgRank = humans.length ? humans.reduce((s, h) => s + h.rank, 0) / humans.length : myRank;
      const score = humans.length * 10 - Math.abs(avgRank - myRank) * 1.5 - Math.abs(r.players.size - 9) + (r.timeLeft < 0 || r.timeLeft > 120 ? 0 : -50);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (best && (bestScore > -20 || !wanted)) return best;
    // nothing suitable: create a fresh battle on a random map
    const modeId = wanted || ['DM', 'TDM', 'CTF', 'CP', 'JGR', 'RGB', 'SGE'][Math.floor(Math.random() * 7)];
    const maps = MAP_LIST.map((m) => m.id);
    const map = modeId === 'RGB' ? (Math.random() < 0.5 ? 'arena' : maps[Math.floor(Math.random() * maps.length)]) : modeId === 'SGE' ? (Math.random() < 0.5 ? 'highland' : maps[Math.floor(Math.random() * maps.length)]) : maps[Math.floor(Math.random() * maps.length)];
    const limits = { DM: 30, TDM: 40, CTF: 5, CP: 30, JGR: 40, RGB: 5, SGE: 3 };
    return this.createRoom({ name: `Quick battle #${++this.quickCount}`, map, mode: modeId, bots: 7 + Math.floor(Math.random() * 3), timeLimit: 10, scoreLimit: limits[modeId], matchmade: true }, 'matchmaking');
  }

  clanClients(clan) {
    const names = new Set(clan.members.map((m) => m.toLowerCase()));
    return [...this.clients].filter((c) => c.profile && names.has(c.profile.name.toLowerCase()));
  }

  clanOp(client, m) {
    const profile = client.profile;
    const reply = (res, extra = {}) => {
      if (res.ok) {
        const mine = this.clans.byMember(profile.name);
        profile.clan = this.clans.summary(mine);
        this.profiles.markDirty(profile);
        if (client.player) { client.player.clanTag = profile.clan ? profile.clan.tag : null; if (client.room) client.room.rosterDirty = true; }
      }
      client.send({ t: S2C.CLAN, ok: res.ok, msg: res.msg, clan: this.clans.summary(this.clans.byMember(profile.name)), list: this.clanList(), ...extra });
      if (res.ok) client.sendProfile();
    };
    switch (m.op) {
      case 'create': {
        if (profile.crystals < CLAN_CREATE_COST) return reply({ ok: false, msg: `Founding a clan costs ${CLAN_CREATE_COST} crystals` });
        const res = this.clans.create(profile.name, m.tag, m.name);
        if (res.ok) profile.crystals -= CLAN_CREATE_COST;
        return reply(res);
      }
      case 'join': return reply(this.clans.join(profile.name, m.tag));
      case 'leave': return reply(this.clans.leave(profile.name));
      case 'kick': {
        const res = this.clans.kick(profile.name, String(m.member || ''));
        if (res.ok) for (const c of this.clients) if (c.profile && c.profile.name.toLowerCase() === String(m.member).toLowerCase()) { c.profile.clan = null; this.profiles.markDirty(c.profile); c.sendProfile(); }
        return reply(res);
      }
      case 'list': default: return reply({ ok: true, msg: '' });
    }
  }

  clanList() {
    const xpOf = (name) => { const p = this.profiles.load(name); return p ? p.xp : 0; };
    return this.clans.list(xpOf);
  }

  clanChat(client, text) {
    const clan = this.clans.byMember(client.profile.name);
    text = String(text || '').slice(0, 140).trim();
    if (!clan) { client.send({ t: S2C.EVENTS, ev: [{ e: 'sys', m: 'You are not in a clan' }] }); return; }
    if (!text) return;
    const ev = { e: 'chat', p: client.player ? client.player.id : -1, n: `[${clan.tag}] ${client.profile.name}`, tm: 0, m: text, to: 'clan' };
    for (const c of this.clanClients(clan)) c.send({ t: S2C.EVENTS, ev: [ev] });
  }

  broadcastLobby() {
    const msg = this.lobby();
    for (const c of this.clients) if (c.profile && !c.room) c.send(msg);
  }

  attach(wss) {
    wss.on('connection', (ws, req) => {
      const client = new Client(this, ws, req);
      this.clients.add(client);
    });
  }

  close() {
    clearInterval(this.timer);
    clearInterval(this.lobbyTimer);
    clearInterval(this.saveTimer);
    this.profiles.flush();
    for (const r of this.rooms.values()) r.destroy();
  }
}

class Client {
  constructor(server, ws, req) {
    this.server = server;
    this.ws = ws;
    this.id = server.nextClientId++;
    this.profile = null;
    this.room = null;
    this.player = null;
    this.ip = req?.socket?.remoteAddress || '?';
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      try { this.handle(msg); } catch (e) { server.log('client error', e.stack || e); this.send({ t: S2C.ERROR, msg: 'Server error: ' + e.message }); }
    });
    ws.on('close', () => this.onClose());
    ws.on('error', () => this.onClose());
  }

  send(obj) {
    if (this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  }

  sendProfile() {
    if (this.profile) this.send({ t: S2C.PROFILE, profile: this.profile });
  }

  onClose() {
    this.leaveRoom();
    this.server.clients.delete(this);
    if (this.profile) this.server.profiles.flush();
  }

  leaveRoom() {
    if (this.room && this.player) {
      this.room.removePlayer(this.player.id);
      this.room.lastHumanAt = Date.now();
    }
    this.room = null;
    this.player = null;
  }

  handle(m) {
    const s = this.server;
    if (m.t === C2S.PING) { this.send({ t: S2C.PONG, c: m.c, st: Date.now() }); return; }
    if (m.t === C2S.HELLO) {
      const name = sanitizeName(m.name) || 'Tanker';
      this.profile = s.profiles.load(name);
      this.profile.clan = s.clans.summary(s.clans.byMember(this.profile.name));
      this.send({ t: S2C.WELCOME, profile: this.profile, version: GAME_VERSION, dev: s.dev, serverTime: Date.now() });
      this.send(s.lobby());
      return;
    }
    if (!this.profile) { this.send({ t: S2C.ERROR, msg: 'Say hello first' }); return; }
    switch (m.t) {
      case C2S.LOBBY:
        this.send(s.lobby());
        break;
      case C2S.LEADERBOARD:
        this.send({ t: S2C.LEADERBOARD, top: s.leaderboard(), me: this.profile.name });
        break;
      case C2S.QUEUE: {
        const room = s.matchmake(this, m.mode || 'any');
        if (!room) { this.send({ t: S2C.ERROR, msg: 'No battle available right now' }); return; }
        this.leaveRoom();
        this.joinRoom(room, +m.team || 0);
        break;
      }
      case C2S.CLAN:
        s.clanOp(this, m);
        break;
      case C2S.PROFILE:
        this.sendProfile();
        break;
      case C2S.SETTINGS:
        if (m.settings && typeof m.settings === 'object') { this.profile.settings = { ...this.profile.settings, ...m.settings }; s.profiles.markDirty(this.profile); }
        break;
      case C2S.CREATE: {
        const o = m.opts || {};
        const opts = {
          name: String(o.name || '').slice(0, 32) || `${this.profile.name}'s battle`,
          map: MAP_LIST.some((x) => x.id === o.map) ? o.map : 'sandbox',
          mode: MODES[o.mode] ? o.mode : 'DM',
          timeLimit: Math.max(0, Math.min(60, +o.timeLimit || 0)),
          scoreLimit: Math.max(0, Math.min(999, +o.scoreLimit || 0)),
          maxPlayers: Math.max(2, Math.min(20, +o.maxPlayers || 12)),
          bots: Math.max(0, Math.min(19, +o.bots || 0)),
          friendlyFire: !!o.friendlyFire,
          supplies: o.supplies !== false,
          drops: o.drops !== false,
          training: !!o.training,
        };
        if (opts.training) { opts.bots = Math.min(opts.bots || 3, 4); opts.timeLimit = 0; opts.scoreLimit = 0; opts.mode = 'DM'; }
        this.leaveRoom();
        const room = s.createRoom(opts, this.profile.name);
        this.joinRoom(room, +o.team || 0);
        break;
      }
      case C2S.JOIN: {
        const room = s.rooms.get(+m.id);
        if (!room) { this.send({ t: S2C.ERROR, msg: 'Battle not found' }); return; }
        if (room.humans().length >= room.opts.maxPlayers) { this.send({ t: S2C.ERROR, msg: 'Battle is full' }); return; }
        this.leaveRoom();
        this.joinRoom(room, +m.team || 0);
        break;
      }
      case C2S.LEAVE:
        this.leaveRoom();
        this.send({ t: S2C.LEFT });
        this.send(s.lobby());
        break;
      case C2S.INPUT:
        if (this.room && this.player) this.room.handleInput(this.player, m);
        break;
      case C2S.SUPPLY:
        if (this.room && this.player) {
          this.player.supplies = { ...this.profile.supplies };
          this.room.useSupply(this.player, m.id);
        }
        break;
      case C2S.SELF_DESTRUCT:
        if (this.room && this.player) this.room.selfDestruct(this.player);
        break;
      case C2S.TEAM:
        if (this.room && this.player) {
          if (!this.room.switchTeam(this.player, +m.team)) this.send({ t: S2C.ERROR, msg: 'Cannot switch team now (teams would be unbalanced)' });
        }
        break;
      case C2S.CHAT: {
        const text = String(m.msg || '').trim();
        if (text.startsWith('/c ') || text.startsWith('/clan ')) { s.clanChat(this, text.replace(/^\/(c|clan)\s+/, '')); return; }
        if (text.startsWith('/')) { this.command(text); return; }
        if (m.clan) { s.clanChat(this, text); return; }
        if (this.room && this.player) this.room.chat(this.player, text, !!m.team);
        break;
      }
      case C2S.GARAGE: {
        const res = garageOp(this.profile, m.op, m.kind, m.id, m.n);
        s.profiles.markDirty(this.profile);
        this.send({ t: S2C.GARAGE_OK, ok: res.ok, msg: res.msg, op: m.op, kind: m.kind, id: m.id });
        if (res.ok && res.reward) this.send({ t: S2C.CONTAINER, reward: res.reward, left: this.profile.containers });
        this.sendProfile();
        if (res.ok && this.room && this.player) {
          this.room.setEquip(this.player, equipFromProfile(this.profile));
          this.player.supplies = { ...this.profile.supplies };
        }
        break;
      }
      default:
        break;
    }
  }

  joinRoom(room, team) {
    this.room = room;
    this.player = room.addHuman(this, this.profile, team);
    room.lastHumanAt = Date.now();
  }

  command(text) {
    const s = this.server;
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const reply = (msg) => this.send({ t: S2C.EVENTS, ev: [{ e: 'sys', m: msg }] });
    const n = parseInt(args[0], 10);
    switch (cmd.toLowerCase()) {
      case 'help':
        reply(s.dev ? 'Commands: /crystals N, /xp N, /unlock, /bots N, /end, /supplies' : 'Commands: /help');
        return;
      case 'crystals':
        if (!s.dev) return reply('Dev mode only');
        this.profile.crystals += isFinite(n) ? n : 10000;
        break;
      case 'xp':
        if (!s.dev) return reply('Dev mode only');
        this.profile.xp += isFinite(n) ? n : 1000;
        if (this.player) this.player.rank = rankForXp(this.profile.xp).index;
        break;
      case 'unlock':
        if (!s.dev) return reply('Dev mode only');
        garageOp(this.profile, 'unlockAll');
        break;
      case 'supplies':
        if (!s.dev) return reply('Dev mode only');
        for (const k of Object.keys(this.profile.supplies)) this.profile.supplies[k] += 20;
        if (this.player) this.player.supplies = { ...this.profile.supplies };
        break;
      case 'bots':
        if (!s.dev || !this.room) return reply('Dev mode only');
        this.room.opts.bots = Math.max(0, Math.min(19, isFinite(n) ? n : 7));
        this.room.fillBots();
        reply(`Bots set to ${this.room.opts.bots}`);
        return;
      case 'end':
        if (!s.dev || !this.room) return reply('Dev mode only');
        this.room.checkEnd();
        this.room.end('command');
        return;
      default:
        reply('Unknown command. Try /help');
        return;
    }
    s.profiles.markDirty(this.profile);
    this.sendProfile();
    reply('OK');
  }
}

/**
 * Start HTTP + WS server.
 * @returns {Promise<{port:number, close:()=>void, game:GameServer}>}
 */
export function startServer({ port = 0, host = '127.0.0.1', dataDir = path.join(ROOT, 'data'), dev = false, log = console.log } = {}) {
  const game = new GameServer({ dataDir, dev, log });
  const httpServer = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { urlPath = '/'; }
    if (urlPath === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: GAME_VERSION, rooms: game.rooms.size, online: game.clients.size }));
      return;
    }
    const file = resolveStatic(urlPath);
    if (!file) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  });
  const wss = new WebSocketServer({ server: httpServer });
  game.attach(wss);
  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      const actual = httpServer.address().port;
      log(`Tanki server listening on http://${host}:${actual}  (dev=${dev})`);
      resolve({
        port: actual, host, game,
        close: () => { game.close(); wss.close(); httpServer.close(); },
      });
    });
  });
}

// CLI entry: node server/index.mjs [--port N] [--host 0.0.0.0] [--dev]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  startServer({
    port: +get('--port', 8081), host: get('--host', '0.0.0.0'), dev: args.includes('--dev') || !!process.env.TANKI_DEV,
    dataDir: get('--data', path.join(ROOT, 'data')),
  }).catch((e) => { console.error(e); process.exit(1); });
}
