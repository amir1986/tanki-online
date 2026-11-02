// Battle room: authoritative simulation of one battle (players, bots, weapons, modes, drops, mines).
import {
  PHYSICS_DT, SNAPSHOT_HZ, TEAM, MODES, RESPAWN_DELAY, SPAWN_PROTECTION, SELF_DESTRUCT_DELAY, FLIP_AUTO_SECONDS,
  FLAG_RETURN_SECONDS, CP_RADIUS, CP_CAPTURE_SECONDS, CP_SCORE_INTERVAL, SUPPLY_DURATION, SUPPLY_COOLDOWN,
  MINE_COOLDOWN, MINE_ARM_TIME, MINE_TRIGGER_RADIUS, MINE_DAMAGE, MINE_SPLASH, MAX_MINES_PER_PLAYER, REPAIR_SECONDS,
  DROP_INTERVAL, DROP_LIFETIME, GOLD_INTERVAL_MIN, GOLD_INTERVAL_MAX, GOLD_WARNING, GOLD_REWARD, DROP_FALL_SPEED,
  SCORE, FUND_PER_KILL, FUND_BASE, BATTLE_DEFAULTS, KILL_Y, TF,
} from '../shared/constants.mjs';
import { hullStats, turretStats, getPaint, rankForXp, rankUpBonus } from '../shared/items.mjs';
import { buildMap, randomSpawn } from '../shared/maps.mjs';
import { PhysWorld } from '../shared/sim/world.mjs';
import { finalizeMap } from '../shared/sim/nav.mjs';
import { TankSim } from '../shared/sim/tank.mjs';
import { newWeaponState, updateWeapon, updateProjectiles, TURRET_TURN_SPEED } from '../shared/sim/weapons.mjs';
import { packTank, packProjectile, packDrop, packMine, S2C } from '../shared/protocol.mjs';
import { mulberry32 } from '../shared/noise.mjs';
import * as CANNON from 'cannon-es';
import { angleDiff, clamp, vdist, vdistXZ, vsub, vnorm, vscale, lerp } from '../shared/sim/math.mjs';
import { botThink, botEquipment, botName, BOT_SUPPLIES } from './bots.mjs';

let nextRoomId = 1;
const freshFx = () => ({ da: 0, dd: 0, nitro: 0, repairUntil: 0, repairRate: 0, frozenUntil: 0, frozenFactor: 1, burnUntil: 0, burnDps: 0, burnFrom: null });
const norm = (a) => { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; };

export class Room {
  constructor(opts = {}, hooks = {}) {
    this.id = opts.id || nextRoomId++;
    this.opts = { ...BATTLE_DEFAULTS, ...opts };
    this.mode = MODES[this.opts.mode] ? this.opts.mode : 'DM';
    this.map = finalizeMap(buildMap(this.opts.map));
    this.name = this.opts.name || `${this.map.name} ${this.mode}`;
    this.hooks = hooks;
    this.pw = new PhysWorld(this.map);
    this.rng = mulberry32((this.opts.seed ?? (Date.now() & 0xffffff)) >>> 0);
    this.players = new Map();
    this.nextPid = 1;
    this.projectiles = [];
    this.nextProjId = 1;
    this.mines = [];
    this.nextMineId = 1;
    this.drops = [];
    this.nextDropId = 1;
    this.events = [];
    this.friendlyFire = !!this.opts.friendlyFire;
    this.creator = this.opts.creator || null;
    this.created = Date.now();
    this.accumulator = 0;
    this.snapTimer = 0;
    this.rosterTimer = 0;
    this.rosterDirty = true;
    this.botThinkTimer = 0;
    this.resetBattle();
    this.fillBots();
  }

  // ---- lifecycle ------------------------------------------------------------
  resetBattle() {
    this.time = 0;
    this.state = 'running';
    this.endedAt = 0;
    this.results = null;
    this.teamScore = { 1: 0, 2: 0 };
    this.totalKills = 0;
    this.fund = FUND_BASE;
    for (const pr of this.projectiles) void pr;
    this.projectiles.length = 0;
    this.mines.length = 0;
    this.drops.length = 0;
    this.flags = {
      red: { state: 0, pos: [...this.map.flags.red], carrier: null, droppedAt: 0 },
      blue: { state: 0, pos: [...this.map.flags.blue], carrier: null, droppedAt: 0 },
    };
    this.points = this.map.points.map((p) => ({ id: p.id, pos: p.pos, owner: 0, cap: 0, capTeam: 0 }));
    this.cpTimer = 0;
    this.dropTimer = 15;
    this.goldTimer = GOLD_INTERVAL_MIN + this.rng() * (GOLD_INTERVAL_MAX - GOLD_INTERVAL_MIN);
    this.goldWarned = false;
    for (const p of this.players.values()) {
      if (p.sim) { p.sim.destroy(); p.sim = null; }
      p.alive = false;
      p.score = 0; p.kills = 0; p.deaths = 0; p.assists = 0; p.caps = 0; p.damageDealt = 0; p.flag = null;
      p.respawnAt = this.time + 0.5 + this.rng() * 1.5;
      p.supplyCd = {};
      if (p.isBot) p.supplies = { ...BOT_SUPPLIES };
    }
    this.rosterDirty = true;
  }

  get teams() { return MODES[this.mode].teams; }
  get timeLimitSec() { return (this.opts.timeLimit || 0) * 60; }
  get timeLeft() { return this.timeLimitSec > 0 ? Math.max(0, this.timeLimitSec - this.time) : -1; }
  get scoreLimit() { const s = this.opts.scoreLimit | 0; return this.mode === 'CP' ? s * 10 : s; }

  humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  bots() { return [...this.players.values()].filter((p) => p.isBot); }
  alivePlayers() { return [...this.players.values()].filter((p) => p.alive && p.sim); }
  isEnemy(a, b) { return a !== b && (!this.teams || a.team !== b.team); }
  teamCount(team) { let n = 0; for (const p of this.players.values()) if (p.team === team) n++; return n; }

  summary() {
    return {
      id: this.id, name: this.name, map: this.map.id, mapName: this.map.name, mode: this.mode,
      players: this.players.size, humans: this.humans().length, bots: this.bots().length, max: this.opts.maxPlayers,
      timeLeft: Math.round(this.timeLeft), state: this.state, teamScore: this.teamScore,
      timeLimit: this.opts.timeLimit, scoreLimit: this.opts.scoreLimit, friendlyFire: this.friendlyFire,
      supplies: !!this.opts.supplies, drops: !!this.opts.drops,
      red: this.teamCount(1), blue: this.teamCount(2),
    };
  }

  info() {
    return {
      id: this.id, name: this.name, map: this.map.id, mode: this.mode, opts: { ...this.opts, creator: undefined },
      friendlyFire: this.friendlyFire, timeLimit: this.opts.timeLimit, scoreLimit: this.scoreLimit,
      points: this.points.map((p) => ({ id: p.id, pos: p.pos })), flags: this.map.flags,
      time: this.time, state: this.state,
    };
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, bot: p.isBot, rank: p.rank,
      hull: p.equip.hull, hullMod: p.equip.hullMod, turret: p.equip.turret, turretMod: p.equip.turretMod, paint: p.equip.paint,
      maxHp: p.maxHp, score: p.score, kills: p.kills, deaths: p.deaths,
    }));
  }

  // ---- players ----------------------------------------------------------------
  pickTeam(requested) {
    if (!this.teams) return TEAM.NONE;
    const r = this.teamCount(TEAM.RED), b = this.teamCount(TEAM.BLUE);
    if (requested === TEAM.RED && r <= b + 1) return TEAM.RED;
    if (requested === TEAM.BLUE && b <= r + 1) return TEAM.BLUE;
    return r <= b ? TEAM.RED : TEAM.BLUE;
  }

  makePlayer({ name, team, isBot, client, profile, equip, rank }) {
    const id = this.nextPid++;
    const p = {
      id, name, team, isBot, client: client || null, profile: profile || null, rank: rank || 0,
      equip: { hull: 'wasp', hullMod: 0, turret: 'smoky', turretMod: 0, paint: 'green', ...equip },
      hull: null, turret: null, paint: null, sim: null, alive: false, hp: 0, maxHp: 100,
      respawnAt: this.time + 1, protectedUntil: 0, deadSince: 0,
      controls: { f: 0, t: 0, tt: 0, fire: false, yaw: null, seq: 0 },
      lastInputAt: this.time, turretYaw: 0, w: null, fx: freshFx(),
      supplies: isBot ? { ...BOT_SUPPLIES } : { ...(profile?.supplies || {}) }, supplyCd: {},
      score: 0, kills: 0, deaths: 0, assists: 0, caps: 0, damageDealt: 0, damageLog: new Map(), dmgAcc: 0, dmgAccFrom: -1, dmgAccT: 0,
      flag: null, selfDestructAt: null, bot: null, joinedAt: this.time, upsideDown: 0,
    };
    this.applyEquipStats(p);
    this.players.set(id, p);
    return p;
  }

  applyEquipStats(p) {
    p.hull = hullStats(p.equip.hull, p.equip.hullMod);
    p.turret = turretStats(p.equip.turret, p.equip.turretMod);
    p.paint = getPaint(p.equip.paint);
    p.maxHp = p.hull.hp;
  }

  addHuman(client, profile, requestedTeam) {
    const team = this.pickTeam(requestedTeam);
    // make room: drop a bot if full
    if (this.players.size >= this.opts.maxPlayers) {
      const bot = this.bots().find((b) => !this.teams || b.team === team) || this.bots()[0];
      if (bot) this.removePlayer(bot.id);
    }
    const p = this.makePlayer({
      name: profile.name, team, isBot: false, client, profile,
      equip: { hull: profile.equipped.hull, hullMod: profile.hulls[profile.equipped.hull] | 0, turret: profile.equipped.turret, turretMod: profile.turrets[profile.equipped.turret] | 0, paint: profile.equipped.paint },
      rank: rankForXp(profile.xp).index,
    });
    p.respawnAt = this.time + 1.0;
    this.rebalanceBots();
    this.rosterDirty = true;
    this.events.push({ e: 'sys', m: `${p.name} joined the battle` });
    client.send({ t: S2C.JOINED, battle: this.info(), you: p.id, players: this.roster(), map: this.map.id });
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    if (p.sim) { p.sim.destroy(); p.sim = null; }
    if (p.flag) this.dropFlag(p, p.lastPos || this.map.flags[p.flag]);
    for (let i = this.mines.length - 1; i >= 0; i--) if (this.mines[i].owner === pid) this.mines.splice(i, 1);
    this.players.delete(pid);
    if (!p.isBot) {
      this.events.push({ e: 'sys', m: `${p.name} left the battle` });
      this.rebalanceBots();
    }
    this.rosterDirty = true;
  }

  addBot(team) {
    const humanRank = Math.max(0, ...this.humans().map((h) => h.rank));
    const equip = botEquipment(this.rng, humanRank);
    const p = this.makePlayer({ name: botName(this.rng, [...this.players.values()].map((x) => x.name)), team, isBot: true, equip, rank: equip.rank });
    p.bot = { goal: null, goalT: 0, stuckT: 0, reverseT: 0, aimErr: [0, 0], aimErrT: 0, target: null, retargetT: 0, role: this.rng() < 0.6 ? 'attack' : 'defend', skill: 0.5 + this.rng() * 0.5, lastPos: null, supplyT: 0, fireT: 0 };
    p.respawnAt = this.time + 0.5 + this.rng() * 2;
    this.rosterDirty = true;
    return p;
  }

  fillBots() {
    const want = Math.max(0, Math.min(this.opts.bots | 0, this.opts.maxPlayers - this.humans().length));
    let bots = this.bots();
    while (bots.length > want) { this.removePlayer(bots.pop().id); }
    while (bots.length < want) {
      const team = this.teams ? (this.teamCount(1) <= this.teamCount(2) ? 1 : 2) : 0;
      bots.push(this.addBot(team));
    }
    this.rebalanceBots();
  }

  rebalanceBots() {
    if (!this.teams) return;
    for (let guard = 0; guard < 20; guard++) {
      const r = this.teamCount(1), b = this.teamCount(2);
      if (Math.abs(r - b) <= 1) break;
      const from = r > b ? 1 : 2, to = r > b ? 2 : 1;
      const bot = this.bots().find((x) => x.team === from);
      if (!bot) break;
      if (bot.flag) this.dropFlag(bot, bot.sim ? bot.sim.pos : this.map.flags[bot.flag]);
      bot.team = to;
      if (bot.sim) { bot.sim.destroy(); bot.sim = null; bot.alive = false; bot.respawnAt = this.time + 1; }
    }
    this.rosterDirty = true;
  }

  setEquip(p, equip) {
    p.equip = { ...p.equip, ...equip };
    if (!p.alive) this.applyEquipStats(p);
    else p.pendingEquip = true;
    this.rosterDirty = true;
  }

  switchTeam(p, team) {
    if (!this.teams || p.team === team) return false;
    const other = team === 1 ? 2 : 1;
    if (this.teamCount(team) > this.teamCount(other)) return false;
    if (p.flag) this.dropFlag(p, p.sim ? p.sim.pos : this.map.flags[p.flag]);
    p.team = team;
    if (p.sim) { p.sim.destroy(); p.sim = null; }
    p.alive = false;
    p.respawnAt = this.time + RESPAWN_DELAY;
    this.rebalanceBots();
    this.rosterDirty = true;
    this.events.push({ e: 'sys', m: `${p.name} switched to the ${team === 1 ? 'Red' : 'Blue'} team` });
    return true;
  }

  // ---- spawning / death -------------------------------------------------------
  spawn(p) {
    if (p.pendingEquip) { p.pendingEquip = false; }
    this.applyEquipStats(p);
    const avoid = this.alivePlayers().filter((o) => o !== p).map((o) => o.sim.pos);
    const s = randomSpawn(this.map, this.teams ? p.team : 0, this.rng, avoid);
    if (p.sim) p.sim.destroy();
    p.sim = new TankSim(this.pw, p.hull, s.pos, s.yaw, p);
    p.hp = p.maxHp;
    p.alive = true;
    p.protectedUntil = this.time + SPAWN_PROTECTION;
    p.turretYaw = 0;
    p.w = newWeaponState(p.turret);
    p.fx = freshFx();
    p.selfDestructAt = null;
    p.damageLog.clear();
    p.controls.fire = false;
    this.events.push({ e: 'spawn', p: p.id, pos: s.pos.map((v) => +v.toFixed(2)) });
    this.rosterDirty = true;
  }

  kill(victim, killer, turretId) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.deadSince = this.time;
    victim.respawnAt = this.time + RESPAWN_DELAY;
    const pos = victim.sim ? victim.sim.pos : victim.lastPos || [0, 0, 0];
    victim.lastPos = pos;
    if (victim.sim) { victim.sim.destroy(); victim.sim = null; }
    if (victim.flag) this.dropFlag(victim, pos);
    this.events.push({ e: 'kill', v: victim.id, a: killer ? killer.id : -1, k: turretId, p: pos.map((v) => +v.toFixed(2)) });
    if (victim.profile) { victim.profile.stats.deaths++; this.profileDirty(victim); }
    if (killer && killer !== victim) {
      killer.kills++;
      this.totalKills++;
      this.fund += FUND_PER_KILL;
      this.addScore(killer, SCORE.KILL, 'kill');
      if (killer.profile) { killer.profile.stats.kills++; }
      if (this.mode === 'TDM' && killer.team) this.teamScore[killer.team]++;
    }
    for (const [aid, log] of victim.damageLog) {
      if (killer && aid === killer.id) continue;
      const a = this.players.get(aid);
      if (!a || this.time - log.t > 8 || log.dmg < victim.maxHp * 0.2) continue;
      a.assists++;
      this.addScore(a, SCORE.ASSIST, 'assist');
    }
    victim.damageLog.clear();
    victim.fx = freshFx();
    this.rosterDirty = true;
    this.checkEnd();
  }

  addScore(p, n, why) {
    p.score += n;
    if (p.profile) {
      const before = rankForXp(p.profile.xp).index;
      p.profile.xp = Math.max(0, p.profile.xp + n);
      p.profile.stats.score += n;
      const after = rankForXp(p.profile.xp);
      if (after.index > before) {
        p.profile.crystals += rankUpBonus(after.index);
        p.rank = after.index;
        this.events.push({ e: 'rankup', p: p.id, r: after.index, c: rankUpBonus(after.index) });
      }
      this.profileDirty(p);
    }
    if (n !== 0) this.events.push({ e: 'score', p: p.id, n, w: why });
  }

  profileDirty(p) {
    if (p.profile && this.hooks.onProfile) this.hooks.onProfile(p);
  }

  // ---- damage -----------------------------------------------------------------
  damage(target, amount, attacker, turretId, { pos = null, crit = false, silent = false } = {}) {
    if (!target || !target.alive || !target.sim || this.state !== 'running') return 0;
    if (attacker === target) return 0;
    if (attacker && !this.isEnemy(attacker, target) && !this.friendlyFire) return 0;
    if (target.protectedUntil > this.time) return 0;
    let dmg = amount;
    if (attacker && attacker.fx.dd > this.time) dmg *= 2;
    if (target.fx.da > this.time) dmg *= 0.5;
    const res = (target.paint.resist && target.paint.resist[turretId]) || 0;
    dmg *= 1 - res;
    if (dmg <= 0) return 0;
    target.hp -= dmg;
    if (attacker) {
      const prev = target.damageLog.get(attacker.id);
      target.damageLog.set(attacker.id, { t: this.time, dmg: (prev && this.time - prev.t < 8 ? prev.dmg : 0) + dmg });
      attacker.damageDealt += dmg;
    }
    if (!silent) {
      this.events.push({ e: 'hit', p: (pos || target.sim.pos).map((v) => +v.toFixed(2)), d: Math.round(dmg), v: target.id, a: attacker ? attacker.id : -1, c: crit ? 1 : 0, k: turretId });
    } else {
      target.dmgAcc += dmg;
      target.dmgAccFrom = attacker ? attacker.id : -1;
      target.dmgAccKind = turretId;
    }
    if (target.hp <= 0) { target.hp = 0; this.kill(target, attacker, turretId); }
    return dmg;
  }

  heal(target, amount, healer) {
    if (!target || !target.alive || amount <= 0) return 0;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    if (healed > 0 && healer && healer !== target) {
      target.healAcc = (target.healAcc || 0) + healed;
      target.healAccFrom = healer.id;
    }
    return healed;
  }

  explode(pos, radius, dmg, minFrac, attacker, kind, directVictim) {
    this.events.push({ e: 'boom', p: pos.map((v) => +v.toFixed(2)), r: radius, k: kind });
    for (const o of this.alivePlayers()) {
      const opos = o.sim.pos;
      const body = o.sim.body;
      const d = vdist(opos, pos);
      if (d > radius + 1.3) continue;
      const frac = o === directVictim ? 1 : lerp(1, minFrac, clamp((d - 1.3) / radius, 0, 1));
      if (o !== attacker && (frac > 0)) {
        this.damage(o, dmg * frac, attacker, kind, { pos: opos });
      }
      if (!o.sim) continue; // destroyed by the blast
      // physics kick
      const dir = vnorm(vsub(opos, pos));
      const k = body.mass * 1.6 * frac;
      body.applyImpulse(new CANNON.Vec3(dir[0] * k, Math.abs(dir[1]) * k + k * 0.6, dir[2] * k), new CANNON.Vec3(0, 0, 0));
    }
  }

  // ---- supplies / mines ---------------------------------------------------------
  useSupply(p, id) {
    if (!p.alive || !p.sim || this.state !== 'running' || !this.opts.supplies) return false;
    if (!['repair', 'da', 'dd', 'nitro', 'mine'].includes(id)) return false;
    if ((p.supplies[id] | 0) <= 0) return false;
    if ((p.supplyCd[id] || 0) > this.time) return false;
    const t = this.time;
    if (id === 'repair') {
      if (p.hp >= p.maxHp - 0.5) return false;
      p.fx.repairUntil = t + REPAIR_SECONDS; p.fx.repairRate = p.maxHp / REPAIR_SECONDS;
      p.fx.burnUntil = 0;
    } else if (id === 'da') p.fx.da = Math.max(p.fx.da, t) + SUPPLY_DURATION;
    else if (id === 'dd') p.fx.dd = Math.max(p.fx.dd, t) + SUPPLY_DURATION;
    else if (id === 'nitro') p.fx.nitro = Math.max(p.fx.nitro, t) + SUPPLY_DURATION;
    else if (id === 'mine') {
      const back = vscale(p.sim.forward, -(p.sim.size[2] / 2 + 0.8));
      const pos = [p.sim.pos[0] + back[0], 0, p.sim.pos[2] + back[2]];
      pos[1] = this.map.surfaceAt(pos[0], pos[2]) + 0.12;
      this.mines.push({ id: this.nextMineId++, pos, team: p.team, owner: p.id, placedAt: t, armed: false });
      const mine = this.mines.filter((m) => m.owner === p.id);
      while (mine.length > MAX_MINES_PER_PLAYER) { const old = mine.shift(); this.mines.splice(this.mines.indexOf(old), 1); }
    }
    p.supplies[id]--;
    if (p.profile) { p.profile.supplies[id] = Math.max(0, (p.profile.supplies[id] | 0) - 1); this.profileDirty(p); }
    p.supplyCd[id] = t + (id === 'mine' ? MINE_COOLDOWN : SUPPLY_COOLDOWN);
    this.events.push({ e: 'supply', p: p.id, s: id });
    return true;
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (!m.armed) { if (this.time - m.placedAt >= MINE_ARM_TIME) m.armed = true; else continue; }
      const owner = this.players.get(m.owner);
      let trigger = null;
      for (const o of this.alivePlayers()) {
        if (o.id === m.owner) continue;
        if (this.teams && o.team === m.team) continue;
        if (vdistXZ(o.sim.pos, m.pos) < MINE_TRIGGER_RADIUS && Math.abs(o.sim.pos[1] - m.pos[1]) < 2.5) { trigger = o; break; }
      }
      if (trigger) {
        this.mines.splice(i, 1);
        this.explode([m.pos[0], m.pos[1] + 0.3, m.pos[2]], MINE_SPLASH, MINE_DAMAGE, 0.35, owner || null, 'mine', trigger);
      }
    }
  }

  // ---- drops ----------------------------------------------------------------------
  spawnDrop(type) {
    const pts = type === 'gold' ? this.map.gold : this.map.drops;
    const free = pts.filter((pt) => !this.drops.some((d) => vdistXZ(d.pos, pt) < 3));
    if (!free.length) return null;
    const pt = free[Math.floor(this.rng() * free.length)];
    const d = { id: this.nextDropId++, type, pos: [pt[0], pt[1] + (type === 'gold' ? 55 : 38), pt[2]], ground: pt[1] + 0.55, landed: false, spawnedAt: this.time, landedAt: 0 };
    this.drops.push(d);
    this.events.push({ e: 'drop', id: d.id, type, p: d.pos.map((v) => +v.toFixed(2)) });
    return d;
  }

  updateDrops(dt) {
    if (!this.opts.drops) return;
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = DROP_INTERVAL * (0.7 + this.rng() * 0.6);
      const types = ['repair', 'da', 'dd', 'nitro'];
      this.spawnDrop(types[Math.floor(this.rng() * types.length)]);
    }
    this.goldTimer -= dt;
    if (!this.goldWarned && this.goldTimer <= GOLD_WARNING) {
      this.goldWarned = true;
      this.events.push({ e: 'gold', ph: 'warn' });
    }
    if (this.goldTimer <= 0) {
      this.goldTimer = GOLD_INTERVAL_MIN + this.rng() * (GOLD_INTERVAL_MAX - GOLD_INTERVAL_MIN);
      this.goldWarned = false;
      const d = this.spawnDrop('gold');
      if (d) this.events.push({ e: 'gold', ph: 'drop', p: d.pos.map((v) => +v.toFixed(2)) });
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (!d.landed) {
        d.pos[1] -= (d.type === 'gold' ? DROP_FALL_SPEED * 0.6 : DROP_FALL_SPEED) * dt;
        if (d.pos[1] <= d.ground) { d.pos[1] = d.ground; d.landed = true; d.landedAt = this.time; }
      } else if (this.time - d.landedAt > (d.type === 'gold' ? DROP_LIFETIME * 2 : DROP_LIFETIME)) {
        this.drops.splice(i, 1);
        continue;
      }
      if (d.pos[1] - d.ground > 3) continue;
      for (const o of this.alivePlayers()) {
        if (vdistXZ(o.sim.pos, d.pos) < 2.6 && Math.abs(o.sim.pos[1] - d.pos[1]) < 3) {
          this.drops.splice(i, 1);
          this.pickup(o, d);
          break;
        }
      }
    }
  }

  pickup(p, d) {
    const t = this.time;
    if (d.type === 'repair') { p.fx.repairUntil = t + REPAIR_SECONDS; p.fx.repairRate = p.maxHp / REPAIR_SECONDS; p.fx.burnUntil = 0; }
    else if (d.type === 'da') p.fx.da = Math.max(p.fx.da, t) + SUPPLY_DURATION;
    else if (d.type === 'dd') p.fx.dd = Math.max(p.fx.dd, t) + SUPPLY_DURATION;
    else if (d.type === 'nitro') p.fx.nitro = Math.max(p.fx.nitro, t) + SUPPLY_DURATION;
    else if (d.type === 'gold') {
      this.addScore(p, SCORE.GOLD, 'gold');
      if (p.profile) { p.profile.crystals += GOLD_REWARD; p.profile.stats.gold++; this.profileDirty(p); }
      this.events.push({ e: 'gold', ph: 'taken', p: p.id, n: p.name });
    }
    this.events.push({ e: 'pickup', p: p.id, type: d.type, pos: d.pos.map((v) => +v.toFixed(2)) });
  }

  // ---- modes ------------------------------------------------------------------------
  flagOf(team) { return team === 1 ? this.flags.red : this.flags.blue; }
  flagColor(team) { return team === 1 ? 'red' : 'blue'; }

  dropFlag(p, pos) {
    const color = p.flag;
    if (!color) return;
    const f = this.flags[color];
    f.state = 2; f.carrier = null; f.droppedAt = this.time;
    const x = clamp(pos[0], -this.map.halfW + 2, this.map.halfW - 2), z = clamp(pos[2], -this.map.halfL + 2, this.map.halfL - 2);
    f.pos = [x, this.map.surfaceAt(x, z), z];
    p.flag = null;
    this.events.push({ e: 'flag', c: color, a: 'dropped', p: p.id });
  }

  returnFlag(color, by) {
    const f = this.flags[color];
    f.state = 0; f.carrier = null; f.pos = [...this.map.flags[color]];
    this.events.push({ e: 'flag', c: color, a: 'returned', p: by ? by.id : -1 });
  }

  updateCTF(dt) {
    for (const color of ['red', 'blue']) {
      const f = this.flags[color];
      if (f.state === 2 && this.time - f.droppedAt > FLAG_RETURN_SECONDS) this.returnFlag(color, null);
      if (f.state === 1) {
        const c = this.players.get(f.carrier);
        if (!c || !c.alive || !c.sim) { f.state = 2; f.droppedAt = this.time; f.carrier = null; continue; }
        f.pos = c.sim.pos;
      }
    }
    for (const p of this.alivePlayers()) {
      if (!p.team) continue;
      const own = this.flagColor(p.team), enemy = this.flagColor(p.team === 1 ? 2 : 1);
      const fe = this.flags[enemy], fo = this.flags[own];
      const pos = p.sim.pos;
      if (!p.flag && fe.state !== 1 && vdistXZ(pos, fe.pos) < 2.8 && Math.abs(pos[1] - fe.pos[1]) < 3) {
        fe.state = 1; fe.carrier = p.id; p.flag = enemy;
        this.addScore(p, SCORE.FLAG_PICKUP, 'flag');
        this.events.push({ e: 'flag', c: enemy, a: 'taken', p: p.id });
      }
      if (fo.state === 2 && vdistXZ(pos, fo.pos) < 2.8 && Math.abs(pos[1] - fo.pos[1]) < 3) {
        this.returnFlag(own, p);
        this.addScore(p, SCORE.FLAG_RETURN, 'return');
      }
      if (p.flag && fo.state === 0 && vdistXZ(pos, this.map.flags[own]) < 3.2 && Math.abs(pos[1] - this.map.flags[own][1]) < 3) {
        p.flag = null; p.caps++;
        fe.state = 0; fe.carrier = null; fe.pos = [...this.map.flags[enemy]];
        this.teamScore[p.team]++;
        this.addScore(p, SCORE.FLAG_CAPTURE, 'capture');
        if (p.profile) { p.profile.stats.flags++; }
        this.events.push({ e: 'flag', c: enemy, a: 'captured', p: p.id });
        this.rosterDirty = true;
        this.checkEnd();
      }
    }
  }

  updateCP(dt) {
    const alive = this.alivePlayers();
    for (const pt of this.points) {
      let r = 0, b = 0;
      const present = [];
      for (const p of alive) {
        if (!p.team) continue;
        if (vdistXZ(p.sim.pos, pt.pos) < CP_RADIUS && Math.abs(p.sim.pos[1] - pt.pos[1]) < 6) { present.push(p); if (p.team === 1) r++; else b++; }
      }
      const rate = dt / CP_CAPTURE_SECONDS;
      if (r > 0 && b === 0 && pt.owner !== 1) this.capTick(pt, 1, rate * Math.sqrt(r), present);
      else if (b > 0 && r === 0 && pt.owner !== 2) this.capTick(pt, 2, rate * Math.sqrt(b), present);
      else if (r === 0 && b === 0 && pt.cap > 0) pt.cap = Math.max(0, pt.cap - rate * 0.5);
      else if (pt.owner && ((pt.owner === 1 && r > 0 && b === 0) || (pt.owner === 2 && b > 0 && r === 0)) && pt.cap > 0) pt.cap = Math.max(0, pt.cap - rate * 2);
    }
    this.cpTimer += dt;
    if (this.cpTimer >= CP_SCORE_INTERVAL) {
      this.cpTimer -= CP_SCORE_INTERVAL;
      let changed = false;
      for (const pt of this.points) if (pt.owner) { this.teamScore[pt.owner] += 1; changed = true; }
      if (changed) {
        // small score trickle for players holding points
        for (const p of alive) {
          if (!p.team) continue;
          for (const pt of this.points) if (pt.owner === p.team && vdistXZ(p.sim.pos, pt.pos) < CP_RADIUS) { p.score += SCORE.CP_HOLD; if (p.profile) { p.profile.xp += SCORE.CP_HOLD; } }
        }
        this.checkEnd();
      }
    }
  }

  capTick(pt, team, amount, present) {
    if (pt.capTeam !== team) { pt.capTeam = team; pt.cap = 0; }
    pt.cap += amount;
    if (pt.cap >= 1) {
      pt.cap = 0;
      if (pt.owner && pt.owner !== team) {
        // neutralised first
        pt.owner = 0;
        this.events.push({ e: 'cp', id: pt.id, o: 0, by: team });
      } else {
        pt.owner = team;
        for (const p of present) if (p.team === team) this.addScore(p, SCORE.CP_CAPTURE, 'cp');
        this.events.push({ e: 'cp', id: pt.id, o: team, by: team });
      }
    }
  }

  // ---- end of battle ----------------------------------------------------------------
  checkEnd() {
    if (this.state !== 'running') return;
    const limit = this.scoreLimit;
    let done = false, reason = '';
    if (this.timeLimitSec > 0 && this.time >= this.timeLimitSec) { done = true; reason = 'time'; }
    if (limit > 0) {
      if (this.mode === 'DM') { for (const p of this.players.values()) if (p.kills >= limit) done = true; }
      else if (this.teamScore[1] >= limit || this.teamScore[2] >= limit) done = true;
      if (done && !reason) reason = 'limit';
    }
    if (done) this.end(reason);
  }

  end(reason) {
    this.state = 'ended';
    this.endedAt = this.time;
    for (const p of this.players.values()) p.controls.fire = false;
    const players = [...this.players.values()];
    const totalScore = players.reduce((s, p) => s + Math.max(0, p.score), 0) || 1;
    let winner = null;
    if (this.teams) winner = this.teamScore[1] === this.teamScore[2] ? 0 : this.teamScore[1] > this.teamScore[2] ? 1 : 2;
    else { let best = null; for (const p of players) if (!best || p.score > best.score) best = p; winner = best ? best.id : null; }
    const results = players.map((p) => {
      const share = Math.max(0, p.score) / totalScore;
      const won = this.teams ? p.team === winner : p.id === winner;
      const crystals = Math.round(this.fund * share * (won ? 1.25 : 1));
      if (p.profile) {
        p.profile.crystals += crystals;
        p.profile.stats.battles++;
        if (won) p.profile.stats.wins++;
        this.profileDirty(p);
      }
      return { id: p.id, name: p.name, team: p.team, bot: p.isBot, score: p.score, kills: p.kills, deaths: p.deaths, assists: p.assists, caps: p.caps, crystals, xp: p.score, won };
    }).sort((a, b) => b.score - a.score);
    this.results = { reason, winner, teams: this.teams, teamScore: { ...this.teamScore }, players: results, fund: this.fund, restartIn: 12 };
    this.broadcast({ t: S2C.END, results: this.results });
    if (this.hooks.onEnd) this.hooks.onEnd(this, this.results);
  }

  restart() {
    this.resetBattle();
    this.broadcast({ t: S2C.RESTART, battle: this.info(), players: this.roster() });
    this.events.push({ e: 'sys', m: 'Battle restarted' });
  }

  // ---- input --------------------------------------------------------------------------
  handleInput(p, m) {
    const c = p.controls;
    c.f = clamp(+m.f || 0, -1, 1);
    c.t = clamp(+m.r || 0, -1, 1);
    c.tt = clamp(+m.tt || 0, -1, 1);
    c.fire = !!m.fire;
    c.yaw = typeof m.yaw === 'number' && isFinite(m.yaw) ? m.yaw : null;
    c.seq = m.seq | 0;
    p.lastInputAt = this.time;
  }

  selfDestruct(p) {
    if (!p.alive || p.selfDestructAt != null) return;
    p.selfDestructAt = this.time + SELF_DESTRUCT_DELAY;
    this.events.push({ e: 'sd', p: p.id, d: SELF_DESTRUCT_DELAY });
  }

  chat(p, msg, teamOnly) {
    msg = String(msg || '').slice(0, 140).trim();
    if (!msg) return;
    const ev = { e: 'chat', p: p.id, n: p.name, tm: p.team, m: msg, to: teamOnly && this.teams ? 'team' : 'all' };
    if (ev.to === 'team') {
      for (const o of this.players.values()) if (o.client && o.team === p.team) o.client.send({ t: S2C.EVENTS, ev: [ev] });
    } else this.events.push(ev);
  }

  // ---- main loop ----------------------------------------------------------------------
  /** Advance the room by real elapsed seconds (fixed-step inside). */
  tick(elapsed) {
    if (this.humans().length === 0 && this.state === 'running') {
      // idle room: nothing to simulate
      return;
    }
    this.accumulator += Math.min(elapsed, 0.25);
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 8) {
      this.step(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;
  }

  step(dt) {
    const t = (this.time += dt);
    if (this.state === 'ended') {
      if (t - this.endedAt >= (this.results ? this.results.restartIn : 12)) this.restart();
    }
    // respawns, self destruct, stale inputs
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.state === 'running' && t >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (!p.isBot && t - p.lastInputAt > 4) { p.controls.f = 0; p.controls.t = 0; p.controls.tt = 0; p.controls.fire = false; }
      if (p.selfDestructAt != null && t >= p.selfDestructAt) { this.kill(p, null, 'self'); continue; }
    }
    // bots
    this.botThinkTimer += dt;
    const think = this.botThinkTimer >= 0.1;
    if (think) this.botThinkTimer = 0;
    if (think) for (const p of this.players.values()) if (p.isBot && p.alive && p.sim) botThink(this, p, 0.1);

    // movement
    for (const p of this.alivePlayers()) {
      const frozen = p.fx.frozenUntil > t ? p.fx.frozenFactor : 1;
      const nitro = p.fx.nitro > t ? 1.3 : 1;
      const sniper = p.w && p.w.sniper;
      const mods = { speedMult: frozen * nitro * (sniper ? 0 : 1), accelMult: nitro * (sniper ? 0.2 : 1), turnMult: frozen * (sniper ? 0.3 : 1) };
      const c = this.state === 'running' ? p.controls : { f: 0, t: 0, tt: 0 };
      p.sim.update(dt, c, mods);
      // turret
      const ts = (TURRET_TURN_SPEED[p.turret.id] || 2.4) * (sniper ? 0.5 : 1);
      if (c.yaw != null) {
        const want = angleDiff(p.sim.yaw + p.turretYaw, c.yaw);
        p.turretYaw += clamp(want, -ts * dt, ts * dt);
      } else p.turretYaw += clamp(c.tt || 0, -1, 1) * ts * dt;
      p.turretYaw = norm(p.turretYaw);
      p.sim.turretYaw = p.turretYaw;
      p.lastPos = p.sim.pos;
      if (p.sim.upsideDownTime > FLIP_AUTO_SECONDS) { p.sim.flipUpright(); this.events.push({ e: 'flip', p: p.id }); }
      if (p.sim.pos[1] < KILL_Y) this.kill(p, null, 'void');
    }
    this.pw.step(dt);

    if (this.state === 'running') {
      for (const p of this.alivePlayers()) {
        updateWeapon(this, p, dt);
        if (p.w && (p.w.firing || p.w.idle === 0) && p.protectedUntil > t) p.protectedUntil = t;
      }
      updateProjectiles(this, dt);
      this.updateMines(dt);
      this.updateDrops(dt);
      this.updateEffects(dt);
      if (this.mode === 'CTF') this.updateCTF(dt);
      else if (this.mode === 'CP') this.updateCP(dt);
      if (this.timeLimitSec > 0 && t >= this.timeLimitSec) this.checkEnd();
    }

    // network
    if (this.events.length) {
      this.broadcast({ t: S2C.EVENTS, ev: this.events });
      this.events = [];
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 1 / SNAPSHOT_HZ) {
      this.snapTimer -= 1 / SNAPSHOT_HZ;
      this.broadcast(this.snapshot());
    }
    this.rosterTimer += dt;
    if (this.rosterDirty && this.rosterTimer >= 0.25) {
      this.rosterTimer = 0; this.rosterDirty = false;
      this.broadcast({ t: S2C.PLAYERS, players: this.roster() });
    }
  }

  updateEffects(dt) {
    const t = this.time;
    for (const p of this.alivePlayers()) {
      if (p.fx.burnUntil > t) {
        const from = p.fx.burnFrom != null ? this.players.get(p.fx.burnFrom) : null;
        this.damage(p, p.fx.burnDps * dt, from || null, 'firebird', { silent: true });
      }
      if (p.alive && p.fx.repairUntil > t) this.heal(p, p.fx.repairRate * dt, null);
      if (p.alive && p.dmgAcc > 0) {
        p.dmgAccT += dt;
        if (p.dmgAccT >= 0.3) {
          this.events.push({ e: 'hit', p: p.sim.pos.map((v) => +v.toFixed(2)), d: Math.round(p.dmgAcc), v: p.id, a: p.dmgAccFrom, c: 0, k: p.dmgAccKind || 'firebird' });
          p.dmgAcc = 0; p.dmgAccT = 0;
        }
      }
      if (p.alive && p.healAcc > 0) {
        p.healAccT = (p.healAccT || 0) + dt;
        if (p.healAccT >= 0.4) {
          this.events.push({ e: 'heal', p: p.sim.pos.map((v) => +v.toFixed(2)), d: Math.round(p.healAcc), v: p.id, a: p.healAccFrom });
          p.healAcc = 0; p.healAccT = 0;
        }
      }
    }
  }

  tankFlags(p) {
    const t = this.time;
    let f = 0;
    if (!p.alive) f |= TF.DEAD;
    if (p.fx.da > t) f |= TF.DA;
    if (p.fx.dd > t) f |= TF.DD;
    if (p.fx.nitro > t) f |= TF.NITRO;
    if (p.fx.repairUntil > t) f |= TF.REPAIR;
    if (p.protectedUntil > t) f |= TF.PROTECTED;
    if (p.w && p.w.firing) f |= TF.FIRING;
    if (p.flag) f |= TF.FLAG;
    if (p.fx.frozenUntil > t) f |= TF.FROZEN;
    if (p.fx.burnUntil > t) f |= TF.BURNING;
    if (p.w && p.w.charging) f |= TF.CHARGING;
    if (p.isBot) f |= TF.BOT;
    if (p.w && p.w.sniper) f |= TF.SNIPER;
    return f;
  }

  snapshot() {
    const tanks = [];
    for (const p of this.players.values()) {
      if (!p.alive || !p.sim) continue;
      tanks.push(packTank({
        id: p.id, pos: p.sim.pos, quat: p.sim.quat, turretYaw: p.turretYaw, hp: p.hp, flags: this.tankFlags(p),
        charge: p.w ? p.w.charge : 0, energy: p.w ? (p.turret.energy ? p.w.energy : p.turret.heat ? 100 - p.w.heat : 100) : 100,
        target: p.w ? p.w.target : null, speed: p.sim.speed,
      }));
    }
    const fl = this.mode === 'CTF' ? {
      r: [this.flags.red.state, +this.flags.red.pos[0].toFixed(2), +this.flags.red.pos[1].toFixed(2), +this.flags.red.pos[2].toFixed(2), this.flags.red.carrier ?? -1],
      b: [this.flags.blue.state, +this.flags.blue.pos[0].toFixed(2), +this.flags.blue.pos[1].toFixed(2), +this.flags.blue.pos[2].toFixed(2), this.flags.blue.carrier ?? -1],
    } : undefined;
    const cp = this.mode === 'CP' ? this.points.map((p) => [p.owner, p.capTeam, Math.round(p.cap * 100)]) : undefined;
    return {
      t: S2C.SNAP, time: +this.time.toFixed(3), left: Math.round(this.timeLeft), st: this.state === 'running' ? 1 : 0,
      tanks, pr: this.projectiles.map(packProjectile), dr: this.drops.map(packDrop), mn: this.mines.map(packMine),
      fl, cp, ts: [this.teamScore[1], this.teamScore[2]],
      sc: [...this.players.values()].map((p) => [p.id, p.score, p.kills, p.deaths]),
    };
  }

  spawnProjectile(pr) {
    pr.id = this.nextProjId++;
    pr.age = 0;
    this.projectiles.push(pr);
    return pr;
  }

  broadcast(msg, except = null) {
    for (const p of this.players.values()) if (p.client && p !== except) p.client.send(msg);
  }

  destroy() {
    for (const p of this.players.values()) if (p.sim) p.sim.destroy();
    this.players.clear();
  }
}
