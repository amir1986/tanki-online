// Battle room tests: damage rules, modes, bots, end of battle, garage transactions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import { garageOp } from '../server/garage.mjs';
import { botEquipment, botName } from '../server/bots.mjs';
import { DEFAULT_PROFILE, getHull, getTurret, RANKS } from '../shared/items.mjs';
import { RESPAWN_DELAY, SPAWN_PROTECTION, CP_CAPTURE_SECONDS, TEAM } from '../shared/constants.mjs';

const DT = 1 / 60;
const fakeClient = () => { const msgs = []; return { msgs, send(m) { msgs.push(m); } }; };
const makeRoom = (opts) => new Room({ seed: 1, ...opts }, { onProfile() {}, onEnd() {} });
const steps = (room, seconds, fn) => { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) { if (fn) fn(i); room.step(DT); } };
const human = (room, name, team = 0) => { const c = fakeClient(); const p = DEFAULT_PROFILE(); p.name = name; const pl = room.addHuman(c, p, team); pl.lastInputAt = 1e9; return { p: pl, c, profile: p }; };
const forceSpawn = (room, pl) => { pl.respawnAt = -1; room.step(DT); pl.protectedUntil = 0; };
const place = (pl, pos, yaw = 0) => { pl.sim.teleport(pos, yaw); };

test('deathmatch with bots produces kills, events and valid snapshots', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'DM', bots: 8, timeLimit: 10, scoreLimit: 30 });
  const { p, c } = human(room, 'Tester');
  steps(room, 60, (i) => { p.controls = { f: 1, t: 0.3, tt: 0.4, fire: (i % 120) < 60, yaw: null, seq: i }; p.lastInputAt = room.time; });
  const kills = [...room.players.values()].reduce((s, x) => s + x.kills, 0);
  assert.ok(kills > 3, `kills ${kills}`);
  const types = new Set();
  for (const m of c.msgs) if (m.t === 'ev') for (const e of m.ev) types.add(e.e);
  for (const t of ['spawn', 'kill', 'hit', 'shot']) assert.ok(types.has(t), `event ${t}`);
  const snaps = c.msgs.filter((m) => m.t === 'snap');
  assert.ok(snaps.length > 1000);
  for (const s of snaps.slice(-20)) for (const a of s.tanks) for (const v of a) assert.ok(Number.isFinite(v) || v === null, 'finite snapshot values');
  assert.equal(room.players.size, 9);
});

test('damage rules: protection, double armor, double damage, paint resistance, friendly fire', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'TDM', bots: 0, friendlyFire: false });
  const a = human(room, 'A', TEAM.RED).p, b = human(room, 'B', TEAM.BLUE).p, c = human(room, 'C', TEAM.RED).p;
  for (const x of [a, b, c]) forceSpawn(room, x);
  assert.ok(a.alive && b.alive && c.alive);
  // spawn protection blocks damage
  b.protectedUntil = room.time + 10;
  assert.equal(room.damage(b, 50, a, 'smoky'), 0);
  b.protectedUntil = 0;
  const hp0 = b.hp;
  assert.equal(room.damage(b, 20, a, 'smoky'), 20);
  assert.equal(b.hp, hp0 - 20);
  b.fx.da = room.time + 10;
  assert.equal(room.damage(b, 20, a, 'smoky'), 10);
  a.fx.dd = room.time + 10;
  assert.equal(room.damage(b, 20, a, 'smoky'), 20);
  a.fx.dd = 0; b.fx.da = 0;
  b.paint = { id: 'x', resist: { smoky: 0.5 } };
  assert.equal(room.damage(b, 20, a, 'smoky'), 10);
  assert.equal(room.damage(b, 20, a, 'twins'), 20);
  // no friendly fire
  assert.equal(room.damage(c, 50, a, 'smoky'), 0);
  // self damage never applies
  assert.equal(room.damage(a, 50, a, 'thunder'), 0);
});

test('kill, score, assist and respawn timing', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'DM', bots: 0 });
  const a = human(room, 'A').p, b = human(room, 'B').p, d = human(room, 'D').p;
  for (const x of [a, b, d]) forceSpawn(room, x);
  room.damage(b, 40, d, 'smoky');          // assist
  room.damage(b, 1000, a, 'railgun');      // kill
  assert.ok(!b.alive);
  assert.equal(a.kills, 1);
  assert.equal(a.score, 10);
  assert.equal(d.assists, 1);
  assert.equal(d.score, 5);
  assert.equal(b.deaths, 1);
  const t0 = room.time;
  steps(room, RESPAWN_DELAY - 0.2);
  assert.ok(!b.alive, 'still dead before respawn delay');
  steps(room, 0.5);
  assert.ok(b.alive, 'respawned');
  assert.ok(b.protectedUntil > room.time && b.protectedUntil <= t0 + RESPAWN_DELAY + SPAWN_PROTECTION + 1);
  assert.equal(b.hp, b.maxHp);
});

test('capture the flag: take, capture, drop and return', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'CTF', bots: 0, timeLimit: 0, scoreLimit: 5, drops: false });
  const red = human(room, 'Red', TEAM.RED).p, blue = human(room, 'Blue', TEAM.BLUE).p;
  forceSpawn(room, red); forceSpawn(room, blue);
  const blueFlag = room.map.flags.blue, redBase = room.map.flags.red;
  place(red, [blueFlag[0], blueFlag[1] + 0.5, blueFlag[2] + 1], 0);
  steps(room, 1);
  assert.equal(red.flag, 'blue', 'red picked up the blue flag');
  assert.equal(room.flags.blue.state, 1);
  place(red, [redBase[0], redBase[1] + 0.5, redBase[2] + 1], 0);
  steps(room, 1);
  assert.equal(red.flag, null);
  assert.equal(room.teamScore[1], 1, 'red scored a capture');
  assert.equal(room.flags.blue.state, 0);
  assert.ok(red.score >= 110);
  // drop on death and return by owner
  place(red, [blueFlag[0], blueFlag[1] + 0.5, blueFlag[2] + 1], 0);
  steps(room, 1);
  assert.equal(red.flag, 'blue');
  room.kill(red, blue, 'smoky');
  assert.equal(room.flags.blue.state, 2, 'flag dropped');
  place(blue, [room.flags.blue.pos[0], room.flags.blue.pos[1] + 0.5, room.flags.blue.pos[2] + 1], 0);
  steps(room, 1);
  assert.equal(room.flags.blue.state, 0, 'owner returned the flag');
});

test('control points: capture, neutralise and scoring', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'CP', bots: 0, timeLimit: 0, scoreLimit: 30, drops: false });
  const red = human(room, 'Red', TEAM.RED).p, blue = human(room, 'Blue', TEAM.BLUE).p;
  forceSpawn(room, red); forceSpawn(room, blue);
  const pt = room.points[1];
  place(red, [pt.pos[0], pt.pos[1] + 0.5, pt.pos[2]], 0);
  place(blue, [0, 2, -40], 0);
  steps(room, CP_CAPTURE_SECONDS + 1);
  assert.equal(pt.owner, 1, 'red captured point B');
  assert.ok(red.score >= 30);
  steps(room, 6);
  assert.ok(room.teamScore[1] >= 2, 'holding a point scores');
  place(red, [0, 2, 40], 0);
  place(blue, [pt.pos[0], pt.pos[1] + 0.5, pt.pos[2]], 0);
  steps(room, CP_CAPTURE_SECONDS + 1);
  assert.equal(pt.owner, 0, 'blue neutralised the point');
  steps(room, CP_CAPTURE_SECONDS + 1);
  assert.equal(pt.owner, 2, 'blue captured the point');
});

test('battle ends on score limit and restarts', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'DM', bots: 0, timeLimit: 0, scoreLimit: 2 });
  const { p: a, c } = human(room, 'A'), b = human(room, 'B').p;
  forceSpawn(room, a); forceSpawn(room, b);
  room.kill(b, a, 'smoky');
  forceSpawn(room, b);
  room.kill(b, a, 'smoky');
  assert.equal(room.state, 'ended');
  const end = c.msgs.find((m) => m.t === 'end');
  assert.ok(end && end.results.winner === a.id);
  assert.ok(end.results.players[0].crystals > 0);
  steps(room, end.results.restartIn + 1);
  assert.equal(room.state, 'running');
  assert.equal(a.kills, 0);
  assert.ok(c.msgs.some((m) => m.t === 'restart'));
});

test('supplies: use, cooldown, mine placement and detonation', () => {
  const room = makeRoom({ map: 'sandbox', mode: 'DM', bots: 0 });
  const a = human(room, 'A').p, b = human(room, 'B').p;
  forceSpawn(room, a); forceSpawn(room, b);
  assert.ok(room.useSupply(a, 'nitro'));
  assert.ok(!room.useSupply(a, 'nitro'), 'cooldown blocks immediate reuse');
  assert.ok(a.fx.nitro > room.time);
  assert.ok(!room.useSupply(a, 'repair'), 'repair refused at full health');
  a.hp = 10;
  assert.ok(room.useSupply(a, 'repair'));
  steps(room, 4);
  assert.ok(a.hp > 90, `repaired to ${a.hp}`);
  place(a, [0, 2, -30], 0);
  assert.ok(room.useSupply(a, 'mine'));
  assert.equal(room.mines.length, 1);
  const mine = room.mines[0];
  steps(room, 1.5);
  assert.ok(mine.armed);
  const hpB = b.hp;
  place(b, [mine.pos[0], mine.pos[1] + 0.6, mine.pos[2]], 0);
  steps(room, 0.5);
  assert.equal(room.mines.length, 0, 'mine detonated');
  assert.ok(b.hp < hpB || !b.alive, 'mine damaged the enemy');
});

test('team balance and bot fill', () => {
  const room = makeRoom({ map: 'polygon', mode: 'TDM', bots: 6, maxPlayers: 10 });
  assert.equal(room.bots().length, 6);
  assert.ok(Math.abs(room.teamCount(1) - room.teamCount(2)) <= 1);
  const h1 = human(room, 'H1', TEAM.RED).p;
  const h2 = human(room, 'H2', TEAM.RED).p;
  assert.ok(Math.abs(room.teamCount(1) - room.teamCount(2)) <= 1, 'bots rebalance after humans join');
  assert.ok(room.switchTeam(h2, TEAM.BLUE) || room.teamCount(2) > room.teamCount(1));
  room.removePlayer(h1.id);
  assert.ok(!room.players.has(h1.id));
});

test('bot equipment respects rank and names are unique', () => {
  const rng = () => 0.42;
  const e = botEquipment(rng, 0);
  assert.ok(getHull(e.hull).rank <= 4 && getTurret(e.turret).rank <= 4);
  const taken = [];
  for (let i = 0; i < 20; i++) { const n = botName(() => i / 20, taken); assert.ok(!taken.includes(n)); taken.push(n); }
});

test('garage transactions', () => {
  const p = DEFAULT_PROFILE();
  p.crystals = 5000;
  assert.equal(garageOp(p, 'buy', 'turret', 'railgun').ok, false, 'rank too low');
  p.xp = RANKS[6].xp;
  assert.equal(garageOp(p, 'buy', 'turret', 'railgun').ok, true);
  assert.equal(p.crystals, 500);
  assert.equal(p.equipped.turret, 'railgun');
  assert.equal(garageOp(p, 'buy', 'turret', 'railgun').ok, false, 'already owned');
  assert.equal(garageOp(p, 'upgrade', 'turret', 'railgun').ok, false, 'not enough crystals');
  p.crystals = 100000;
  assert.equal(garageOp(p, 'upgrade', 'turret', 'smoky').ok, true);
  assert.equal(p.turrets.smoky, 1);
  assert.equal(garageOp(p, 'equip', 'turret', 'smoky').ok, true);
  assert.equal(garageOp(p, 'buy', 'paint', 'forest').ok, true);
  assert.equal(p.equipped.paint, 'forest');
  assert.equal(garageOp(p, 'buySupply', 'supply', 'mine', 10).ok, true);
  assert.equal(p.supplies.mine, 13);
  assert.equal(garageOp(p, 'equip', 'hull', 'mammoth').ok, false, 'cannot equip unowned hull');
});
