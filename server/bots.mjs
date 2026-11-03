// Bot AI: target selection, objective navigation (A* over the nav grid), obstacle avoidance, aiming and supply use.
import { HULLS, TURRETS, PAINTS } from '../shared/items.mjs';
import { MASK_STATIC } from '../shared/sim/world.mjs';
import { getNav } from '../shared/sim/nav.mjs';
import { angleDiff, clamp, vadd, vsub, vscale, vdistXZ, vlen, vnorm, dirToYaw, yawToDir } from '../shared/sim/math.mjs';

export const BOT_SUPPLIES = { repair: 2, da: 2, dd: 2, nitro: 2, mine: 3 };

const NAMES = [
  'Ghost_Rider', 'IronFist', 'Nitro_Boss', 'Shadow_Wolf', 'TankDestroyer', 'Cpt_Kirk', 'Vulkan99', 'Blitz', 'RedBaron',
  'Sniper_Elite', 'Kamikaze', 'Mr_Smoky', 'FlameOn', 'Frosty', 'Lord_Rail', 'Thunderbolt', 'Bouncer', 'Hammer_Time',
  'Striker_X', 'Isida_Med', 'Mammoth_Jr', 'Wasp_Sting', 'Titan_Fall', 'Hornet_Nest', 'Dictator_V', 'Viking_Raid', 'Hunter_Kill',
  'NoScope', 'Twinsy', 'Crystal_Hunter', 'Gold_Digger', 'Flag_Runner', 'Point_Guard', 'Rookie_Rick', 'Veteran_Vic', 'Major_Pain',
  'Sgt_Pepper', 'Tanker_Tom', 'Lt_Dan', 'Colonel_K', 'Marshal_M', 'General_G', 'Captain_C', 'Private_P', 'Recruit_R',
];

export function botName(rng, taken) {
  const pool = NAMES.filter((n) => !taken.includes(n));
  if (pool.length) return pool[Math.floor(rng() * pool.length)];
  return 'Bot_' + Math.floor(rng() * 9000 + 1000);
}

export function botEquipment(rng, humanRank) {
  const maxRank = Math.max(4, humanRank + 3);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const hull = pick(HULLS.filter((h) => h.rank <= maxRank));
  const turret = pick(TURRETS.filter((t) => t.rank <= maxRank));
  const paint = pick(PAINTS.filter((p) => p.rank <= maxRank));
  const mod = Math.min(3, Math.floor(rng() * (1 + humanRank / 4)));
  const rank = clamp(Math.round(humanRank + rng() * 5 - 2), 0, 30);
  return { hull: hull.id, hullMod: mod, turret: turret.id, turretMod: Math.max(0, mod - (rng() < 0.4 ? 1 : 0)), paint: paint.id, rank };
}

const PREFERRED_RANGE = {
  firebird: 7, freeze: 7, isida: 9, hammer: 12, vulcan: 22, twins: 22, smoky: 26, ricochet: 26, striker: 28, thunder: 30, railgun: 42, shaft: 50,
};

function whisker(room, p, yawOffset, len) {
  const sim = p.sim;
  const yaw = sim.yaw + yawOffset;
  const dir = yawToDir(yaw);
  const from = vadd(vadd(sim.pos, vscale(dir, sim.size[2] / 2 + 0.2)), [0, 0.3, 0]);
  const to = vadd(from, vscale(dir, len));
  const hit = room.pw.raycast(from, to, { mask: MASK_STATIC });
  if (!hit) return len;
  if (hit.normal[1] > 0.7) return len; // drivable slope
  return hit.distance;
}

function validTarget(room, p, id) {
  if (id == null) return false;
  const o = room.players.get(id);
  return !!(o && o.alive && o.sim && room.isEnemy(p, o));
}

function eye(p) {
  return { from: vadd(p.sim.turretPivot(), [0, 0.5, 0]) };
}

function pickTarget(room, p) {
  const sim = p.sim;
  const { from } = eye(p);
  let best = null, bestScore = -Infinity;
  for (const o of room.players.values()) {
    if (o === p || !o.alive || !o.sim || !room.isEnemy(p, o)) continue;
    if (o.protectedUntil > room.time) continue;
    const d = vdistXZ(sim.pos, o.sim.pos);
    if (d > 95) continue;
    const los = room.pw.hasLineOfSight(from, vadd(o.sim.pos, [0, 0.3, 0]));
    let s = 100 - d + (los ? 45 : 0);
    if (o.flag) s += 40;
    if (o.jugger) s += 70;
    if (room.ball && room.ball.carrier === o.id) s += 80;
    if (o.hp < o.maxHp * 0.3) s += 15;
    if (d < p.turret.range) s += 10;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return best ? best.id : null;
}

function pickGoal(room, p) {
  const b = p.bot, sim = p.sim, map = room.map, rng = room.rng;
  const pos = sim.pos;
  const jitter = (pt, r = 5) => [pt[0] + (rng() - 0.5) * r * 2, pt[1], pt[2] + (rng() - 0.5) * r * 2];
  const objective = (goal) => ({ ...goal, hold: 8 + rng() * 6 });
  if (room.mode === 'CTF' && p.flag) return objective({ pos: map.flags[p.team === 1 ? 'red' : 'blue'], kind: 'home' });
  // tempting drops
  const drops = room.drops.filter((d) => d.landed || d.pos[1] - d.ground < 6);
  for (const d of drops) {
    const dist = vdistXZ(pos, d.pos);
    if (d.type === 'gold' && dist < 70) return { pos: d.pos, kind: 'drop', hold: 10 };
    if (d.type === 'repair' && p.hp < p.maxHp * 0.5 && dist < 35) return { pos: d.pos, kind: 'drop', hold: 6 };
    if (dist < 12 && rng() < 0.5) return { pos: d.pos, kind: 'drop', hold: 4 };
  }
  if (room.mode === 'CTF' && p.team) {
    const own = p.team === 1 ? 'red' : 'blue', enemy = p.team === 1 ? 'blue' : 'red';
    const fo = room.flags[own], fe = room.flags[enemy];
    if (fo.state !== 0 && (b.role === 'defend' || rng() < 0.5)) return objective({ pos: fo.pos, kind: 'ownflag' });
    if (b.role === 'attack' || rng() < 0.3) {
      if (fe.state === 1) {
        const carrier = room.players.get(fe.carrier);
        if (carrier && carrier.team === p.team) return objective({ pos: jitter(carrier.sim ? carrier.sim.pos : fe.pos, 6), kind: 'escort' });
      }
      return objective({ pos: fe.pos, kind: 'enemyflag' });
    }
    return { pos: jitter(map.flags[own], 9), kind: 'defend', hold: 5 + rng() * 5 };
  }
  if (room.mode === 'RGB' && p.team && room.ball) {
    const ball = room.ball;
    const own = p.team === 1 ? 'red' : 'blue', enemy = p.team === 1 ? 'blue' : 'red';
    if (ball.carrier === p.id) return objective({ pos: map.flags[enemy], kind: 'home' });
    if (ball.carrier == null) {
      if (b.role === 'attack' || rng() < 0.5) return { pos: ball.pos, kind: 'ball', hold: 3 };
      return { pos: jitter(map.flags[own], 8), kind: 'defend', hold: 4 + rng() * 4 };
    }
    const carrier = room.players.get(ball.carrier);
    if (carrier && carrier.team === p.team) return objective({ pos: jitter(carrier.sim ? carrier.sim.pos : ball.pos, 7), kind: 'escort' });
    if (carrier && carrier.sim) return { pos: carrier.sim.pos, kind: 'carrier', hold: 2 };
  }
  if (room.mode === 'SGE' && p.team && room.siege) {
    const pt = room.points[0];
    if (p.team === room.siege.attacker) return objective({ pos: jitter(pt.pos, 3), kind: 'point' });
    return { pos: jitter(pt.pos, 7), kind: 'defend', hold: 5 + rng() * 5 };
  }
  if (room.mode === 'CP' && p.team) {
    const targets = room.points.filter((pt) => pt.owner !== p.team);
    const list = targets.length ? targets : room.points;
    let best = null, bs = Infinity;
    for (const pt of list) {
      const d = vdistXZ(pos, pt.pos) * (0.6 + rng() * 0.8);
      if (d < bs) { bs = d; best = pt; }
    }
    if (best) return objective({ pos: jitter(best.pos, 3), kind: 'point' });
  }
  // deathmatch: hunt or wander
  if (b.target != null) {
    const o = room.players.get(b.target);
    if (o && o.sim) return { pos: o.sim.pos, kind: 'hunt', hold: 3 };
  }
  const pts = map.drops.concat(map.gold).concat(map.points.map((x) => x.pos));
  const pt = pts[Math.floor(rng() * pts.length)];
  return { pos: jitter(pt, 6), kind: 'wander', hold: 6 + rng() * 6 };
}

/** Follow the nav path toward `dest`; returns the next waypoint to drive to. */
function nextWaypoint(room, p, dest) {
  const b = p.bot, t = room.time, pos = p.sim.pos;
  const nav = getNav(room.map);
  const destMoved = !b.pathDest || Math.hypot(b.pathDest[0] - dest[0], b.pathDest[1] - dest[2]) > 4;
  if (!b.path || destMoved || t - b.pathT > 3 || b.pathFail) {
    const path = nav.findPath([pos[0], pos[2]], [dest[0], dest[2]]);
    b.path = path;
    b.pathT = t;
    b.pathDest = [dest[0], dest[2]];
    b.wp = 0;
    b.pathFail = !path;
  }
  if (!b.path || !b.path.length) return dest;
  while (b.wp < b.path.length - 1 && Math.hypot(b.path[b.wp][0] - pos[0], b.path[b.wp][1] - pos[2]) < 3) b.wp++;
  const w = b.path[b.wp];
  return [w[0], pos[1], w[1]];
}

export function botThink(room, p, dt) {
  const b = p.bot, sim = p.sim, c = p.controls, t = room.time, rng = room.rng;
  const pos = sim.pos;
  const turret = p.turret;

  // -- target
  b.retargetT -= dt;
  if (b.retargetT <= 0 || !validTarget(room, p, b.target)) {
    const prev = b.target;
    b.target = pickTarget(room, p);
    b.retargetT = 0.5 + rng() * 0.5;
    if (b.target !== prev && b.target != null) b.fireT = t + (1 - b.skill) * 0.7 + 0.15;
  }
  const target = b.target != null ? room.players.get(b.target) : null;

  // -- goal
  b.goalT -= dt;
  const reached = b.goal && vdistXZ(pos, b.goal.pos) < 3.5;
  if (!b.goal || b.goalT <= 0 || (reached && b.goal.kind !== 'defend' && b.goal.kind !== 'point')) {
    b.goal = pickGoal(room, p);
    b.goalT = b.goal.hold || 4;
  }
  if (b.goal && ['hunt', 'escort', 'ownflag', 'enemyflag', 'home', 'ball', 'carrier'].includes(b.goal.kind)) {
    const g = pickGoal(room, p);
    if (g.kind === b.goal.kind) b.goal.pos = g.pos; else if (g.kind === 'home' || b.goal.kind === 'hunt' || b.goal.kind === 'ball' || b.goal.kind === 'carrier') { b.goal = g; b.goalT = g.hold || 4; }
  }
  // rugby: the carrier aims at the goal and throws when close enough, otherwise never fires
  const carrying = room.ball && room.ball.carrier === p.id;
  if (carrying) {
    const goalPos = room.map.flags[p.team === 1 ? 'blue' : 'red'];
    const toGoal = vsub(goalPos, pos);
    const dGoal = Math.hypot(toGoal[0], toGoal[2]);
    c.yaw = dirToYaw(toGoal);
    const aligned = Math.abs(angleDiff(sim.yaw + p.turretYaw, c.yaw)) < 0.25;
    c.fire = aligned && dGoal < 20 && dGoal > 6 && room.pw.hasLineOfSight(vadd(pos, [0, 1.2, 0]), vadd(goalPos, [0, 1.5, 0]));
  }

  // -- where to drive
  let dest = b.goal ? b.goal.pos : pos;
  let reverse = false;
  const committed = b.goal && (b.goal.kind === 'home' || b.goal.kind === 'drop' || b.goal.kind === 'enemyflag' || b.goal.kind === 'point');
  if (target && !committed) {
    const d = vdistXZ(pos, target.sim.pos);
    const pref = PREFERRED_RANGE[turret.id] || 25;
    const los = room.pw.hasLineOfSight(eye(p).from, vadd(target.sim.pos, [0, 0.3, 0]));
    if (d > pref + 6 || !los) dest = target.sim.pos;
    else if (d < pref - 6 && pref >= 20) { dest = target.sim.pos; reverse = true; }
    else if (b.goal && b.goal.kind !== 'wander' && b.goal.kind !== 'hunt') dest = b.goal.pos;
    else {
      const side = (p.id % 2 === 0 ? 1 : -1);
      const dir = vnorm(vsub(target.sim.pos, pos));
      dest = vadd(pos, vscale([dir[2] * side, 0, -dir[0] * side], 8));
    }
  } else if (target && committed && b.goal.kind === 'enemyflag' && vdistXZ(pos, target.sim.pos) < 14) {
    // enemy right next to us while going for the flag: fight through it
  }
  const moveTo = reverse ? dest : nextWaypoint(room, p, dest);

  // -- steering
  const hullYaw = sim.yaw;
  const toGoal = vsub(moveTo, pos);
  const distGoal = Math.hypot(toGoal[0], toGoal[2]);
  const wantYaw = dirToYaw(toGoal);
  const diff = angleDiff(hullYaw, wantYaw);
  let f = 0, turn = 0;
  if (distGoal > 1.2) {
    if (reverse) { f = -0.8; turn = clamp(diff * 2.0, -1, 1); }
    else if (Math.abs(diff) < 1.0) { f = 1; turn = clamp(diff * 2.5, -1, 1); }
    else if (Math.abs(diff) > 2.5) { f = -0.4; turn = clamp(diff * 2.5, -1, 1); }
    else { f = 0.25; turn = clamp(diff * 3, -1, 1); }
  }

  // -- local obstacle avoidance (tanks, odd corners); the path handles the big stuff
  if (f > 0) {
    const dF = whisker(room, p, 0, 5), dL = whisker(room, p, -0.45, 4), dR = whisker(room, p, 0.45, 4);
    if (dF < 5) {
      const k = 1 - dF / 5;
      turn += (dR >= dL ? 1 : -1) * k * 1.2;
      if (dF < 2.2) f = 0.25;
    } else if (dL < 2 || dR < 2) turn += (dL < dR ? 1 : -1) * 0.5;
  }

  // -- stuck handling
  if (b.reverseT > 0) {
    b.reverseT -= dt;
    f = -1; turn = b.reverseTurn;
    if (b.reverseT <= 0) b.pathFail = true; // force a fresh path afterwards
  } else {
    if (Math.abs(f) > 0.2 && Math.abs(sim.speed) < 0.5) b.stuckT += dt; else b.stuckT = 0;
    if (b.stuckT > 1.2) { b.stuckT = 0; b.reverseT = 0.8 + rng() * 0.8; b.reverseTurn = rng() < 0.5 ? -1 : 1; }
  }
  if (sim.up[1] < 0.3) { f = 0; turn = 0; }

  c.f = clamp(f, -1, 1);
  c.t = clamp(turn, -1, 1);

  // -- aiming
  let fire = false;
  if (target && !carrying) {
    const tp = vadd(target.sim.pos, [0, 0.3, 0]);
    const d = vlen(vsub(tp, pos));
    let aimAt = tp;
    if (turret.kind === 'projectile' && turret.speed) {
      const tv = target.sim.velocity;
      aimAt = vadd(tp, vscale(tv, (d / turret.speed) * 0.9));
    }
    b.aimErrT -= dt;
    if (b.aimErrT <= 0) {
      b.aimErrT = 0.35 + rng() * 0.3;
      const spread = (1 - b.skill) * 0.16 + 0.015;
      b.aimErr = [(rng() - 0.5) * 2 * spread, 0];
    }
    const aimYaw = dirToYaw(vsub(aimAt, pos)) + b.aimErr[0];
    c.yaw = aimYaw;
    const curYaw = hullYaw + p.turretYaw;
    const err = Math.abs(angleDiff(curYaw, aimYaw));
    const tol = Math.atan2(1.6, Math.max(d, 1)) + 0.03;
    const los = room.pw.hasLineOfSight(eye(p).from, tp);
    const inRange = d < turret.range * 0.95 + 1;
    if (t >= b.fireT && los && inRange && err < tol) {
      fire = true;
      if (turret.id === 'shaft') {
        const tv = vlen(target.sim.velocity);
        if (d > 35 && tv < 4) fire = p.w.charge < 1.6;
        else fire = p.w.charge < 0.1;
        if (p.w.charging && p.w.charge >= 1.6) fire = false;
      } else if (turret.id === 'hammer' || turret.id === 'railgun') {
        fire = !c.fire;
      }
    }
  } else if (!carrying) {
    c.yaw = hullYaw;
  }
  if (!carrying) c.fire = fire;

  // -- supplies
  b.supplyT -= dt;
  if (b.supplyT <= 0 && room.opts.supplies) {
    b.supplyT = 1;
    const hpFrac = p.hp / p.maxHp;
    if (hpFrac < 0.45 && p.supplies.repair > 0) room.useSupply(p, 'repair');
    else if (target && hpFrac < 0.7 && p.supplies.da > 0 && p.fx.da < t) room.useSupply(p, 'da');
    else if (target && p.supplies.dd > 0 && p.fx.dd < t && rng() < 0.5) room.useSupply(p, 'dd');
    else if (!target && distGoal > 45 && p.supplies.nitro > 0 && p.fx.nitro < t) room.useSupply(p, 'nitro');
    else if (p.supplies.mine > 0 && b.goal && (b.goal.kind === 'defend' || b.goal.kind === 'point' || b.goal.kind === 'home') && rng() < 0.15) room.useSupply(p, 'mine');
  }
  b.lastPos = pos;
}
