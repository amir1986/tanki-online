// Garage transactions on a profile: buy / upgrade / equip / supplies.
import { getHull, getTurret, getPaint, getSupply, upgradePrice, upgradeRank, rankForXp, MAX_MOD, HULLS, TURRETS, PAINTS } from '../shared/items.mjs';
import { TUTORIAL_REWARD } from '../shared/constants.mjs';
import { getDrone } from '../shared/drones.mjs';
import { getAugment } from '../shared/augments.mjs';
import { openContainer } from '../shared/containers.mjs';

const KINDS = { hull: { get: getHull, key: 'hulls' }, turret: { get: getTurret, key: 'turrets' } };

export function garageOp(profile, op, kind, id, n = 1) {
  const rank = rankForXp(profile.xp).index;
  switch (op) {
    case 'buy': {
      if (kind === 'paint') {
        const item = getPaint(id);
        if (item.id !== id) return { ok: false, msg: 'Unknown paint' };
        if (profile.paints.includes(id)) return { ok: false, msg: 'Already owned' };
        if (rank < item.rank) return { ok: false, msg: 'Rank too low' };
        if (profile.crystals < item.price) return { ok: false, msg: 'Not enough crystals' };
        profile.crystals -= item.price;
        profile.paints.push(id);
        profile.equipped.paint = id;
        return { ok: true, msg: `${item.name} purchased` };
      }
      const k = KINDS[kind];
      if (!k) return { ok: false, msg: 'Bad item kind' };
      const item = k.get(id);
      if (item.id !== id) return { ok: false, msg: 'Unknown item' };
      const owned = profile[k.key];
      if (owned[id] != null) return { ok: false, msg: 'Already owned' };
      if (rank < item.rank) return { ok: false, msg: 'Rank too low' };
      if (profile.crystals < item.price) return { ok: false, msg: 'Not enough crystals' };
      profile.crystals -= item.price;
      owned[id] = 0;
      profile.equipped[kind] = id;
      return { ok: true, msg: `${item.name} purchased` };
    }
    case 'upgrade': {
      const k = KINDS[kind];
      if (!k) return { ok: false, msg: 'Bad item kind' };
      const item = k.get(id);
      const owned = profile[k.key];
      if (owned[id] == null) return { ok: false, msg: 'Not owned' };
      const m = (owned[id] | 0) + 1;
      if (m > MAX_MOD) return { ok: false, msg: 'Already at max modification' };
      if (rank < upgradeRank(item, m)) return { ok: false, msg: 'Rank too low' };
      const price = upgradePrice(item, m);
      if (profile.crystals < price) return { ok: false, msg: 'Not enough crystals' };
      profile.crystals -= price;
      owned[id] = m;
      return { ok: true, msg: `${item.name} upgraded to M${m}` };
    }
    case 'equip': {
      if (kind === 'paint') {
        if (!profile.paints.includes(id)) return { ok: false, msg: 'Not owned' };
        profile.equipped.paint = id;
        return { ok: true, msg: 'Paint equipped' };
      }
      const k = KINDS[kind];
      if (!k) return { ok: false, msg: 'Bad item kind' };
      if (profile[k.key][id] == null) return { ok: false, msg: 'Not owned' };
      profile.equipped[kind] = id;
      return { ok: true, msg: 'Equipped' };
    }
    case 'buySupply': {
      const s = getSupply(id);
      if (!s) return { ok: false, msg: 'Unknown supply' };
      n = Math.max(1, Math.min(100, n | 0));
      const cost = s.price * n;
      if (profile.crystals < cost) return { ok: false, msg: 'Not enough crystals' };
      profile.crystals -= cost;
      profile.supplies[id] = (profile.supplies[id] | 0) + n;
      return { ok: true, msg: `${n} x ${s.name} purchased` };
    }
    case 'buyDrone': {
      const d = getDrone(id);
      if (!d) return { ok: false, msg: 'Unknown drone' };
      if (profile.drones[id]) return { ok: false, msg: 'Already owned' };
      if (rank < d.rank) return { ok: false, msg: 'Rank too low' };
      if (profile.crystals < d.price) return { ok: false, msg: 'Not enough crystals' };
      profile.crystals -= d.price;
      profile.drones[id] = true;
      profile.equipped.drone = id;
      return { ok: true, msg: `${d.name} drone purchased` };
    }
    case 'equipDrone': {
      if (id && !profile.drones[id]) return { ok: false, msg: 'Not owned' };
      profile.equipped.drone = id || null;
      return { ok: true, msg: id ? 'Drone equipped' : 'Drone removed' };
    }
    case 'buyAugment': {
      const a = getAugment(id);
      if (!a) return { ok: false, msg: 'Unknown augment' };
      if (profile.augmentsOwned.includes(id)) return { ok: false, msg: 'Already owned' };
      if (profile.turrets[a.turret] == null) return { ok: false, msg: 'You need to own the turret first' };
      if (rank < a.rank) return { ok: false, msg: 'Rank too low' };
      if (profile.crystals < a.price) return { ok: false, msg: 'Not enough crystals' };
      profile.crystals -= a.price;
      profile.augmentsOwned.push(id);
      profile.augments[a.turret] = id;
      return { ok: true, msg: `${a.name} installed` };
    }
    case 'equipAugment': {
      const a = getAugment(id);
      if (id && (!a || !profile.augmentsOwned.includes(id))) return { ok: false, msg: 'Not owned' };
      const turret = a ? a.turret : kind;
      if (!turret) return { ok: false, msg: 'Bad turret' };
      if (id) profile.augments[turret] = id; else delete profile.augments[turret];
      return { ok: true, msg: id ? 'Augment equipped' : 'Augment removed' };
    }
    case 'openContainer': {
      const reward = openContainer(profile);
      if (!reward) return { ok: false, msg: 'No containers to open' };
      return { ok: true, msg: `Container opened: ${reward.text}`, reward };
    }
    case 'tutorialDone': {
      if (profile.tutorialDone) return { ok: false, msg: 'Training reward already collected' };
      profile.tutorialDone = true;
      profile.crystals += TUTORIAL_REWARD;
      return { ok: true, msg: `Training complete: +${TUTORIAL_REWARD} crystals` };
    }
    case 'unlockAll': {
      for (const h of HULLS) if (profile.hulls[h.id] == null) profile.hulls[h.id] = 3;
      for (const t of TURRETS) if (profile.turrets[t.id] == null) profile.turrets[t.id] = 3;
      for (const p of PAINTS) if (!profile.paints.includes(p.id)) profile.paints.push(p.id);
      return { ok: true, msg: 'Everything unlocked' };
    }
    default:
      return { ok: false, msg: 'Unknown garage operation' };
  }
}

export function equipFromProfile(profile) {
  return {
    hull: profile.equipped.hull, hullMod: profile.hulls[profile.equipped.hull] | 0,
    turret: profile.equipped.turret, turretMod: profile.turrets[profile.equipped.turret] | 0,
    paint: profile.equipped.paint,
    augment: (profile.augments && profile.augments[profile.equipped.turret]) || null,
    drone: profile.equipped.drone || null,
  };
}
