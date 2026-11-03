// Map definitions. Everything here is deterministic so server and client build
// identical geometry from the same code.
import { fbm, smoothstep, clamp, gauss, mulberry32 } from './noise.mjs';
import { MAP_WALL_HEIGHT } from './constants.mjs';
import { qYaw, qMul, qFromAxisAngle } from './sim/math.mjs';

const MAPS = {};
const defineMap = (def) => { MAPS[def.id] = def; };

// ---- prop helpers -------------------------------------------------------
const box = (x, z, w, h, l, { yaw = 0, mat = 'concrete', dy = 0, tint = 0, kind = 'box' } = {}) =>
  ({ kind, x, z, w, h, l, yaw, mat, dy, tint });
const crate = (x, z, s = 2, opts = {}) => box(x, z, s, s, s, { mat: 'crate', ...opts });
const container = (x, z, yaw = 0, tint = 0, opts = {}) => box(x, z, 2.6, 2.7, 6.2, { yaw, mat: 'container', tint, ...opts });
const barrier = (x, z, yaw = 0) => box(x, z, 0.9, 1.3, 5, { yaw, mat: 'barrier' });
const bunker = (x, z, yaw = 0, w = 9, h = 3.2, l = 6) => box(x, z, w, h, l, { yaw, mat: 'bunker' });
const building = (x, z, w, h, l, yaw = 0, tint = 0) => box(x, z, w, h, l, { yaw, mat: 'building', tint, kind: 'building' });
const tree = (x, z, s = 1) => ({ kind: 'tree', x, z, w: 0.9 * s, h: 7 * s, l: 0.9 * s, yaw: 0, mat: 'tree', dy: 0, tint: s });
const rock = (x, z, s = 2, yaw = 0) => ({ kind: 'rock', x, z, w: s * 1.4, h: s, l: s * 1.1, yaw, mat: 'rock', dy: -s * 0.2, tint: 0 });
// ramp rises toward local +z over length l to height h
const ramp = (x, z, w, l, h, yaw = 0, mat = 'concrete') => {
  const s = Math.hypot(l, h);
  return { kind: 'ramp', x, z, w, h: 0.5, l: s, yaw, pitch: -Math.atan2(h, l), mat, dy: h / 2 - 0.38, rise: h, tint: 0 };
};
const platform = (x, z, w, h, l, mat = 'concrete', yaw = 0) => box(x, z, w, h, l, { yaw, mat });

const ring = (cx, cz, r, n, faceCenter = true, start = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const yaw = faceCenter ? Math.atan2(cx - x, cz - z) : a;
    out.push({ x, z, yaw });
  }
  return out;
};
const line = (x0, z0, x1, z1, n, yaw) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, yaw });
  }
  return out;
};

function walls(W, L, mat = 'concrete') {
  const hw = W / 2, hl = L / 2, t = 1.2, h = MAP_WALL_HEIGHT;
  return [
    box(0, -hl - t / 2, W + t * 2, h, t, { mat, kind: 'wall' }),
    box(0, hl + t / 2, W + t * 2, h, t, { mat, kind: 'wall' }),
    box(-hw - t / 2, 0, t, h, L, { mat, kind: 'wall' }),
    box(hw + t / 2, 0, t, h, L, { mat, kind: 'wall' }),
  ];
}

// ---- SANDBOX -------------------------------------------------------------
defineMap({
  id: 'sandbox',
  name: 'Sandbox',
  desc: 'The classic. A walled sand arena with a central platform and plenty of crates.',
  size: [100, 100],
  cell: 2,
  theme: {
    ground: 'sand',
    sky: { top: 0x3f7fd0, horizon: 0xcfe3f5, ground: 0xb9a37a },
    fog: { color: 0xd6e2ee, near: 90, far: 260 },
    sun: [60, 70, 40], sunColor: 0xfff1d8, sunIntensity: 3.2,
    hemi: [0xbfd8ff, 0x8a7a55], hemiIntensity: 0.9,
    turbidity: 7, rayleigh: 1.8, mie: 0.006, fogDensity: 0.0028, envIntensity: 0.6,
  },
  height: (x, z) => 0.35 * fbm(x / 14 + 3, z / 14 + 7, 11) + 0.12 * fbm(x / 4, z / 4, 12),
  props: [
    ...walls(100, 100),
    // central platform with 4 ramps
    platform(0, 0, 24, 3, 24),
    ramp(0, 18, 8, 12, 3, Math.PI), ramp(0, -18, 8, 12, 3, 0),
    ramp(18, 0, 8, 12, 3, -Math.PI / 2), ramp(-18, 0, 8, 12, 3, Math.PI / 2),
    // crates on platform corners
    crate(-9, -9, 2, { dy: 3 }), crate(9, 9, 2, { dy: 3 }), crate(9, -9, 2, { dy: 3 }), crate(-9, 9, 2, { dy: 3 }),
    // base platforms
    platform(0, 42, 16, 0.35, 10, 'metal'), platform(0, -42, 16, 0.35, 10, 'metal'),
    bunker(-14, 36, 0), bunker(14, 36, 0), bunker(-14, -36, 0), bunker(14, -36, 0),
    // side structures
    container(-38, 10, 0.2, 1), container(-38, 18, 0.1, 2), container(-38, 14, 0.15, 3, { dy: 2.7 }),
    container(38, -10, -0.2, 2), container(38, -18, -0.1, 1),
    container(-30, -30, Math.PI / 4, 3), container(30, 30, Math.PI / 4, 1),
    // crate clusters
    crate(-24, 24), crate(-22, 26), crate(-24, 26), crate(-23, 25, 2, { dy: 2 }),
    crate(24, -24), crate(22, -26), crate(24, -26), crate(23, -25, 2, { dy: 2 }),
    crate(26, 20, 1.6), crate(-26, -20, 1.6), crate(32, 4, 1.8), crate(-32, -4, 1.8),
    crate(10, 30, 2), crate(12, 30, 2), crate(-10, -30, 2), crate(-12, -30, 2),
    // barriers
    barrier(-20, 0, Math.PI / 2), barrier(20, 0, Math.PI / 2), barrier(0, 28, 0), barrier(0, -28, 0),
    barrier(-40, -30, 0.3), barrier(40, 30, 0.3), barrier(40, -36, 1.2), barrier(-40, 36, 1.2),
  ],
  spawns: {
    dm: [
      ...ring(0, 0, 40, 10, true, 0.3),
      { x: -36, z: 0, yaw: Math.PI / 2 }, { x: 36, z: 0, yaw: -Math.PI / 2 },
    ],
    red: line(-14, 46, 14, 46, 6, Math.PI),
    blue: line(-14, -46, 14, -46, 6, 0),
  },
  flags: { red: [0, 42], blue: [0, -42] },
  points: [{ id: 'A', x: 0, z: 0 }, { id: 'B', x: -34, z: 20 }, { id: 'C', x: 34, z: -20 }],
  drops: [[-30, 0], [30, 0], [0, 24], [0, -24], [-20, -40], [20, 40], [-40, -20], [40, 20]],
  gold: [[0, 0], [-32, 32], [32, -32], [0, 30], [0, -30]],
});

// ---- POLYGON -------------------------------------------------------------
const polyHeight = (x, z) => {
  const base = 7 * fbm(x / 42 + 10, z / 42 + 20, 21, 4) + 2.2 * fbm(x / 13, z / 13, 22, 3) - 3.5;
  const d = Math.hypot(x, z);
  const plateau = smoothstep(26, 14, d);          // 1 at centre
  let h = base * (1 - plateau) + 6.5 * plateau;
  // flatten bases
  const dr = Math.hypot(x - 60, z), db = Math.hypot(x + 60, z);
  const fr = smoothstep(22, 10, dr), fb = smoothstep(22, 10, db);
  h = h * (1 - fr) + 1.0 * fr;
  h = h * (1 - fb) + 1.0 * fb;
  // valley road across the middle (z axis)
  const road = smoothstep(9, 3, Math.abs(z)) * (1 - plateau);
  h -= road * 1.2;
  return h;
};
defineMap({
  id: 'polygon',
  name: 'Polygon',
  desc: 'Rolling green hills with a fortified central plateau. Long sight lines for snipers.',
  size: [150, 150],
  cell: 2,
  theme: {
    ground: 'grass',
    sky: { top: 0x2f6fc8, horizon: 0xd8e8f8, ground: 0x6f8a56 },
    fog: { color: 0xd4e3f2, near: 120, far: 380 },
    sun: [-80, 75, 60], sunColor: 0xfff4e0, sunIntensity: 3.0,
    hemi: [0xb6d4ff, 0x5a7a3f], hemiIntensity: 0.85,
    turbidity: 4, rayleigh: 2.2, mie: 0.004, fogDensity: 0.0024, envIntensity: 0.55,
    roads: [{ a: [-74, 0], b: [74, 0], w: 7 }],
  },
  height: polyHeight,
  props: [
    ...walls(150, 150),
    // plateau fort
    bunker(0, 14, 0, 12, 3.4, 5), bunker(0, -14, 0, 12, 3.4, 5),
    bunker(14, 0, Math.PI / 2, 12, 3.4, 5), bunker(-14, 0, Math.PI / 2, 12, 3.4, 5),
    crate(6, 6, 2), crate(-6, -6, 2), crate(6, -6, 1.6), crate(-6, 6, 1.6),
    // base structures
    platform(60, 0, 18, 0.35, 14, 'metal'), platform(-60, 0, 18, 0.35, 14, 'metal'),
    bunker(60, 12, Math.PI / 2), bunker(60, -12, Math.PI / 2), bunker(-60, 12, Math.PI / 2), bunker(-60, -12, Math.PI / 2),
    container(52, 16, 0.4, 1), container(-52, -16, 0.4, 2), container(52, -18, -0.5, 3), container(-52, 18, -0.5, 1),
    // scattered cover
    barrier(30, 20, 0.6), barrier(-30, -20, 0.6), barrier(30, -22, -0.6), barrier(-30, 22, -0.6),
    barrier(40, 40, 1.0), barrier(-40, -40, 1.0), barrier(40, -40, 2.0), barrier(-40, 40, 2.0),
    crate(24, 36), crate(26, 36), crate(25, 36, 2, { dy: 2 }), crate(-24, -36), crate(-26, -36), crate(-25, -36, 2, { dy: 2 }),
    crate(-20, 44, 1.8), crate(20, -44, 1.8), crate(50, 46, 2.2), crate(-50, -46, 2.2),
    bunker(0, 58, 0), bunker(0, -58, 0), bunker(32, 60, 0.3), bunker(-32, -60, 0.3),
    rock(44, -58, 3), rock(-44, 58, 3), rock(66, 44, 2.5, 0.5), rock(-66, -44, 2.5, 1.0), rock(10, 66, 2.2), rock(-10, -66, 2.2),
    rock(58, -30, 2), rock(-58, 30, 2), rock(20, -30, 1.6, 0.4), rock(-20, 30, 1.6, 0.9),
    // trees along the edges
    ...[-66, -56, -46, 46, 56, 66].flatMap((x) => [tree(x, 68, 1.1), tree(x, -68, 1.0)]),
    ...[-62, -50, 50, 62].flatMap((z) => [tree(68, z, 1.0), tree(-68, z, 1.1)]),
    tree(36, 46, 1.2), tree(-36, -46, 1.2), tree(40, -48, 0.9), tree(-40, 48, 0.9), tree(14, 56, 1.0), tree(-14, -56, 1.0),
    tree(64, -62, 1.3), tree(-64, 62, 1.3), tree(28, 64, 0.8), tree(-28, -64, 0.8),
  ],
  spawns: {
    dm: [...ring(0, 0, 50, 10, true, 0.15), ...ring(0, 0, 30, 6, true, 0.6)],
    red: line(66, -12, 66, 12, 6, -Math.PI / 2),
    blue: line(-66, -12, -66, 12, 6, Math.PI / 2),
  },
  flags: { red: [60, 0], blue: [-60, 0] },
  points: [{ id: 'A', x: 0, z: 0 }, { id: 'B', x: 0, z: 48 }, { id: 'C', x: 0, z: -48 }, { id: 'D', x: 40, z: 30 }, { id: 'E', x: -40, z: -30 }],
  drops: [[0, 30], [0, -30], [30, 0], [-30, 0], [40, 40], [-40, -40], [40, -40], [-40, 40], [20, 60], [-20, -60]],
  gold: [[0, 0], [0, 48], [0, -48], [40, 30], [-40, -30]],
});

// ---- SILENCE -------------------------------------------------------------
defineMap({
  id: 'silence',
  name: 'Silence',
  desc: 'An abandoned industrial district. Tight streets between tall buildings. Perfect for ambushes.',
  size: [130, 130],
  cell: 2,
  theme: {
    ground: 'asphalt',
    sky: { top: 0x47546b, horizon: 0xbfc6d1, ground: 0x4c4c4c },
    fog: { color: 0xb8bfc9, near: 70, far: 240 },
    sun: [50, 55, -70], sunColor: 0xffe9d0, sunIntensity: 2.3,
    hemi: [0xaab6c8, 0x3c3c3c], hemiIntensity: 0.75,
    turbidity: 11, rayleigh: 1.2, mie: 0.012, fogDensity: 0.0045, envIntensity: 0.5,
  },
  height: (x, z) => 0.15 * fbm(x / 9, z / 9, 31) + 0.05 * fbm(x / 2.5, z / 2.5, 32),
  props: [
    ...walls(130, 130, 'brick'),
    // building blocks on a grid, leaving streets of ~12m
    ...[[-44, -44, 16, 14, 16, 0], [-44, -14, 14, 10, 18, 1], [-44, 16, 16, 18, 14, 2], [-44, 44, 14, 9, 14, 3],
        [-14, -44, 18, 12, 14, 1], [16, -44, 14, 16, 16, 2], [44, -44, 16, 10, 14, 3],
        [-14, 44, 16, 12, 14, 2], [14, 44, 18, 9, 14, 0], [44, 44, 14, 15, 16, 1],
        [44, -14, 16, 17, 14, 0], [44, 16, 14, 11, 18, 3],
        [-16, 12, 10, 7, 10, 3], [16, -12, 10, 7, 10, 1]]
      .map(([x, z, w, h, l, t]) => building(x, z, w, h, l, 0, t)),
    // central plaza with a low platform
    platform(0, 0, 14, 1.2, 14, 'metal'),
    ramp(0, 11, 6, 8, 1.2, Math.PI), ramp(0, -11, 6, 8, 1.2, 0),
    // containers in streets
    container(-28, 8, Math.PI / 2, 1), container(28, -8, Math.PI / 2, 2), container(8, -28, 0, 3), container(-8, 28, 0, 1),
    container(-38, 24, 0.3, 2), container(38, -24, 0.3, 3), container(-38, -24, -0.3, 1),
    crate(-20, -24), crate(-18, -24), crate(-19, -24, 2, { dy: 2 }), crate(20, 24), crate(18, 24), crate(19, 24, 2, { dy: 2 }),
    crate(-56, 0, 2.2), crate(56, 0, 2.2), crate(0, 58, 2.2), crate(0, -58, 2.2),
    barrier(-10, -30, Math.PI / 2), barrier(10, 30, Math.PI / 2), barrier(-30, 10, 0), barrier(30, -10, 0),
    barrier(-58, -30, 0.2), barrier(58, 30, 0.2), barrier(-58, 30, -0.2), barrier(58, -30, -0.2),
    bunker(-56, 56, Math.PI / 4), bunker(56, -56, Math.PI / 4),
    bunker(28, 60, 0), bunker(-28, -60, 0),
  ],
  spawns: {
    dm: [...ring(0, 0, 30, 8, true, 0.4), ...ring(0, 0, 58, 8, true, 0.0)],
    red: [...line(46, 61, 61, 61, 4, Math.PI), ...line(61, 46, 61, 58, 3, -Math.PI / 2)],
    blue: [...line(-46, -61, -61, -61, 4, 0), ...line(-61, -46, -61, -58, 3, Math.PI / 2)],
  },
  flags: { red: [58, 58], blue: [-58, -58] },
  points: [{ id: 'A', x: 0, z: 0 }, { id: 'B', x: -30, z: 30 }, { id: 'C', x: 30, z: -30 }, { id: 'D', x: 30, z: 30 }, { id: 'E', x: -30, z: -30 }],
  drops: [[-28, 0], [28, 0], [0, 28], [0, -28], [-56, 0], [56, 0], [0, 56], [0, -56]],
  gold: [[0, 0], [-30, 30], [30, -30], [0, 56], [0, -56]],
});

// ---- KUNGUR --------------------------------------------------------------
const kungurHeight = (x, z) => {
  let h = 9 * fbm(x / 48 + 50, z / 48 + 70, 41, 5) + 2.5 * fbm(x / 12, z / 12, 42, 3) - 5;
  const d = Math.hypot(x, z);
  h += 13 * gauss(d, 22) * (0.75 + 0.25 * fbm(x / 10, z / 10, 43, 2));
  // flatten the summit
  const summit = smoothstep(14, 6, d);
  h = h * (1 - summit) + 13.5 * summit;
  const fr = smoothstep(24, 10, Math.hypot(x, z - 66)), fb = smoothstep(24, 10, Math.hypot(x, z + 66));
  h = h * (1 - fr) + 1.5 * fr;
  h = h * (1 - fb) + 1.5 * fb;
  return h;
};
defineMap({
  id: 'kungur',
  name: 'Kungur',
  desc: 'A snow covered mountain. Fight for the summit or sneak around the slopes.',
  size: [170, 170],
  cell: 2,
  theme: {
    ground: 'snow',
    sky: { top: 0x5a7fb0, horizon: 0xe6eef7, ground: 0xdde6ee },
    fog: { color: 0xe3ebf3, near: 110, far: 360 },
    sun: [70, 55, 90], sunColor: 0xfff8ee, sunIntensity: 2.8,
    hemi: [0xcfe0ff, 0x9fa8b3], hemiIntensity: 1.0,
    turbidity: 3, rayleigh: 2.6, mie: 0.003, fogDensity: 0.0022, envIntensity: 0.65,
  },
  height: kungurHeight,
  props: [
    ...walls(170, 170),
    // summit fort
    bunker(0, 10, 0, 10, 3, 5), bunker(0, -10, 0, 10, 3, 5), crate(7, 0, 2), crate(-7, 0, 2),
    // bases
    platform(0, 66, 20, 0.35, 14, 'metal'), platform(0, -66, 20, 0.35, 14, 'metal'),
    bunker(-14, 66, 0), bunker(14, 66, 0), bunker(-14, -66, 0), bunker(14, -66, 0),
    container(22, 58, 0.5, 1), container(-22, -58, 0.5, 2), container(-24, 74, -0.6, 3), container(24, -74, -0.6, 1),
    // slopes
    ...[[30, 30], [-30, -30], [30, -30], [-30, 30], [0, 40], [0, -40], [45, 0], [-45, 0]].map(([x, z]) => rock(x, z, 2.6, x * 0.1)),
    ...[[60, 50], [-60, -50], [62, -48], [-62, 48], [20, 70], [-20, -70], [70, 20], [-70, -20], [50, -70], [-50, 70]].map(([x, z]) => rock(x, z, 3.4, z * 0.05)),
    ...[[12, 24], [-12, -24], [24, -12], [-24, 12], [40, 18], [-40, -18], [18, -42], [-18, 42]].map(([x, z]) => rock(x, z, 1.5, x * 0.2)),
    barrier(0, 26, 0), barrier(0, -26, 0), barrier(26, 0, Math.PI / 2), barrier(-26, 0, Math.PI / 2),
    barrier(40, 50, 0.4), barrier(-40, -50, 0.4), barrier(-40, 52, -0.4), barrier(40, -52, -0.4),
    crate(44, 34), crate(46, 34), crate(45, 34, 2, { dy: 2 }), crate(-44, -34), crate(-46, -34), crate(-45, -34, 2, { dy: 2 }),
    // pine forest patches
    ...[[-60, 20], [-64, 30], [-56, 34], [-68, 8], [-52, 14], [60, -20], [64, -30], [56, -34], [68, -8], [52, -14],
        [-70, -62], [-62, -70], [70, 62], [62, 70], [-74, 50], [74, -50], [30, 74], [-30, -74], [-48, -44], [48, 44]]
      .map(([x, z], i) => tree(x, z, 0.9 + (i % 3) * 0.2)),
  ],
  spawns: {
    dm: [...ring(0, 0, 54, 10, true, 0.2), ...ring(0, 0, 34, 6, true, 0.7)],
    red: line(-16, 74, 16, 74, 6, Math.PI),
    blue: line(-16, -74, 16, -74, 6, 0),
  },
  flags: { red: [0, 66], blue: [0, -66] },
  points: [{ id: 'A', x: 0, z: 0 }, { id: 'B', x: 40, z: 30 }, { id: 'C', x: -40, z: -30 }],
  drops: [[0, 0], [30, 0], [-30, 0], [0, 36], [0, -36], [50, 40], [-50, -40], [50, -40], [-50, 40], [0, 60], [0, -60]],
  gold: [[0, 0], [40, 30], [-40, -30], [0, 40], [0, -40]],
});

// ---- builder --------------------------------------------------------------
export const MAP_LIST = Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, desc: m.desc, size: m.size, ground: m.theme.ground }));

export function getMapDef(id) { return MAPS[id] || MAPS.sandbox; }

export function buildMap(id) {
  const def = getMapDef(id);
  const [W, L] = def.size;
  const cell = def.cell;
  const nx = Math.round(W / cell) + 1;
  const nz = Math.round(L / cell) + 1;
  const halfW = W / 2, halfL = L / 2;
  // heights[i][j] : world x = -halfW + i*cell, world z = halfL - j*cell (cannon heightfield layout)
  const heights = new Array(nx);
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < nx; i++) {
    const col = new Array(nz);
    const x = -halfW + i * cell;
    for (let j = 0; j < nz; j++) {
      const z = halfL - j * cell;
      const h = def.height(x, z);
      col[j] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    heights[i] = col;
  }
  const heightAt = (x, z) => {
    const fx = clamp((x + halfW) / cell, 0, nx - 1.0001);
    const fz = clamp((halfL - z) / cell, 0, nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = heights[i][j], h10 = heights[i + 1][j], h01 = heights[i][j + 1], h11 = heights[i + 1][j + 1];
    // match cannon's triangle split: quad split along the (i,j)-(i+1,j+1) diagonal
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };
  const props = def.props.map((p, idx) => {
    const gy = heightAt(p.x, p.z);
    const y = gy + p.h / 2 + (p.dy || 0) - 0.05;
    let q = qYaw(p.yaw || 0);
    if (p.pitch) q = qMul(q, qFromAxisAngle([1, 0, 0], p.pitch));
    return { id: idx, kind: p.kind, mat: p.mat, tint: p.tint || 0, rise: p.rise || 0,
      pos: [p.x, y, p.z], size: [p.w, p.h, p.l], quat: q, yaw: p.yaw || 0, pitch: p.pitch || 0 };
  });
  const spawnsOf = (list) => list.map((s) => ({ pos: [s.x, heightAt(s.x, s.z) + 1.2, s.z], yaw: s.yaw }));
  const built = {
    id: def.id, name: def.name, desc: def.desc, theme: def.theme,
    size: def.size, cell, nx, nz, halfW, halfL, heights, minH, maxH, heightAt, props,
    spawns: { dm: spawnsOf(def.spawns.dm), red: spawnsOf(def.spawns.red), blue: spawnsOf(def.spawns.blue) },
    flags: { red: [def.flags.red[0], heightAt(def.flags.red[0], def.flags.red[1]), def.flags.red[1]],
             blue: [def.flags.blue[0], heightAt(def.flags.blue[0], def.flags.blue[1]), def.flags.blue[1]] },
    points: def.points.map((p) => ({ id: p.id, pos: [p.x, heightAt(p.x, p.z), p.z] })),
    drops: def.drops.map(([x, z]) => [x, heightAt(x, z), z]),
    gold: def.gold.map(([x, z]) => [x, heightAt(x, z), z]),
  };
  // Raise flag/point/drop positions that sit on top of a platform prop
  const topOfProps = (pos) => {
    let y = pos[1];
    for (const p of props) {
      if (p.kind !== 'box' && p.kind !== 'building') continue;
      if (p.pitch) continue;
      const dx = pos[0] - p.pos[0], dz = pos[2] - p.pos[2];
      const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= p.size[0] / 2 && Math.abs(lz) <= p.size[2] / 2) {
        const top = p.pos[1] + p.size[1] / 2;
        if (top > y && top - y < 4) y = top;
      }
    }
    return [pos[0], y, pos[2]];
  };
  built.flags.red = topOfProps(built.flags.red);
  built.flags.blue = topOfProps(built.flags.blue);
  built.points = built.points.map((p) => ({ id: p.id, pos: topOfProps(p.pos) }));
  built.drops = built.drops.map(topOfProps);
  built.gold = built.gold.map(topOfProps);
  built.surfaceAt = (x, z) => topOfProps([x, heightAt(x, z), z])[1];
  return built;
}

export function randomSpawn(map, team, rng = Math.random, avoid = []) {
  const list = team === 1 ? map.spawns.red : team === 2 ? map.spawns.blue : map.spawns.dm;
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < list.length; k++) {
    const s = list[(Math.floor(rng() * list.length) + k) % list.length];
    let minD = Infinity;
    for (const a of avoid) { const d = Math.hypot(a[0] - s.pos[0], a[2] - s.pos[2]); if (d < minD) minD = d; }
    const score = Math.min(minD, 30) + rng() * 5;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best || list[0];
}

export { mulberry32 };
