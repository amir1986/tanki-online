// Drones: one equipable support device with a passive ability.
export const DRONES = [
  { id: 'crisis',    name: 'Crisis',    price: 3000, rank: 3,  color: 0xff6f60, desc: 'Automatically repairs 25% armour when you drop below 30%. Cooldown 45 s.', cooldown: 45, heal: 0.25, threshold: 0.3 },
  { id: 'hyperion',  name: 'Hyperion',  price: 4500, rank: 5,  color: 0xffb74d, desc: 'Every kill charges the turret: +20% damage for 8 seconds.', bonus: 0.2, duration: 8 },
  { id: 'bastion',   name: 'Bastion',   price: 4000, rank: 4,  color: 0x64b5f6, desc: 'Spawn protection lasts 3 s longer and damage taken below 20% armour is reduced by 25%.', extraProtection: 3, lowHpThreshold: 0.2, lowHpReduction: 0.25 },
  { id: 'booster',   name: 'Booster',   price: 3500, rank: 4,  color: 0x7dff7d, desc: 'Permanent +8% speed and acceleration.', speed: 0.08 },
  { id: 'harvester', name: 'Harvester', price: 6000, rank: 7,  color: 0x9fe7ff, desc: '+15% crystals from every battle fund.', crystals: 0.15 },
  { id: 'reaper',    name: 'Reaper',    price: 7500, rank: 9,  color: 0xce93d8, desc: '10% faster reload and your self-destruct detonates like a mine.', reload: 0.1, selfDestructBlast: true },
];
const map = new Map(DRONES.map((d) => [d.id, d]));
export const getDrone = (id) => (id ? map.get(id) || null : null);
