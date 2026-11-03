// Player profile persistence (JSON files, one per nickname).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROFILE, getHull, getTurret, getPaint } from '../shared/items.mjs';

export function sanitizeName(name) {
  let n = String(name || '').trim().replace(/[^A-Za-z0-9_\-\.]/g, '').slice(0, 16);
  if (n.length < 3) n = '';
  return n;
}

export class ProfileStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.dirty = new Set();
    fs.mkdirSync(dir, { recursive: true });
  }

  fileFor(name) {
    return path.join(this.dir, name.toLowerCase() + '.json');
  }

  normalize(p, name) {
    const d = DEFAULT_PROFILE();
    const out = { ...d, ...p, name };
    out.hulls = { ...d.hulls, ...(p.hulls || {}) };
    out.turrets = { ...d.turrets, ...(p.turrets || {}) };
    out.paints = Array.from(new Set([...(p.paints || []), 'green']));
    out.equipped = { ...d.equipped, ...(p.equipped || {}) };
    out.supplies = { ...d.supplies, ...(p.supplies || {}) };
    out.stats = { ...d.stats, ...(p.stats || {}) };
    out.settings = { ...(p.settings || {}) };
    out.missions = p.missions && Array.isArray(p.missions.list) ? p.missions : null;
    out.tutorialDone = !!p.tutorialDone;
    out.drones = { ...(p.drones || {}) };
    out.augments = { ...(p.augments || {}) };
    out.augmentsOwned = Array.isArray(p.augmentsOwned) ? [...p.augmentsOwned] : [];
    out.containers = Math.max(0, p.containers == null ? 1 : p.containers | 0);
    out.containerXp = Math.max(0, p.containerXp | 0);
    out.containersOpened = Math.max(0, p.containersOpened | 0);
    out.clan = p.clan && p.clan.tag ? { id: p.clan.id, tag: p.clan.tag, name: p.clan.name } : null;
    if (out.equipped.drone && !out.drones[out.equipped.drone]) out.equipped.drone = null;
    for (const [turret, aug] of Object.entries(out.augments)) if (!out.augmentsOwned.includes(aug)) delete out.augments[turret];
    if (!out.hulls[out.equipped.hull] && out.hulls[out.equipped.hull] !== 0) out.equipped.hull = 'wasp';
    if (!out.turrets[out.equipped.turret] && out.turrets[out.equipped.turret] !== 0) out.equipped.turret = 'smoky';
    if (!out.paints.includes(out.equipped.paint)) out.equipped.paint = 'green';
    getHull(out.equipped.hull); getTurret(out.equipped.turret); getPaint(out.equipped.paint);
    out.xp = Math.max(0, +out.xp || 0);
    out.crystals = Math.max(0, Math.floor(+out.crystals || 0));
    return out;
  }

  load(rawName) {
    const name = sanitizeName(rawName);
    if (!name) return null;
    const key = name.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    let data = null;
    try {
      const txt = fs.readFileSync(this.fileFor(name), 'utf8');
      data = JSON.parse(txt);
    } catch (e) { data = null; }
    const profile = this.normalize(data || DEFAULT_PROFILE(), data && data.name ? data.name : name);
    this.cache.set(key, profile);
    if (!data) this.save(profile);
    return profile;
  }

  markDirty(profile) {
    this.dirty.add(profile.name.toLowerCase());
  }

  save(profile) {
    try {
      const tmp = this.fileFor(profile.name) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
      fs.renameSync(tmp, this.fileFor(profile.name));
    } catch (e) {
      console.error('profile save failed', e.message);
    }
    this.dirty.delete(profile.name.toLowerCase());
  }

  flush() {
    for (const key of [...this.dirty]) {
      const p = this.cache.get(key);
      if (p) this.save(p);
      this.dirty.delete(key);
    }
  }

  list() {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => {
        try { const p = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); return { name: p.name, xp: p.xp, crystals: p.crystals, stats: p.stats || {} }; }
        catch (e) { return null; }
      }).filter(Boolean);
    } catch (e) { return []; }
  }
}
