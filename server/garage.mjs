// Garage transactions on a profile: buy / upgrade / equip / supplies.
import { getHull, getTurret, getPaint, getSupply, upgradePrice, upgradeRank, rankForXp, MAX_MOD, HULLS, TURRETS, PAINTS } from '../shared/items.mjs';

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
  };
}
