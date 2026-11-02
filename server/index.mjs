// Game server: static file hosting for the client + WebSocket battle server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.mjs';
import { ProfileStore, sanitizeName } from './profiles.mjs';
import { garageOp, equipFromProfile } from './garage.mjs';
import { C2S, S2C } from '../shared/protocol.mjs';
import { GAME_VERSION, BATTLE_DEFAULTS, MODES, TEAM } from '../shared/constants.mjs';
import { MAP_LIST } from '../shared/maps.mjs';
import { rankForXp } from '../shared/items.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
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
];

export class GameServer {
  constructor({ dataDir, dev = false, log = console.log } = {}) {
    this.dev = dev;
    this.log = log;
    this.profiles = new ProfileStore(path.join(dataDir, 'profiles'));
    this.rooms = new Map();
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
      this.send({ t: S2C.WELCOME, profile: this.profile, version: GAME_VERSION, dev: s.dev, serverTime: Date.now() });
      this.send(s.lobby());
      return;
    }
    if (!this.profile) { this.send({ t: S2C.ERROR, msg: 'Say hello first' }); return; }
    switch (m.t) {
      case C2S.LOBBY:
        this.send(s.lobby());
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
        };
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
        if (text.startsWith('/')) { this.command(text); return; }
        if (this.room && this.player) this.room.chat(this.player, text, !!m.team);
        break;
      }
      case C2S.GARAGE: {
        const res = garageOp(this.profile, m.op, m.kind, m.id, m.n);
        s.profiles.markDirty(this.profile);
        this.send({ t: S2C.GARAGE_OK, ok: res.ok, msg: res.msg, op: m.op, kind: m.kind, id: m.id });
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
