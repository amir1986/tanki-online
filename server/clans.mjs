// Clan registry persisted to a JSON file.
import fs from 'node:fs';
import path from 'node:path';
import { CLAN_MAX_MEMBERS } from '../shared/constants.mjs';

export class ClanStore {
  constructor(dir) {
    this.file = path.join(dir, 'clans.json');
    this.clans = new Map();
    this.nextId = 1;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const c of data.clans || []) this.clans.set(c.id, c);
      this.nextId = data.nextId || (Math.max(0, ...this.clans.keys()) + 1);
    } catch (e) { /* fresh store */ }
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ nextId: this.nextId, clans: [...this.clans.values()] }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('clan save failed', e.message); }
  }

  static validTag(tag) { return /^[A-Z0-9]{2,5}$/.test(tag); }
  static validName(name) { return typeof name === 'string' && name.trim().length >= 3 && name.trim().length <= 24; }

  byTag(tag) { for (const c of this.clans.values()) if (c.tag === tag) return c; return null; }
  byMember(name) { const n = name.toLowerCase(); for (const c of this.clans.values()) if (c.members.some((m) => m.toLowerCase() === n)) return c; return null; }
  get(id) { return this.clans.get(id) || null; }

  create(leader, tag, name) {
    tag = String(tag || '').toUpperCase().trim();
    name = String(name || '').trim();
    if (!ClanStore.validTag(tag)) return { ok: false, msg: 'Tag must be 2-5 letters or digits' };
    if (!ClanStore.validName(name)) return { ok: false, msg: 'Name must be 3-24 characters' };
    if (this.byTag(tag)) return { ok: false, msg: 'That tag is already taken' };
    if (this.byMember(leader)) return { ok: false, msg: 'You are already in a clan' };
    const clan = { id: this.nextId++, tag, name, leader, members: [leader], created: Date.now() };
    this.clans.set(clan.id, clan);
    this.save();
    return { ok: true, clan, msg: `Clan [${tag}] ${name} founded` };
  }

  join(member, tag) {
    const clan = this.byTag(String(tag || '').toUpperCase().trim());
    if (!clan) return { ok: false, msg: 'Clan not found' };
    if (this.byMember(member)) return { ok: false, msg: 'You are already in a clan' };
    if (clan.members.length >= CLAN_MAX_MEMBERS) return { ok: false, msg: 'Clan is full' };
    clan.members.push(member);
    this.save();
    return { ok: true, clan, msg: `Joined [${clan.tag}] ${clan.name}` };
  }

  leave(member) {
    const clan = this.byMember(member);
    if (!clan) return { ok: false, msg: 'You are not in a clan' };
    clan.members = clan.members.filter((m) => m.toLowerCase() !== member.toLowerCase());
    if (!clan.members.length) this.clans.delete(clan.id);
    else if (clan.leader.toLowerCase() === member.toLowerCase()) clan.leader = clan.members[0];
    this.save();
    return { ok: true, clan: null, msg: `Left [${clan.tag}]` };
  }

  kick(leader, member) {
    const clan = this.byMember(leader);
    if (!clan || clan.leader.toLowerCase() !== leader.toLowerCase()) return { ok: false, msg: 'Only the clan leader can kick' };
    if (member.toLowerCase() === leader.toLowerCase()) return { ok: false, msg: 'Leave the clan instead' };
    const before = clan.members.length;
    clan.members = clan.members.filter((m) => m.toLowerCase() !== member.toLowerCase());
    if (clan.members.length === before) return { ok: false, msg: 'No such member' };
    this.save();
    return { ok: true, clan, msg: `${member} was kicked` };
  }

  /** Public summary for a member's profile. */
  summary(clan) { return clan ? { id: clan.id, tag: clan.tag, name: clan.name, leader: clan.leader, members: clan.members } : null; }

  /** Clan list ranked by total member experience. */
  list(xpOf) {
    return [...this.clans.values()].map((c) => ({ id: c.id, tag: c.tag, name: c.name, leader: c.leader, members: c.members.length, xp: c.members.reduce((s, m) => s + (xpOf(m) || 0), 0) }))
      .sort((a, b) => b.xp - a.xp).slice(0, 50);
  }
}
