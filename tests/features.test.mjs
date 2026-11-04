// Containers, augments, drones, clans, Rugby and Siege.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from '../server/room.mjs';
import { garageOp } from '../server/garage.mjs';
import { ClanStore } from '../server/clans.mjs';
import { DEFAULT_PROFILE, turretStats } from '../shared/items.mjs';
import { openContainer } from '../shared/containers.mjs';
import { applyAugment } from '../shared/augments.mjs';
import { DRONES } from '../shared/drones.mjs';
import { GOAL_RADIUS } from '../shared/constants.mjs';

const DT = 1 / 60;
const fakeClient = () => { const msgs = []; return { msgs, send(m) { msgs.push(m); } }; };
const makeRoom = (opts) => new Room({ seed: 1, ...opts }, { onProfile() {}, onEnd() {} });
const steps = (room, seconds, fn) => { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) { if (fn) fn(i); room.step(DT); } };
const human = (room, name, team = 0) => { const c = fakeClient(); const p = DEFAULT_PROFILE(); p.name = name; const pl = room.addHuman(c, p, team); pl.lastInputAt = 1e9; return { p: pl, c, profile: p }; };
const forceSpawn = (room, pl) => { pl.respawnAt = -1; room.step(DT); pl.protectedUntil = 0; };
const events = (c, type) => c.msgs.filter((m) => m.t === 'ev').flatMap((m) => m.ev).filter((e) => e.e === type);

test('containers give rewards and count down', () => {
  const p = DEFAULT_PROFILE();
  p.containers = 3;
  let n = 0;
  const seq = [0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4];
  const rng = () => seq[n++ % seq.length];
  const r1 = openContainer(p, rng);
  assert.ok(r1 && r1.text, 'reward text');
  assert.equal(p.containers, 2);
  openContainer(p, rng); openContainer(p, rng);
  assert.equal(p.containers, 0);
  assert.equal(openContainer(p, rng), null);
  assert.equal(p.containersOpened, 3);
});

test('augments change turret stats and the garage sells, equips and removes them', () => {
  const base = turretStats('smoky', 0);
  const s = applyAugment({ ...base, id: 'smoky' }, 'smoky_gunslinger');
  assert.ok(s.cooldown < base.cooldown, 'faster reload');
  const p = DEFAULT_PROFILE();
  p.crystals = 10000; p.xp = 100000;
  assert.equal(garageOp(p, 'buyAugment', 'turret', 'thunder_heavy').ok, false, 'needs the turret');
  assert.equal(garageOp(p, 'buyAugment', 'turret', 'smoky_gunslinger').ok, true);
  assert.equal(p.augments.smoky, 'smoky_gunslinger');
  assert.equal(garageOp(p, 'equipAugment', 'smoky', null).ok, true);
  assert.equal(p.augments.smoky, undefined);
  assert.equal(garageOp(p, 'equipAugment', 'smoky', 'smoky_gunslinger').ok, true);
  assert.equal(p.augments.smoky, 'smoky_gunslinger');
});

test('drones are bought, equipped and removed through the garage', () => {
  const p = DEFAULT_PROFILE();
  p.crystals = 10000; p.xp = 100000;
  const d = DRONES[0];
  assert.equal(garageOp(p, 'buyDrone', 'drone', d.id).ok, true);
  assert.equal(p.equipped.drone, d.id);
  assert.equal(garageOp(p, 'equipDrone', 'drone', null).ok, true);
  assert.equal(p.equipped.drone, null);
  assert.equal(garageOp(p, 'equipDrone', 'drone', 'reaper').ok, false, 'not owned');
});

test('clan store creates, joins, kicks, lists and leaves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clans-'));
  const cs = new ClanStore(dir);
  const c = cs.create('Alice', 'TNK', 'Tankers');
  assert.equal(c.ok, true, c.msg);
  assert.equal(cs.create('Bob', 'TNK', 'Duplicate').ok, false, 'tag taken');
  assert.equal(cs.join('Bob', 'TNK').ok, true);
  assert.equal(cs.byMember('bob').tag, 'TNK');
  assert.equal(cs.kick('Bob', 'Alice').ok, false, 'only the leader kicks');
  assert.equal(cs.kick('Alice', 'Bob').ok, true);
  assert.equal(cs.byMember('Bob'), null);
  const list = cs.list(() => 5);
  assert.equal(list.length, 1);
  assert.equal(list[0].tag, 'TNK');
  assert.ok(cs.leave('Alice').ok);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rugby: the ball is picked up, carried into the enemy goal and scores', () => {
  const room = makeRoom({ map: 'arena', mode: 'RGB', bots: 0, timeLimit: 10, scoreLimit: 5 });
  const { p, c } = human(room, 'Carrier', 1);
  forceSpawn(room, p);
  assert.ok(room.ball, 'ball exists');
  p.sim.teleport([room.ball.pos[0], room.ball.pos[1] + 0.5, room.ball.pos[2]], 0);
  steps(room, 1, () => { p.lastInputAt = room.time; });
  assert.equal(room.ball.carrier, p.id, 'picked up');
  assert.ok(events(c, 'ball').some((e) => e.a === 'taken'));
  const goal = room.map.flags.blue; // red attacks the blue goal
  p.sim.teleport([goal[0], goal[1] + 0.5, goal[2]], 0);
  steps(room, 1, () => { p.lastInputAt = room.time; });
  assert.equal(room.teamScore[1], 1, 'red scored');
  assert.ok(events(c, 'ball').some((e) => e.a === 'goal' && e.team === 1));
  assert.ok(room.ball.carrier == null, 'ball reset after the goal');
  assert.ok(GOAL_RADIUS > 0);
});

test('siege: rounds start, snapshots carry the siege state and capturing scores', () => {
  const room = makeRoom({ map: 'highland', mode: 'SGE', bots: 0, timeLimit: 10, scoreLimit: 3 });
  const { p, c } = human(room, 'Attacker', room.siege ? room.siege.attacker : 1);
  forceSpawn(room, p);
  assert.ok(room.siege, 'siege state');
  assert.equal(room.siege.round, 1);
  const snap = room.snapshot();
  assert.ok(Array.isArray(snap.sg) && snap.sg.length === 6, 'sg in snapshot');
  const pt = room.points[0].pos;
  p.sim.teleport([pt[0], pt[1] + 0.5, pt[2]], 0);
  steps(room, 25, () => { p.lastInputAt = room.time; });
  assert.ok(events(c, 'siege').some((e) => e.a === 'captured'), 'captured');
  assert.equal(room.teamScore[1] + room.teamScore[2], 1, 'one point scored');
});
