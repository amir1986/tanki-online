// Containers: loot boxes earned from experience, missions and first wins. Opened on the server.
import { PAINTS, SUPPLIES } from './items.mjs';
import { AUGMENTS } from './augments.mjs';
import { DRONES } from './drones.mjs';

/**
 * Open one container. Mutates the profile and returns a reward description.
 * @param {object} profile
 * @param {() => number} rng
 */
export function openContainer(profile, rng = Math.random) {
  if ((profile.containers | 0) <= 0) return null;
  profile.containers--;
  profile.containersOpened = (profile.containersOpened | 0) + 1;
  const roll = rng();
  const owned = (list, has) => list.filter((it) => !has(it));
  if (roll < 0.1) {
    const paints = owned(PAINTS.filter((p) => p.price > 0), (p) => profile.paints.includes(p.id));
    if (paints.length) { const p = paints[Math.floor(rng() * paints.length)]; profile.paints.push(p.id); return { kind: 'paint', id: p.id, name: p.name, text: `Paint: ${p.name}` }; }
  } else if (roll < 0.2) {
    const augs = owned(AUGMENTS.filter((a) => profile.turrets[a.turret] != null), (a) => profile.augmentsOwned.includes(a.id));
    if (augs.length) { const a = augs[Math.floor(rng() * augs.length)]; profile.augmentsOwned.push(a.id); return { kind: 'augment', id: a.id, name: a.name, text: `Augment: ${a.name}` }; }
  } else if (roll < 0.25) {
    const drones = owned(DRONES, (d) => profile.drones[d.id]);
    if (drones.length) { const d = drones[Math.floor(rng() * drones.length)]; profile.drones[d.id] = true; return { kind: 'drone', id: d.id, name: d.name, text: `Drone: ${d.name}` }; }
  } else if (roll < 0.45) {
    const a = SUPPLIES[Math.floor(rng() * SUPPLIES.length)], b = SUPPLIES[Math.floor(rng() * SUPPLIES.length)];
    const na = 3 + Math.floor(rng() * 4), nb = 2 + Math.floor(rng() * 3);
    profile.supplies[a.id] = (profile.supplies[a.id] | 0) + na;
    profile.supplies[b.id] = (profile.supplies[b.id] | 0) + nb;
    return { kind: 'supplies', text: `${na} x ${a.name} and ${nb} x ${b.name}`, items: [[a.id, na], [b.id, nb]] };
  }
  // crystals, weighted toward smaller amounts, with a rare jackpot
  const r = rng();
  const amount = r < 0.03 ? 3000 : Math.round((200 + Math.pow(rng(), 2) * 1000) / 10) * 10;
  profile.crystals += amount;
  return { kind: 'crystals', amount, text: `${amount} crystals` };
}
