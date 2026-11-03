// Daily missions: three deterministic missions per player per day, rewarded in crystals on completion.
import { hash2, mulberry32 } from './noise.mjs';

export const MISSION_TYPES = {
  kills:      { text: 'Destroy {n} tanks', min: 8, max: 25, reward: [12, 16] },
  score:      { text: 'Earn {n} battle score', min: 200, max: 700, reward: [0.6, 0.8] },
  battles:    { text: 'Finish {n} battles', min: 2, max: 4, reward: [60, 90] },
  flags:      { text: 'Capture {n} flags', min: 2, max: 5, reward: [90, 120], modes: ['CTF'] },
  points:     { text: 'Capture {n} control points', min: 3, max: 7, reward: [50, 70], modes: ['CP'] },
  assists:    { text: 'Get {n} assists', min: 4, max: 12, reward: [20, 30] },
  gold:       { text: 'Take {n} gold box', min: 1, max: 1, reward: [500, 500] },
  wins:       { text: 'Win {n} battles', min: 1, max: 3, reward: [180, 220] },
  damage:     { text: 'Deal {n} damage', min: 1500, max: 6000, reward: [0.07, 0.09] },
  juggernaut: { text: 'Destroy the Juggernaut {n} times', min: 2, max: 5, reward: [90, 120], modes: ['JGR'] },
};
const TYPE_IDS = Object.keys(MISSION_TYPES);

export function dayKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function nameSeed(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic set of 3 missions for a nickname and day. */
export function generateMissions(name, day = dayKey()) {
  const seed = nameSeed(name.toLowerCase() + '|' + day);
  const rng = mulberry32(seed);
  const pool = [...TYPE_IDS];
  const list = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    // gold box missions are rare
    let idx = Math.floor(rng() * pool.length);
    if (pool[idx] === 'gold' && rng() < 0.7) idx = (idx + 1) % pool.length;
    const type = pool.splice(idx, 1)[0];
    const def = MISSION_TYPES[type];
    const target = def.min + Math.floor(rng() * (def.max - def.min + 1));
    const per = def.reward[0] + rng() * (def.reward[1] - def.reward[0]);
    const reward = Math.max(50, Math.round((per * target) / 10) * 10);
    list.push({ id: `${day}-${i}`, type, target, progress: 0, reward, claimed: false, text: def.text.replace('{n}', target), modes: def.modes || null });
  }
  return list;
}

/** Make sure the profile has today's missions; returns the mission block. */
export function ensureMissions(profile, now = new Date()) {
  const day = dayKey(now);
  if (!profile.missions || profile.missions.day !== day || !Array.isArray(profile.missions.list)) {
    profile.missions = { day, list: generateMissions(profile.name, day), completedTotal: profile.missions?.completedTotal || 0 };
  }
  return profile.missions;
}

/**
 * Add progress of a given type. Returns missions that just completed (reward already added to the profile).
 */
export function addMissionProgress(profile, type, amount, mode = null, now = new Date()) {
  if (!profile || amount <= 0) return [];
  const block = ensureMissions(profile, now);
  const done = [];
  for (const m of block.list) {
    if (m.type !== type || m.claimed) continue;
    if (m.modes && mode && !m.modes.includes(mode)) continue;
    if (m.modes && !mode) continue;
    m.progress = Math.min(m.target, m.progress + amount);
    if (m.progress >= m.target) {
      m.claimed = true;
      profile.crystals += m.reward;
      block.completedTotal = (block.completedTotal || 0) + 1;
      done.push(m);
    }
  }
  return done;
}

/** Progress summary for UI. */
export function missionSummary(profile, now = new Date()) {
  const block = ensureMissions(profile, now);
  return { day: block.day, list: block.list.map((m) => ({ ...m })), completedTotal: block.completedTotal || 0 };
}
