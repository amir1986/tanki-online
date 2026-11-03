// Garage catalog: hulls, turrets, paints, supplies, ranks

// size = [width, height, length] metres. hp at M0. speed m/s, turn rad/s.
export const HULLS = [
  { id: 'wasp',     name: 'Wasp',     hp: 100, speed: 13.0, accel: 20, turn: 2.7, mass: 900,  size: [1.9, 0.85, 3.0], price: 0,     rank: 0,  desc: 'Fastest hull in the game. Paper thin armor, but nobody can catch you.' },
  { id: 'hornet',   name: 'Hornet',   hp: 130, speed: 12.0, accel: 18, turn: 2.5, mass: 1100, size: [2.0, 0.9, 3.2],  price: 1500,  rank: 3,  desc: 'Fast and agile with a bit more armor than the Wasp.' },
  { id: 'hunter',   name: 'Hunter',   hp: 165, speed: 11.0, accel: 16, turn: 2.3, mass: 1400, size: [2.2, 1.0, 3.4],  price: 2000,  rank: 2,  desc: 'Balanced medium hull. Good all-rounder for any mode.' },
  { id: 'viking',   name: 'Viking',   hp: 205, speed: 9.6,  accel: 14, turn: 2.1, mass: 1800, size: [2.4, 1.05, 3.6], price: 2800,  rank: 5,  desc: 'Heavy medium. Solid armor without losing too much speed.' },
  { id: 'dictator', name: 'Dictator', hp: 245, speed: 8.6,  accel: 12, turn: 1.9, mass: 2200, size: [2.5, 1.3, 3.9],  price: 6000,  rank: 8,  desc: 'Tall heavy hull with a high turret mount. Shoots over cover.' },
  { id: 'titan',    name: 'Titan',    hp: 295, speed: 7.6,  accel: 11, turn: 1.7, mass: 2800, size: [2.7, 1.2, 4.1],  price: 12000, rank: 11, desc: 'Heavy armor, slow but very hard to kill.' },
  { id: 'mammoth',  name: 'Mammoth',  hp: 360, speed: 6.6,  accel: 10, turn: 1.5, mass: 3400, size: [2.9, 1.25, 4.4], price: 20000, rank: 14, desc: 'The heaviest hull. A rolling fortress.' },
];

// Turret behaviour kinds:
//  hitscan    : instant ray (smoky, shaft, hammer pellets, vulcan ticks)
//  projectile : travelling shell (twins, thunder, ricochet, striker)
//  stream     : continuous cone (firebird, freeze)
//  beam       : isida lock-on beam
//  rail       : charge then piercing ray
export const TURRETS = [
  { id: 'smoky',    name: 'Smoky',    kind: 'hitscan',    damage: 32, spread: 5, cooldown: 0.9, range: 75, crit: 0.1, critMult: 1.8, price: 0,     rank: 0,  color: 0xb0b0b0, desc: 'Reliable cannon with a chance of critical hits.' },
  { id: 'firebird', name: 'Firebird', kind: 'stream',     dps: 42, range: 13, cone: 0.42, energy: 100, drain: 28, regen: 22, burnDps: 9, burnTime: 3, price: 1000,  rank: 1,  color: 0xff7a1a, desc: 'Flamethrower. Short range, sets enemies on fire.' },
  { id: 'twins',    name: 'Twins',    kind: 'projectile', damage: 12, cooldown: 0.22, speed: 48, range: 65, gravity: 0, price: 1500,  rank: 2,  color: 0x4fc3f7, desc: 'Two rapid plasma cannons. Spray and pray.' },
  { id: 'isida',    name: 'Isida',    kind: 'beam',       dps: 36, heal: 36, selfHeal: 0.5, range: 16, cone: 0.5, energy: 100, drain: 25, regen: 22, price: 3000,  rank: 4,  color: 0x7ee57e, desc: 'Drains enemies and heals allies with a beam.' },
  { id: 'railgun',  name: 'Railgun',  kind: 'rail',       damage: 95, charge: 1.1, cooldown: 3.2, range: 160, price: 4500,  rank: 5,  color: 0x9fb8ff, desc: 'Charges up then fires a piercing bolt through everything in line.' },
  { id: 'freeze',   name: 'Freeze',   kind: 'stream',     dps: 30, range: 13, cone: 0.42, energy: 100, drain: 25, regen: 22, slow: 0.55, slowTime: 2.5, price: 4000,  rank: 4,  color: 0x9be7ff, desc: 'Cryo spray that slows targets to a crawl.' },
  { id: 'thunder',  name: 'Thunder',  kind: 'projectile', damage: 58, cooldown: 1.9, speed: 62, range: 90, gravity: 6, splash: 7, splashMin: 0.3, price: 5000,  rank: 6,  color: 0xd9a066, desc: 'Howitzer firing explosive shells with splash damage.' },
  { id: 'hammer',   name: 'Hammer',   kind: 'hitscan',    damage: 7, pellets: 8, spread: 7, clip: 3, reload: 2.4, range: 32, cooldown: 0.45, price: 6000,  rank: 7,  color: 0xc0a080, desc: 'Three-shell shotgun. Devastating up close.' },
  { id: 'ricochet', name: 'Ricochet', kind: 'projectile', damage: 24, cooldown: 0.5, speed: 52, range: 110, gravity: 0, bounces: 3, price: 7000,  rank: 8,  color: 0x4dd0e1, desc: 'Plasma balls that bounce off walls. Trick shots welcome.' },
  { id: 'striker',  name: 'Striker',  kind: 'projectile', damage: 46, cooldown: 0.35, clip: 3, reload: 2.2, speed: 38, range: 100, gravity: 0, splash: 4, splashMin: 0.4, homing: 2.2, price: 7500,  rank: 9,  color: 0xff5252, desc: 'Rocket pod. Rockets home in on the locked target.' },
  { id: 'vulcan',   name: 'Vulcan',   kind: 'hitscan',    damage: 5, cooldown: 0.08, spread: 3, range: 70, spinup: 1.0, heat: 100, heatRate: 16, cool: 25, recoil: 1.2, price: 8000,  rank: 9,  color: 0x8d8d8d, desc: 'Minigun. Spins up, then shreds anything in front of it.' },
  { id: 'shaft',    name: 'Shaft',    kind: 'hitscan',    damage: 70, chargedDamage: 190, chargeTime: 2.2, spread: 0.3, cooldown: 2.6, range: 220, price: 9000,  rank: 10, color: 0x6d7f9c, desc: 'Sniper cannon. Hold fire to charge a devastating shot.' },
];

// resist: fraction of damage removed from that turret
export const PAINTS = [
  { id: 'green',      name: 'Green',      price: 0,     rank: 0,  color: 0x5a6a3c, pattern: 'solid',   resist: {} },
  { id: 'holiday',    name: 'Holiday',    price: 300,   rank: 1,  color: 0xb83f3a, pattern: 'stripes', color2: 0xd9d6cf, resist: {} },
  { id: 'sandstone',  name: 'Sandstone',  price: 600,   rank: 2,  color: 0xb7a279, pattern: 'camo',    color2: 0x85704a, resist: { firebird: 0.15 } },
  { id: 'forest',     name: 'Forest',     price: 900,   rank: 3,  color: 0x3f5c34, pattern: 'camo',    color2: 0x24381f, resist: { smoky: 0.15, twins: 0.1 } },
  { id: 'arctic',     name: 'Arctic',     price: 1200,  rank: 3,  color: 0xdfe6ea, pattern: 'camo',    color2: 0x9aacb8, resist: { freeze: 0.3 } },
  { id: 'flame',      name: 'Flame',      price: 1800,  rank: 4,  color: 0xd9641c, pattern: 'flames',  color2: 0x2e1a0a, resist: { firebird: 0.35 } },
  { id: 'storm',      name: 'Storm',      price: 2500,  rank: 5,  color: 0x4a5567, pattern: 'camo',    color2: 0x2a313e, resist: { railgun: 0.2, shaft: 0.15 } },
  { id: 'swamp',      name: 'Swamp',      price: 3200,  rank: 6,  color: 0x55602f, pattern: 'camo',    color2: 0x373f22, resist: { isida: 0.25, thunder: 0.1 } },
  { id: 'urban',      name: 'Urban',      price: 4000,  rank: 7,  color: 0x7f8386, pattern: 'camo',    color2: 0x45484b, resist: { hammer: 0.2, vulcan: 0.15 } },
  { id: 'carbon',     name: 'Carbon',     price: 5500,  rank: 8,  color: 0x24262a, pattern: 'carbon',  color2: 0x383b41, resist: { ricochet: 0.2, striker: 0.15 } },
  { id: 'inferno',    name: 'Inferno',    price: 7000,  rank: 9,  color: 0x9c2a22, pattern: 'flames',  color2: 0x1a0e0d, resist: { firebird: 0.4, thunder: 0.15 } },
  { id: 'rustle',     name: 'Rustle',     price: 9000,  rank: 10, color: 0x6f4a2d, pattern: 'camo',    color2: 0xa57545, resist: { firebird: 0.2, freeze: 0.2, isida: 0.2 } },
  { id: 'gold',       name: 'Gold',       price: 12000, rank: 11, color: 0xd1a93a, pattern: 'solid',   resist: { smoky: 0.1, twins: 0.1, railgun: 0.1, thunder: 0.1 } },
  { id: 'moonwalker', name: 'Moonwalker', price: 16000, rank: 13, color: 0xc3ccd6, pattern: 'carbon',  color2: 0x66789c, resist: { railgun: 0.3, shaft: 0.3, striker: 0.2 } },
];

export const SUPPLIES = [
  { id: 'repair', name: 'Repair Kit',    key: 1, price: 50,  color: 0xff4d4d, desc: 'Restores your armor over 3 seconds.' },
  { id: 'da',     name: 'Double Armor',  key: 2, price: 50,  color: 0x4da6ff, desc: 'Halves incoming damage for 45 seconds.' },
  { id: 'dd',     name: 'Double Damage', key: 3, price: 50,  color: 0xffb84d, desc: 'Doubles your damage for 45 seconds.' },
  { id: 'nitro',  name: 'Nitro',         key: 4, price: 50,  color: 0x7dff7d, desc: 'Speed boost for 45 seconds.' },
  { id: 'mine',   name: 'Mine',          key: 5, price: 100, color: 0xe0e0e0, desc: 'Plant a mine that explodes under enemy tanks.' },
];

export const RANKS = [
  ['Recruit', 0], ['Private', 100], ['Gefreiter', 500], ['Corporal', 1500], ['Master Corporal', 3700],
  ['Sergeant', 7100], ['Staff Sergeant', 12300], ['Master Sergeant', 20000], ['First Sergeant', 29000],
  ['Sergeant-Major', 41000], ['Warrant Officer 1', 57000], ['Warrant Officer 2', 76000], ['Warrant Officer 3', 98000],
  ['Warrant Officer 4', 125000], ['Warrant Officer 5', 156000], ['Third Lieutenant', 192000], ['Second Lieutenant', 233000],
  ['First Lieutenant', 280000], ['Captain', 332000], ['Major', 390000], ['Lieutenant Colonel', 455000], ['Colonel', 527000],
  ['Brigadier', 606000], ['Major General', 692000], ['Lieutenant General', 787000], ['General', 889000], ['Marshal', 1000000],
  ['Field Marshal', 1122000], ['Commander', 1255000], ['Generalissimo', 1400000],
].map(([name, xp], i) => ({ index: i, name, xp }));

export const MAX_MOD = 3;

const hullMap = new Map(HULLS.map((h) => [h.id, h]));
const turretMap = new Map(TURRETS.map((t) => [t.id, t]));
const paintMap = new Map(PAINTS.map((p) => [p.id, p]));
const supplyMap = new Map(SUPPLIES.map((s) => [s.id, s]));

export const getHull = (id) => hullMap.get(id) || HULLS[0];
export const getTurret = (id) => turretMap.get(id) || TURRETS[0];
export const getPaint = (id) => paintMap.get(id) || PAINTS[0];
export const getSupply = (id) => supplyMap.get(id);

// Modification multipliers (M0..M3)
export const modMult = (m, per = 0.12) => 1 + per * Math.max(0, Math.min(MAX_MOD, m | 0));

export function hullStats(id, m = 0) {
  const h = getHull(id);
  return {
    hp: Math.round(h.hp * modMult(m, 0.12)),
    speed: +(h.speed * modMult(m, 0.05)).toFixed(2),
    accel: +(h.accel * modMult(m, 0.06)).toFixed(2),
    turn: +(h.turn * modMult(m, 0.05)).toFixed(3),
    mass: h.mass,
    size: h.size,
  };
}

export function turretStats(id, m = 0) {
  const t = getTurret(id);
  const s = { ...t };
  const dm = modMult(m, 0.12);
  if (s.damage != null) s.damage = +(s.damage * dm).toFixed(1);
  if (s.chargedDamage != null) s.chargedDamage = +(s.chargedDamage * dm).toFixed(1);
  if (s.dps != null) s.dps = +(s.dps * dm).toFixed(1);
  if (s.heal != null) s.heal = +(s.heal * dm).toFixed(1);
  if (s.burnDps != null) s.burnDps = +(s.burnDps * dm).toFixed(1);
  if (s.cooldown != null) s.cooldown = +(s.cooldown / modMult(m, 0.05)).toFixed(3);
  if (s.reload != null) s.reload = +(s.reload / modMult(m, 0.06)).toFixed(3);
  if (s.charge != null) s.charge = +(s.charge / modMult(m, 0.06)).toFixed(3);
  if (s.range != null) s.range = +(s.range * modMult(m, 0.04)).toFixed(1);
  return s;
}

// Price to upgrade from m-1 to m
export function upgradePrice(item, m) {
  const base = item.price > 0 ? item.price : 800;
  const table = [0, 0.6, 1.3, 2.4];
  return Math.round(base * (table[m] || 0) / 10) * 10;
}

export function upgradeRank(item, m) {
  return item.rank + [0, 2, 5, 8][m];
}

export function rankForXp(xp) {
  let r = RANKS[0];
  for (const rank of RANKS) if (xp >= rank.xp) r = rank; else break;
  return r;
}

export function rankProgress(xp) {
  const r = rankForXp(xp);
  const next = RANKS[r.index + 1];
  if (!next) return { rank: r, next: null, frac: 1, toNext: 0 };
  const frac = (xp - r.xp) / (next.xp - r.xp);
  return { rank: r, next, frac: Math.max(0, Math.min(1, frac)), toNext: next.xp - xp };
}

export function rankUpBonus(rankIndex) {
  return 100 * rankIndex + 100;
}

export const DEFAULT_PROFILE = () => ({
  name: 'Tanker',
  xp: 0,
  crystals: 2000,
  hulls: { wasp: 0 },        // id -> modification level
  turrets: { smoky: 0 },
  paints: ['green'],
  equipped: { hull: 'wasp', turret: 'smoky', paint: 'green' },
  supplies: { repair: 5, da: 3, dd: 3, nitro: 3, mine: 3 },
  stats: { kills: 0, deaths: 0, battles: 0, flags: 0, gold: 0, score: 0, wins: 0 },
  settings: {},
  created: Date.now(),
});
