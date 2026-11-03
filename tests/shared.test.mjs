// Unit tests for shared data, maps, navigation, physics and protocol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HULLS, TURRETS, PAINTS, SUPPLIES, RANKS, hullStats, turretStats, upgradePrice, upgradeRank, rankForXp, rankProgress, DEFAULT_PROFILE, MAX_MOD } from '../shared/items.mjs';
import { buildMap, MAP_LIST, randomSpawn } from '../shared/maps.mjs';
import { getNav, finalizeMap } from '../shared/sim/nav.mjs';
import { PhysWorld } from '../shared/sim/world.mjs';
import { TankSim } from '../shared/sim/tank.mjs';
import { packTank, unpackTank, TS } from '../shared/protocol.mjs';
import { angleDiff, qRotate, qYaw, qToYaw } from '../shared/sim/math.mjs';
import { mulberry32 } from '../shared/noise.mjs';

test('catalog ids are unique and prices/ranks are sane', () => {
  for (const list of [HULLS, TURRETS, PAINTS, SUPPLIES]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const it of list) { assert.ok(it.price >= 0); assert.ok((it.rank || 0) >= 0 && (it.rank || 0) < RANKS.length); }
  }
  assert.equal(TURRETS.length, 12);
  assert.equal(HULLS.length, 7);
  assert.equal(RANKS.length, 30);
  assert.equal(RANKS[0].name, 'Recruit');
  assert.equal(RANKS[RANKS.length - 1].name, 'Generalissimo');
});

test('modifications improve stats and cost more', () => {
  for (const h of HULLS) {
    const m0 = hullStats(h.id, 0), m3 = hullStats(h.id, MAX_MOD);
    assert.ok(m3.hp > m0.hp && m3.speed > m0.speed);
    assert.ok(upgradePrice(h, 1) < upgradePrice(h, 2) && upgradePrice(h, 2) < upgradePrice(h, 3));
    assert.ok(upgradeRank(h, 3) > upgradeRank(h, 1));
  }
  for (const t of TURRETS) {
    const m0 = turretStats(t.id, 0), m3 = turretStats(t.id, MAX_MOD);
    if (t.damage) assert.ok(m3.damage > m0.damage, t.id);
    if (t.dps) assert.ok(m3.dps > m0.dps, t.id);
    if (t.cooldown) assert.ok(m3.cooldown < m0.cooldown, t.id);
  }
});

test('rank progression', () => {
  assert.equal(rankForXp(0).index, 0);
  assert.equal(rankForXp(99).index, 0);
  assert.equal(rankForXp(100).index, 1);
  assert.equal(rankForXp(1400000).index, 29);
  const p = rankProgress(300);
  assert.equal(p.rank.name, 'Private');
  assert.equal(p.next.name, 'Gefreiter');
  assert.ok(p.frac > 0.49 && p.frac < 0.51);
  const prof = DEFAULT_PROFILE();
  assert.equal(prof.equipped.hull, 'wasp');
  assert.equal(prof.hulls.wasp, 0);
  assert.ok(prof.crystals > 0);
});

test('snapshot pack/unpack round trip', () => {
  const t = { id: 7, pos: [1.234, 5.678, -9.1], quat: qYaw(0.7), turretYaw: -1.2, hp: 88.4, flags: 2 | 64, charge: 0.5, energy: 42, target: 3, speed: -4.2 };
  const a = packTank(t);
  assert.equal(a.length, TS.LENGTH);
  const u = unpackTank(a);
  assert.equal(u.id, 7);
  assert.ok(Math.abs(u.pos[0] - 1.23) < 1e-6);
  assert.equal(u.hp, 88);
  assert.equal(u.flags, 66);
  assert.equal(u.target, 3);
  assert.ok(Math.abs(u.turretYaw + 1.2) < 0.001);
  assert.ok(Math.abs(qToYaw(u.quat) - 0.7) < 0.01);
});

test('math helpers', () => {
  assert.ok(Math.abs(angleDiff(0.1, -0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(angleDiff(3.1, -3.1) - (2 * Math.PI - 6.2)) < 1e-9);
  const f = qRotate(qYaw(Math.PI / 2), [0, 0, 1]);
  assert.ok(Math.abs(f[0] - 1) < 1e-9 && Math.abs(f[2]) < 1e-9);
});

test('maps build deterministically with valid objectives', () => {
  for (const m of MAP_LIST) {
    const a = buildMap(m.id), b = buildMap(m.id);
    assert.deepEqual(a.heights[3], b.heights[3]);
    assert.ok(a.props.length > 10);
    assert.ok(a.spawns.dm.length >= 6 && a.spawns.red.length >= 4 && a.spawns.blue.length >= 4);
    for (const s of [...a.spawns.dm, ...a.spawns.red, ...a.spawns.blue]) {
      assert.ok(Math.abs(s.pos[0]) < a.halfW && Math.abs(s.pos[2]) < a.halfL, `${m.id} spawn inside bounds`);
      assert.ok(Number.isFinite(s.pos[1]));
    }
    // heightAt matches grid samples exactly
    const i = 5, j = 7;
    const x = -a.halfW + i * a.cell, z = a.halfL - j * a.cell;
    assert.ok(Math.abs(a.heightAt(x, z) - a.heights[i][j]) < 1e-9);
  }
});

test('navigation grid: spawns and objectives are reachable', () => {
  for (const m of MAP_LIST) {
    const map = finalizeMap(buildMap(m.id));
    const nav = getNav(map);
    for (const s of [...map.spawns.dm, ...map.spawns.red, ...map.spawns.blue]) assert.ok(!nav.isBlocked(s.pos[0], s.pos[2]), `${m.id} spawn free`);
    for (const c of ['red', 'blue']) assert.ok(!nav.isBlocked(map.flags[c][0], map.flags[c][2]), `${m.id} flag free`);
    for (const p of map.points) assert.ok(!nav.isBlocked(p.pos[0], p.pos[2]), `${m.id} point free`);
    const p1 = nav.findPath([map.spawns.red[0].pos[0], map.spawns.red[0].pos[2]], [map.flags.blue[0], map.flags.blue[2]]);
    const p2 = nav.findPath([map.spawns.blue[0].pos[0], map.spawns.blue[0].pos[2]], [map.flags.red[0], map.flags.red[2]]);
    assert.ok(p1 && p1.length > 0, `${m.id} red -> blue flag path`);
    assert.ok(p2 && p2.length > 0, `${m.id} blue -> red flag path`);
    for (const pt of map.points) {
      const p = nav.findPath([map.spawns.dm[0].pos[0], map.spawns.dm[0].pos[2]], [pt.pos[0], pt.pos[2]]);
      assert.ok(p && p.length > 0, `${m.id} path to point ${pt.id}`);
    }
  }
});

test('daily missions are deterministic per player and day', async () => {
  const { generateMissions, ensureMissions, addMissionProgress, dayKey } = await import('../shared/missions.mjs');
  const a = generateMissions('Alice', '2026-11-03'), b = generateMissions('Alice', '2026-11-03'), c = generateMissions('Bob', '2026-11-03'), d = generateMissions('Alice', '2026-11-04');
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.ok(JSON.stringify(a) !== JSON.stringify(c) || JSON.stringify(a) !== JSON.stringify(d));
  for (const m of a) { assert.ok(m.target > 0 && m.reward >= 50 && !m.claimed && m.text.includes(String(m.target))); }
  const profile = DEFAULT_PROFILE();
  profile.name = 'Alice';
  const block = ensureMissions(profile);
  assert.equal(block.day, dayKey());
  const mission = block.list[0];
  const done = addMissionProgress(profile, mission.type, mission.target, mission.modes ? mission.modes[0] : 'DM');
  assert.equal(done.length, 1);
  assert.equal(profile.crystals, 2000 + mission.reward);
  assert.deepEqual(addMissionProgress(profile, mission.type, 5, 'DM'), [], 'claimed missions do not progress again');
});

test('random spawn avoids occupied positions', () => {
  const map = finalizeMap(buildMap('sandbox'));
  const rng = mulberry32(3);
  const taken = map.spawns.dm.slice(0, 5).map((s) => s.pos);
  for (let i = 0; i < 20; i++) {
    const s = randomSpawn(map, 0, rng, taken);
    const minD = Math.min(...taken.map((t) => Math.hypot(t[0] - s.pos[0], t[2] - s.pos[2])));
    assert.ok(minD > 5, 'spawn away from occupied spots');
  }
});

test('tank physics: accelerates to top speed, stays upright, climbs the ramp, idles without drift', () => {
  const map = finalizeMap(buildMap('sandbox'));
  const pw = new PhysWorld(map);
  const dt = 1 / 60;
  const wasp = hullStats('wasp');
  const t1 = new TankSim(pw, wasp, [44, map.heightAt(44, -44), -44], 0);
  const t2 = new TankSim(pw, hullStats('mammoth'), [20, map.heightAt(20, 10), 10], Math.PI / 3);
  const t3 = new TankSim(pw, hullStats('hunter'), [3, map.heightAt(3, -36), -36], 0);
  let maxSpeed = 0, maxY3 = 0, minUp = 1;
  const start2 = t2.pos;
  for (let i = 0; i < 60 * 6; i++) {
    t1.update(dt, { f: 1, t: 0 });
    t2.update(dt, { f: 0, t: 0 });
    t3.update(dt, { f: i < 60 * 4 ? 1 : 0, t: 0 });
    pw.step(dt);
    maxSpeed = Math.max(maxSpeed, t1.speed);
    maxY3 = Math.max(maxY3, t3.pos[1]);
    minUp = Math.min(minUp, t1.up[1], t2.up[1], t3.up[1]);
    for (const t of [t1, t2, t3]) for (const v of t.pos) assert.ok(Number.isFinite(v), 'finite position');
  }
  assert.ok(maxSpeed > wasp.speed * 0.9 && maxSpeed < wasp.speed + 0.5, `top speed ${maxSpeed}`);
  assert.ok(t1.pos[2] > 0, 'tank travelled forward');
  assert.ok(maxY3 > 3.5, `hunter climbed the ramp (max y ${maxY3})`);
  assert.ok(Math.hypot(t2.pos[0] - start2[0], t2.pos[2] - start2[2]) < 0.3, 'idle tank does not drift');
  assert.ok(minUp > 0.9, 'tanks stay upright');
});
