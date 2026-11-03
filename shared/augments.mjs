// Turret augments: one per turret can be equipped and changes the weapon's behaviour.
export const AUGMENTS = [
  { id: 'smoky_explosive',  turret: 'smoky',    name: 'Explosive Shells',  price: 2500, rank: 4,  desc: 'Shells burst on impact with a 2.5 m splash.', apply: (s) => ({ ...s, splash: 2.5, splashMin: 0.5 }) },
  { id: 'smoky_gunslinger', turret: 'smoky',    name: 'Gunslinger',        price: 2000, rank: 3,  desc: '15% faster reload.', apply: (s) => ({ ...s, cooldown: +(s.cooldown * 0.85).toFixed(3) }) },
  { id: 'firebird_backdraft', turret: 'firebird', name: 'Backdraft',       price: 2500, rank: 4,  desc: 'Targets burn twice as long and 20% hotter.', apply: (s) => ({ ...s, burnTime: s.burnTime * 2, burnDps: +(s.burnDps * 1.2).toFixed(1) }) },
  { id: 'twins_overclock',  turret: 'twins',    name: 'Overclock',         price: 2500, rank: 4,  desc: '+25% projectile speed and +10% damage.', apply: (s) => ({ ...s, speed: s.speed * 1.25, damage: +(s.damage * 1.1).toFixed(1) }) },
  { id: 'isida_vampire',    turret: 'isida',    name: 'Vampire',           price: 3500, rank: 6,  desc: 'Heals you for 100% of the damage you drain.', apply: (s) => ({ ...s, selfHeal: 1.0 }) },
  { id: 'railgun_fastcharge', turret: 'railgun', name: 'Fast Charge',      price: 4500, rank: 7,  desc: 'Charges 30% faster.', apply: (s) => ({ ...s, charge: +(s.charge * 0.7).toFixed(3) }) },
  { id: 'freeze_deep',      turret: 'freeze',   name: 'Deep Freeze',       price: 3500, rank: 6,  desc: 'Slows targets to 25% speed for longer.', apply: (s) => ({ ...s, slow: 0.75, slowTime: s.slowTime * 1.3 }) },
  { id: 'thunder_heavy',    turret: 'thunder',  name: 'Heavy Shells',      price: 4500, rank: 8,  desc: '+30% splash radius and +5% damage.', apply: (s) => ({ ...s, splash: +(s.splash * 1.3).toFixed(1), damage: +(s.damage * 1.05).toFixed(1) }) },
  { id: 'hammer_mag',       turret: 'hammer',   name: 'Extended Magazine', price: 4000, rank: 8,  desc: 'Four shells per clip.', apply: (s) => ({ ...s, clip: s.clip + 1 }) },
  { id: 'ricochet_bouncer', turret: 'ricochet', name: 'Bouncer',           price: 5000, rank: 9,  desc: 'Two extra bounces and +10% damage.', apply: (s) => ({ ...s, bounces: s.bounces + 2, damage: +(s.damage * 1.1).toFixed(1) }) },
  { id: 'striker_salvo',    turret: 'striker',  name: 'Salvo',             price: 5500, rank: 10, desc: 'Four rockets per salvo and 20% faster reload.', apply: (s) => ({ ...s, clip: s.clip + 1, reload: +(s.reload * 0.8).toFixed(3) }) },
  { id: 'vulcan_cooling',   turret: 'vulcan',   name: 'Cooling System',    price: 5500, rank: 10, desc: 'Heats up 30% slower and spins up 20% faster.', apply: (s) => ({ ...s, heatRate: s.heatRate * 0.7, spinup: s.spinup * 0.8 }) },
  { id: 'shaft_steady',     turret: 'shaft',    name: 'Steady Hands',      price: 6500, rank: 11, desc: 'Charges 30% faster, charged shots hit 10% harder.', apply: (s) => ({ ...s, chargeTime: +(s.chargeTime * 0.7).toFixed(3), chargedDamage: +(s.chargedDamage * 1.1).toFixed(1) }) },
];
const map = new Map(AUGMENTS.map((a) => [a.id, a]));
export const getAugment = (id) => (id ? map.get(id) || null : null);
export const augmentsFor = (turretId) => AUGMENTS.filter((a) => a.turret === turretId);

/** Apply an augment to turret stats (returns a new stats object). */
export function applyAugment(stats, augmentId) {
  const a = getAugment(augmentId);
  if (!a || a.turret !== stats.id) return stats;
  return { ...a.apply(stats), augment: a.id };
}
