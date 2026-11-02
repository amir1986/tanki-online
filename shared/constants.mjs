// Shared game constants (server + client)
export const GAME_VERSION = '0.1.0';
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;

export const TEAM = { NONE: 0, RED: 1, BLUE: 2 };
export const TEAM_NAMES = { 0: 'None', 1: 'Red', 2: 'Blue' };
export const TEAM_COLORS = { 0: 0x9bd33a, 1: 0xe53935, 2: 0x1e88e5 };

export const MODES = {
  DM: { id: 'DM', name: 'Deathmatch', teams: false, desc: 'Every tank for itself. Most kills wins.' },
  TDM: { id: 'TDM', name: 'Team Deathmatch', teams: true, desc: 'Two teams. Most kills wins.' },
  CTF: { id: 'CTF', name: 'Capture The Flag', teams: true, desc: 'Steal the enemy flag and bring it home.' },
  CP: { id: 'CP', name: 'Control Points', teams: true, desc: 'Hold the control points to earn points.' },
};

export const RESPAWN_DELAY = 3.0;        // seconds dead before respawn
export const SPAWN_PROTECTION = 3.0;     // seconds of invulnerability after spawn
export const SELF_DESTRUCT_DELAY = 1.5;  // seconds
export const FLIP_AUTO_SECONDS = 3.0;    // auto flip if upside down this long
export const FLAG_RETURN_SECONDS = 30;
export const CP_RADIUS = 7;
export const CP_CAPTURE_SECONDS = 8;
export const CP_SCORE_INTERVAL = 2;      // seconds per scoring tick
export const SUPPLY_DURATION = 45;       // DA / DD / Nitro
export const SUPPLY_COOLDOWN = 30;
export const MINE_COOLDOWN = 10;
export const MINE_ARM_TIME = 1.0;
export const MINE_TRIGGER_RADIUS = 2.6;
export const MINE_DAMAGE = 110;
export const MINE_SPLASH = 5.5;
export const MAX_MINES_PER_PLAYER = 5;
export const REPAIR_SECONDS = 3;
export const DROP_INTERVAL = 40;         // seconds between supply drops
export const DROP_LIFETIME = 60;
export const GOLD_INTERVAL_MIN = 240;
export const GOLD_INTERVAL_MAX = 420;
export const GOLD_WARNING = 15;
export const GOLD_REWARD = 1000;
export const DROP_FALL_SPEED = 4;        // m/s under parachute

export const SCORE = {
  KILL: 10,
  ASSIST: 5,
  FLAG_CAPTURE: 100,
  FLAG_RETURN: 20,
  FLAG_PICKUP: 10,
  CP_CAPTURE: 30,
  CP_HOLD: 1,
  GOLD: 50,
};

export const FUND_PER_KILL = 15;
export const FUND_BASE = 400;

export const BATTLE_DEFAULTS = {
  timeLimit: 10,      // minutes (0 = unlimited)
  scoreLimit: 30,     // kills (DM/TDM), flags (CTF), points (CP) 0 = unlimited
  maxPlayers: 12,
  bots: 7,
  friendlyFire: false,
  supplies: true,
  drops: true,
};

export const MAP_WALL_HEIGHT = 8;
export const KILL_Y = -40;

// Flags packed into the snapshot per tank
export const TF = {
  DEAD: 1,
  DA: 2,
  DD: 4,
  NITRO: 8,
  REPAIR: 16,
  PROTECTED: 32,
  FIRING: 64,
  FLAG: 128,       // carrying a flag
  FROZEN: 256,
  BURNING: 512,
  CHARGING: 1024,
  BOT: 2048,
  SNIPER: 4096,
};
