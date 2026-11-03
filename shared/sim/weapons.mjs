// Weapon behaviours for all turrets. Runs on the server inside a Room.
// The room supplies: pw, players, time, rng(), events[], damage(), heal(), explode(), isEnemy(), spawnProjectile()
import { vadd, vsub, vscale, vdot, vnorm, vlen, vcross, vdist, dirToYaw, angleDiff, clamp, qRotate } from './math.mjs';
import { MASK_STATIC, MASK_ALL } from './world.mjs';
import { TURRETS } from '../items.mjs';
import { MUZZLE_HEIGHT } from '../constants.mjs';
import * as CANNON from 'cannon-es';

export const TURRET_INDEX = Object.fromEntries(TURRETS.map((t, i) => [t.id, i]));
export const TURRET_TURN_SPEED = {
  smoky: 2.6, firebird: 2.8, twins: 2.6, isida: 2.8, railgun: 2.0, freeze: 2.8,
  thunder: 2.2, hammer: 2.6, ricochet: 2.5, striker: 2.3, vulcan: 1.9, shaft: 1.6,
};

export function newWeaponState(turret) {
  return {
    cd: 0, energy: turret.energy || 100, heat: 0, charge: 0, charging: false, overheated: false,
    clip: turret.clip || 0, reload: 0, spin: 0, firing: false, wasFire: false, target: null,
    lastShot: -99, barrel: 0, idle: 0, sniper: false, chargeStart: 0,
  };
}

/** Random unit vector perturbation of dir by up to `deg` degrees (cone). */
function spreadDir(rng, dir, deg) {
  if (!deg) return dir;
  const a = (deg * Math.PI) / 180;
  const u = rng(), v = rng();
  const theta = a * Math.sqrt(u);
  const phi = v * Math.PI * 2;
  let ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = vnorm(vcross(dir, ref));
  const t2 = vcross(dir, t1);
  const s = Math.sin(theta);
  return vnorm(vadd(vscale(dir, Math.cos(theta)), vadd(vscale(t1, s * Math.cos(phi)), vscale(t2, s * Math.sin(phi)))));
}

/** Muzzle position and base direction for a player's turret. */
export function muzzle(p) {
  const sim = p.sim;
  const pivot = sim.turretPivot();
  const dir = sim.turretDir();
  const up = sim.up;
  const len = sim.size[2] / 2 + 0.9;
  const from = vadd(vadd(pivot, vscale(dir, len)), vscale(up, MUZZLE_HEIGHT));
  return { from, dir, pivot, up };
}

/** Vertical auto-aim: tilt the shot toward an enemy that is almost in line horizontally. */
export function autoAim(room, p, from, dir, range, maxYawErr = 0.06, maxPitch = 0.6) {
  let best = null, bestErr = maxYawErr;
  const yaw = dirToYaw(dir);
  for (const o of room.players.values()) {
    if (o === p || !o.alive || !o.sim) continue;
    if (!room.isEnemy(p, o) && !(p.turret.kind === 'beam')) continue;
    const c = vadd(o.sim.pos, [0, 0.3, 0]);
    const d = vsub(c, from);
    const dist = vlen(d);
    if (dist > range || dist < 1) continue;
    const err = Math.abs(angleDiff(yaw, dirToYaw(d)));
    if (err < bestErr) {
      const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      if (Math.abs(pitch) > maxPitch) continue;
      bestErr = err; best = { o, d, dist };
    }
  }
  if (!best) return dir;
  // keep the horizontal heading, adopt the target's pitch
  const horiz = Math.hypot(best.d[0], best.d[2]) || 1e-6;
  const pitch = Math.atan2(best.d[1], horiz);
  const hd = vnorm([dir[0], 0, dir[2]]);
  return vnorm([hd[0] * Math.cos(pitch), Math.sin(pitch), hd[2] * Math.cos(pitch)]);
}

function fireHitscan(room, p, { damage, spread, range, crit = 0, critMult = 1, count = 1, barrel = 0, pierce = false }) {
  const { from, dir: baseDir } = muzzle(p);
  const aimed = autoAim(room, p, from, baseDir, range);
  const shots = [];
  for (let i = 0; i < count; i++) {
    const dir = spreadDir(room.rng, aimed, spread);
    const to = vadd(from, vscale(dir, range));
    if (pierce) {
      const hits = room.pw.raycastAll(from, to, { mask: MASK_ALL, ignore: p.sim.body });
      let end = to;
      const victims = [];
      for (const h of hits) {
        if (h.kind === 'tank') { victims.push(h); continue; }
        end = h.point; break;
      }
      for (const h of victims) room.damage(h.ref.owner, damage, p, p.turret.id, { pos: h.point });
      shots.push({ from, to: end, hit: null, b: barrel });
    } else {
      const hit = room.pw.raycast(from, to, { mask: MASK_ALL, ignore: p.sim.body });
      let dmg = damage, isCrit = false;
      if (crit > 0 && room.rng() < crit) { dmg *= critMult; isCrit = true; }
      if (hit && hit.kind === 'tank') room.damage(hit.ref.owner, dmg, p, p.turret.id, { pos: hit.point, crit: isCrit });
      shots.push({ from, to: hit ? hit.point : to, hit: hit ? { k: hit.kind, n: hit.normal.map((v) => +v.toFixed(2)) } : null, b: barrel });
    }
  }
  room.events.push({ e: 'shot', p: p.id, k: p.turret.id, s: shots.map((s) => ({
    f: s.from.map((v) => +v.toFixed(2)), t: s.to.map((v) => +v.toFixed(2)), h: s.hit, b: s.b })) });
}

function fireProjectile(room, p, { speed, damage, range, gravity = 0, splash = 0, splashMin = 0.3, bounces = 0, homing = 0, barrel = 0, spread = 0.6 }) {
  const { from, dir: baseDir, up } = muzzle(p);
  let dir = autoAim(room, p, from, baseDir, range, 0.08, 0.7);
  dir = spreadDir(room.rng, dir, spread);
  const right = vnorm(vcross(dir, up));
  const off = barrel === 0 ? 0 : barrel === 1 ? 0.45 : -0.45;
  const start = vadd(from, vscale(right, off));
  let target = null;
  if (homing) {
    let bestErr = 0.35;
    for (const o of room.players.values()) {
      if (o === p || !o.alive || !o.sim || !room.isEnemy(p, o)) continue;
      const d = vsub(o.sim.pos, start);
      const dist = vlen(d);
      if (dist > range) continue;
      const err = Math.acos(clamp(vdot(vnorm(d), dir), -1, 1));
      if (err < bestErr && room.pw.hasLineOfSight(start, vadd(o.sim.pos, [0, 0.3, 0]))) { bestErr = err; target = o.id; }
    }
  }
  room.spawnProjectile({
    kind: p.turret.id, pos: start, vel: vscale(dir, speed), owner: p.id, team: p.team,
    damage, range, gravity, splash, splashMin, bounces, homing, target, traveled: 0, born: room.time,
  });
  room.events.push({ e: 'fire', p: p.id, k: p.turret.id, f: start.map((v) => +v.toFixed(2)), d: dir.map((v) => +v.toFixed(2)), b: barrel });
}

/** Continuous cone weapons: firebird / freeze. Returns true if emitting. */
function updateStream(room, p, dt, fire) {
  const w = p.w, t = p.turret;
  if (w.overheated) {
    w.energy = Math.min(t.energy, w.energy + t.regen * dt);
    if (w.energy >= t.energy * 0.4) w.overheated = false;
    w.firing = false;
    return false;
  }
  if (!fire || w.energy <= 0) {
    w.energy = Math.min(t.energy, w.energy + t.regen * dt);
    if (w.energy <= 0) w.overheated = true;
    w.firing = false;
    return false;
  }
  w.energy -= t.drain * dt;
  if (w.energy <= 0) { w.energy = 0; w.overheated = true; }
  w.firing = true;
  const { from, dir } = muzzle(p);
  const hd = vnorm(dir);
  for (const o of room.players.values()) {
    if (o === p || !o.alive || !o.sim) continue;
    const enemy = room.isEnemy(p, o);
    if (!enemy && !(room.friendlyFire && o.team !== 0 && o.team === p.team)) continue;
    const c = vadd(o.sim.pos, [0, 0.2, 0]);
    const d = vsub(c, from);
    const dist = vlen(d);
    if (dist > t.range + 1.2) continue;
    const ang = Math.acos(clamp(vdot(vnorm(d), hd), -1, 1));
    const coneAt = t.cone + Math.atan2(1.4, Math.max(dist, 1));
    if (ang > coneAt) continue;
    if (!room.pw.hasLineOfSight(from, c)) continue;
    const falloff = 1 - 0.35 * clamp((dist - t.range * 0.5) / (t.range * 0.5), 0, 1);
    room.damage(o, t.dps * dt * falloff, p, t.id, { pos: c, silent: true });
    if (t.burnDps) { o.fx.burnUntil = room.time + t.burnTime; o.fx.burnDps = t.burnDps; o.fx.burnFrom = p.id; }
    if (t.slow) {
      const strength = clamp((o.fx.frozenUntil > room.time ? (1 - o.fx.frozenFactor) : 0) + dt * 0.9, 0, t.slow);
      o.fx.frozenFactor = 1 - strength;
      o.fx.frozenUntil = room.time + t.slowTime;
    }
  }
  return true;
}

/** Isida beam. */
function updateBeam(room, p, dt, fire) {
  const w = p.w, t = p.turret;
  w.target = null;
  if (w.overheated) {
    w.energy = Math.min(t.energy, w.energy + t.regen * dt);
    if (w.energy >= t.energy * 0.4) w.overheated = false;
    w.firing = false;
    return;
  }
  if (!fire) {
    w.energy = Math.min(t.energy, w.energy + t.regen * dt);
    w.firing = false;
    return;
  }
  const { from, dir } = muzzle(p);
  let best = null, bestScore = -Infinity;
  for (const o of room.players.values()) {
    if (o === p || !o.alive || !o.sim) continue;
    const enemy = room.isEnemy(p, o);
    const ally = !enemy && p.team !== 0 && o.team === p.team;
    if (!enemy && !ally) continue;
    if (ally && o.hp >= o.maxHp - 0.5) continue;
    const c = vadd(o.sim.pos, [0, 0.2, 0]);
    const d = vsub(c, from);
    const dist = vlen(d);
    if (dist > t.range) continue;
    const ang = Math.acos(clamp(vdot(vnorm(d), dir), -1, 1));
    if (ang > t.cone + Math.atan2(1.2, Math.max(dist, 1))) continue;
    if (!room.pw.hasLineOfSight(from, c)) continue;
    const score = (enemy ? 10 : 5) - dist * 0.1 - ang;
    if (score > bestScore) { bestScore = score; best = { o, enemy, c }; }
  }
  if (!best) { w.firing = false; w.energy = Math.min(t.energy, w.energy + t.regen * dt * 0.5); return; }
  w.energy -= t.drain * dt;
  if (w.energy <= 0) { w.energy = 0; w.overheated = true; }
  w.firing = true;
  w.target = best.o.id;
  if (best.enemy) {
    const dealt = room.damage(best.o, t.dps * dt, p, t.id, { pos: best.c, silent: true });
    if (dealt > 0) room.heal(p, dealt * t.selfHeal, p);
  } else {
    room.heal(best.o, t.heal * dt, p);
  }
}

/** Per-tick weapon update for one player. */
export function updateWeapon(room, p, dt) {
  const w = p.w, t = p.turret;
  const fire = !!p.controls.fire && p.alive && !!p.sim && room.state === 'running';
  const pressed = fire && !w.wasFire;
  const released = !fire && w.wasFire;
  w.wasFire = fire;
  if (w.cd > 0) w.cd -= dt;
  w.idle += dt;
  w.sniper = false;

  switch (t.kind) {
    case 'stream':
      updateStream(room, p, dt, fire);
      break;
    case 'beam':
      updateBeam(room, p, dt, fire);
      break;
    case 'rail': {
      if (w.charging) {
        w.charge += dt;
        if (w.charge >= t.charge) {
          w.charging = false; w.charge = 0; w.cd = t.cooldown; w.idle = 0;
          fireHitscan(room, p, { damage: t.damage, spread: 0, range: t.range, pierce: true });
        }
      } else if (pressed && w.cd <= 0) {
        w.charging = true; w.charge = 0;
        room.events.push({ e: 'charge', p: p.id, k: t.id, d: t.charge });
      }
      w.firing = w.charging;
      break;
    }
    case 'hitscan': {
      if (t.id === 'shaft') {
        if (w.charging) {
          w.charge = Math.min(t.chargeTime, w.charge + dt);
          w.sniper = w.charge > 0.25;
          if (released) {
            const frac = w.charge / t.chargeTime;
            const dmg = w.charge < 0.25 ? t.damage : t.damage + (t.chargedDamage - t.damage) * frac;
            w.charging = false; w.charge = 0; w.cd = t.cooldown; w.idle = 0;
            fireHitscan(room, p, { damage: dmg, spread: t.spread, range: t.range });
          }
        } else if (pressed && w.cd <= 0) {
          w.charging = true; w.charge = 0;
        }
        w.firing = w.charging;
      } else if (t.id === 'vulcan') {
        if (w.overheated) {
          w.heat = Math.max(0, w.heat - t.cool * dt);
          if (w.heat <= t.heat * 0.3) w.overheated = false;
          w.spin = Math.max(0, w.spin - dt * 1.5);
          w.firing = false;
        } else if (fire) {
          w.spin = Math.min(t.spinup + 0.01, w.spin + dt);
          if (w.spin >= t.spinup) {
            w.firing = true;
            w.heat += t.heatRate * dt;
            if (w.heat >= t.heat) { w.heat = t.heat; w.overheated = true; }
            if (w.cd <= 0) {
              w.cd = t.cooldown; w.idle = 0;
              fireHitscan(room, p, { damage: t.damage, spread: t.spread, range: t.range, barrel: (w.barrel = (w.barrel + 1) % 6) });
              if (t.recoil && p.sim) {
                const d = p.sim.turretDir();
                p.sim.body.applyImpulse(new CANNON.Vec3(-d[0] * t.recoil * p.sim.body.mass * 0.02, 0, -d[2] * t.recoil * p.sim.body.mass * 0.02), new CANNON.Vec3(0, 0, 0));
              }
            }
          } else {
            w.firing = false;
          }
        } else {
          w.spin = Math.max(0, w.spin - dt * 1.5);
          w.heat = Math.max(0, w.heat - t.cool * dt);
          w.firing = false;
        }
        w.charge = w.spin / t.spinup;
      } else if (t.id === 'hammer') {
        // clip weapon
        if (w.clip <= 0) {
          w.reload += dt;
          if (w.reload >= t.reload) { w.clip = t.clip; w.reload = 0; }
        } else if (w.idle > 1.8 && w.clip < t.clip) {
          w.reload += dt;
          if (w.reload >= t.reload / t.clip) { w.clip++; w.reload = 0; }
        }
        w.firing = false;
        if (pressed && w.cd <= 0 && w.clip > 0) {
          w.clip--; w.cd = t.cooldown; w.idle = 0; w.reload = 0;
          fireHitscan(room, p, { damage: t.damage, spread: t.spread, range: t.range, count: t.pellets });
        }
        w.charge = w.clip / t.clip;
      } else {
        // smoky and similar: auto fire while held
        w.firing = false;
        if (fire && w.cd <= 0) {
          w.cd = t.cooldown; w.idle = 0;
          fireHitscan(room, p, { damage: t.damage, spread: t.spread, range: t.range, crit: t.crit, critMult: t.critMult });
        }
      }
      break;
    }
    case 'projectile': {
      w.firing = false;
      if (t.clip) {
        if (w.clip <= 0) {
          w.reload += dt;
          if (w.reload >= t.reload) { w.clip = t.clip; w.reload = 0; }
        } else if (w.idle > 1.8 && w.clip < t.clip) {
          w.reload += dt;
          if (w.reload >= t.reload / t.clip) { w.clip++; w.reload = 0; }
        }
        if (fire && w.cd <= 0 && w.clip > 0) {
          w.clip--; w.cd = t.cooldown; w.idle = 0; w.reload = 0;
          fireProjectile(room, p, { speed: t.speed, damage: t.damage, range: t.range, gravity: t.gravity, splash: t.splash, splashMin: t.splashMin, homing: t.homing, barrel: (w.barrel = (w.barrel + 1) % 3), spread: 0.4 });
        }
        w.charge = w.clip / t.clip;
      } else if (fire && w.cd <= 0) {
        w.cd = t.cooldown; w.idle = 0;
        const barrel = t.id === 'twins' ? (w.barrel = w.barrel === 1 ? 2 : 1) : 0;
        fireProjectile(room, p, { speed: t.speed, damage: t.damage, range: t.range, gravity: t.gravity, splash: t.splash, splashMin: t.splashMin, bounces: t.bounces, barrel, spread: t.id === 'twins' ? 1.2 : 0.4 });
      }
      break;
    }
  }
}

/** Advance all projectiles in the room. */
export function updateProjectiles(room, dt) {
  const list = room.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    // homing
    if (pr.homing && pr.target != null) {
      const tgt = room.players.get(pr.target);
      if (tgt && tgt.alive && tgt.sim) {
        const want = vnorm(vsub(vadd(tgt.sim.pos, [0, 0.3, 0]), pr.pos));
        const speed = vlen(pr.vel);
        const cur = vnorm(pr.vel);
        const maxTurn = pr.homing * dt;
        const ang = Math.acos(clamp(vdot(cur, want), -1, 1));
        let nd;
        if (ang <= maxTurn) nd = want;
        else {
          const axis = vnorm(vcross(cur, want));
          // rotate cur toward want by maxTurn (Rodrigues)
          const c = Math.cos(maxTurn), s = Math.sin(maxTurn);
          nd = vadd(vadd(vscale(cur, c), vscale(vcross(axis, cur), s)), vscale(axis, vdot(axis, cur) * (1 - c)));
        }
        pr.vel = vscale(vnorm(nd), speed);
      } else pr.target = null;
    }
    if (pr.gravity) pr.vel = [pr.vel[0], pr.vel[1] - pr.gravity * dt, pr.vel[2]];
    const step = vscale(pr.vel, dt);
    const next = vadd(pr.pos, step);
    const ownerBody = room.players.get(pr.owner)?.sim?.body || null;
    const hit = room.pw.raycast(pr.pos, next, { mask: MASK_ALL, ignore: pr.age < 0.15 ? ownerBody : null });
    pr.age = (pr.age || 0) + dt;
    pr.traveled += vlen(step);
    if (hit) {
      const owner = room.players.get(pr.owner) || null;
      if (hit.kind === 'tank') {
        const victim = hit.ref.owner;
        if (pr.splash) {
          room.explode(hit.point, pr.splash, pr.damage, pr.splashMin, owner, pr.kind, victim);
        } else {
          room.damage(victim, pr.damage, owner, pr.kind, { pos: hit.point });
          room.events.push({ e: 'impact', k: pr.kind, p: hit.point.map((v) => +v.toFixed(2)), n: hit.normal.map((v) => +v.toFixed(2)), t: 1 });
        }
        list.splice(i, 1);
        continue;
      }
      if (pr.bounces > 0) {
        pr.bounces--;
        const n = hit.normal;
        const v = pr.vel;
        const refl = vsub(v, vscale(n, 2 * vdot(v, n)));
        pr.vel = vscale(refl, 0.98);
        pr.pos = vadd(hit.point, vscale(n, 0.08));
        room.events.push({ e: 'bounce', k: pr.kind, p: pr.pos.map((v) => +v.toFixed(2)), n: n.map((v) => +v.toFixed(2)) });
        continue;
      }
      if (pr.splash) room.explode(hit.point, pr.splash, pr.damage, pr.splashMin, owner, pr.kind, null);
      else room.events.push({ e: 'impact', k: pr.kind, p: hit.point.map((v) => +v.toFixed(2)), n: hit.normal.map((v) => +v.toFixed(2)), t: 0 });
      list.splice(i, 1);
      continue;
    }
    pr.pos = next;
    if (pr.traveled > pr.range || pr.pos[1] < -30 || pr.age > 8) {
      if (pr.splash && pr.gravity) room.explode(pr.pos, pr.splash, pr.damage, pr.splashMin, room.players.get(pr.owner) || null, pr.kind, null);
      list.splice(i, 1);
    }
  }
}
