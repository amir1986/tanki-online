// Wire protocol (JSON over WebSocket). Shared between server and client.
// Client -> server message types
export const C2S = {
  HELLO: 'hello',        // { name }
  LOBBY: 'lobby',        // request battle list
  CREATE: 'create',      // { opts }
  JOIN: 'join',          // { id, team }
  LEAVE: 'leave',
  INPUT: 'input',        // { f (throttle), r (turn), tt (turret turn), fire, yaw, seq }
  SUPPLY: 'supply',      // { id }
  CHAT: 'chat',          // { msg, team }
  GARAGE: 'garage',      // { op: 'buy'|'equip'|'upgrade'|'buySupply', kind, id, n }
  SELF_DESTRUCT: 'sd',
  TEAM: 'team',          // { team } switch team
  PROFILE: 'profile',
  SETTINGS: 'settings',  // { settings } persisted on profile
  PING: 'ping',          // { t }
  LEADERBOARD: 'leaderboard',
  QUEUE: 'queue',        // { mode: 'any'|modeId } matchmaking
  CLAN: 'clan',          // { op: 'create'|'join'|'leave'|'kick'|'list'|'info', tag, name, member }
};

// Server -> client message types
export const S2C = {
  WELCOME: 'welcome',    // { profile, serverTime }
  PROFILE: 'profile',    // { profile }
  LOBBY: 'lobby',        // { battles }
  JOINED: 'joined',      // { battle, you }
  LEFT: 'left',
  PLAYERS: 'players',    // { players: [...] }  roster incl. equipment
  SNAP: 'snap',          // snapshot
  EVENTS: 'ev',          // { events: [...] }
  END: 'end',            // battle results
  RESTART: 'restart',    // battle restarted (new round)
  ERROR: 'error',        // { msg }
  PONG: 'pong',          // { t, st }
  GARAGE_OK: 'garage_ok',
  LEADERBOARD: 'leaderboard', // { top: [...] }
  CLAN: 'clan',          // { ok, msg, clan, list }
  CONTAINER: 'container', // { reward }
};

// Rugby ball snapshot layout
export const BS = { X: 0, Y: 1, Z: 2, CARRIER: 3, LENGTH: 4 };

// Tank snapshot array layout
export const TS = {
  ID: 0, X: 1, Y: 2, Z: 3, QX: 4, QY: 5, QZ: 6, QW: 7,
  TYAW: 8, HP: 9, FLAGS: 10, CHARGE: 11, ENERGY: 12, TARGET: 13, SPEED: 14,
  LENGTH: 15,
};

// Projectile snapshot layout
export const PS = { ID: 0, KIND: 1, X: 2, Y: 3, Z: 4, VX: 5, VY: 6, VZ: 7, OWNER: 8, TEAM: 9, LENGTH: 10 };
// Drop snapshot layout
export const DS = { ID: 0, TYPE: 1, X: 2, Y: 3, Z: 4, STATE: 5, LENGTH: 6 };
// Mine snapshot layout
export const MS = { ID: 0, X: 1, Y: 2, Z: 3, TEAM: 4, OWNER: 5, ARMED: 6, LENGTH: 7 };

export const DROP_TYPES = ['repair', 'da', 'dd', 'nitro', 'gold'];

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function packTank(t) {
  const a = new Array(TS.LENGTH);
  a[TS.ID] = t.id;
  a[TS.X] = r2(t.pos[0]); a[TS.Y] = r2(t.pos[1]); a[TS.Z] = r2(t.pos[2]);
  a[TS.QX] = r3(t.quat[0]); a[TS.QY] = r3(t.quat[1]); a[TS.QZ] = r3(t.quat[2]); a[TS.QW] = r3(t.quat[3]);
  a[TS.TYAW] = r3(t.turretYaw);
  a[TS.HP] = Math.round(t.hp);
  a[TS.FLAGS] = t.flags | 0;
  a[TS.CHARGE] = Math.round((t.charge || 0) * 100);
  a[TS.ENERGY] = Math.round(t.energy == null ? 100 : t.energy);
  a[TS.TARGET] = t.target == null ? -1 : t.target;
  a[TS.SPEED] = r2(t.speed || 0);
  return a;
}

export function unpackTank(a) {
  return {
    id: a[TS.ID],
    pos: [a[TS.X], a[TS.Y], a[TS.Z]],
    quat: [a[TS.QX], a[TS.QY], a[TS.QZ], a[TS.QW]],
    turretYaw: a[TS.TYAW],
    hp: a[TS.HP],
    flags: a[TS.FLAGS],
    charge: a[TS.CHARGE] / 100,
    energy: a[TS.ENERGY],
    target: a[TS.TARGET] < 0 ? null : a[TS.TARGET],
    speed: a[TS.SPEED],
  };
}

export function packProjectile(p) {
  return [p.id, p.kind, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r2(p.vel[0]), r2(p.vel[1]), r2(p.vel[2]), p.owner, p.team];
}

export function packDrop(d) {
  return [d.id, DROP_TYPES.indexOf(d.type), r2(d.pos[0]), r2(d.pos[1]), r2(d.pos[2]), d.landed ? 1 : 0];
}

export function packMine(m) {
  return [m.id, r2(m.pos[0]), r2(m.pos[1]), r2(m.pos[2]), m.team, m.owner, m.armed ? 1 : 0];
}
