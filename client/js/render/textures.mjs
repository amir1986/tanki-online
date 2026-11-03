// Procedural PBR textures (albedo + normal maps), all generated at runtime, all tileable.
import * as THREE from 'three';
import { hash2 } from '/shared/noise.mjs';
import { Assets } from './assets.mjs';

// File based CC0 PBR sets (ambientCG) by role; the procedural builders below remain as fallbacks.
export const GROUND_SETS = { grass: 'grass', dirt: 'dirt', dirtDry: 'dirtDry', rock: 'rock', rockMoss: 'rockMoss', sand: 'sand', snow: 'snow', snowDirty: 'snowDirty', asphalt: 'asphalt', gravel: 'gravel' };
export const PROP_SETS = { concrete: 'concrete', metal: 'metalPlates', metalSmooth: 'metal', crate: 'planks', container: 'corrugated', brick: 'bricks', building: 'concretePlain', barrier: 'concreteDamaged', bunker: 'concreteBunker', rock: 'rock', bark: 'bark', leaves: 'moss', pine: 'moss', treads: 'rubber', steel: 'metalDirty', sandbag: 'fabric', rubber: 'rubber', tiles: 'tiles', road: 'asphaltDark', painted: 'metalPainted', plates: 'metalPlates', rust: 'metalRust', metalAged: 'metalAged', corrugatedBlue: 'corrugatedBlue', paintedWood: 'paintedWood' };
export const TEXTURE_SETS = [...new Set([...Object.values(GROUND_SETS), ...Object.values(PROP_SETS)])];

const cache = new Map();
const canvas = (size) => { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; };
const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smooth = (t) => t * t * (3 - 2 * t);

// ---- tileable noise -----------------------------------------------------------------
function pvalue(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
  const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Tileable fbm; u,v in [0,1). P = lattice period of the first octave. */
function tfbm(u, v, P, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, p = P;
  for (let i = 0; i < octaves; i++) {
    sum += amp * pvalue(u * p, v * p, p, seed + i * 101);
    norm += amp; amp *= gain; p *= 2;
  }
  return sum / norm;
}
/** Float32 field res*res with tileable fbm. */
function field(res, P, octaves, seed, gain = 0.5) {
  const f = new Float32Array(res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) f[y * res + x] = tfbm(x / res, y / res, P, octaves, seed, gain);
  return f;
}
/** Bilinear sample of a field with wrap; u,v in [0,1). */
function sampleF(f, res, u, v) {
  const x = ((u % 1) + 1) % 1 * res, y = ((v % 1) + 1) % 1 * res;
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x1 = (xi + 1) % res, y1 = (yi + 1) % res;
  const a = f[yi * res + xi], b = f[yi * res + x1], c = f[y1 * res + xi], d = f[y1 * res + x1];
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

/** Paint a size*size canvas with fn(u,v,x,y) -> [r,g,b] (0..255). Also returns a height field if fn sets h. */
function paintCanvas(size, fn) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const col = fn(x / size, v, x, y);
      const i = (y * size + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function heightCanvas(size, fn) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x / size, y / size, x, y);
  return h;
}
function normalFromHeight(h, res, strength) {
  const c = canvas(res), ctx = c.getContext('2d');
  const img = ctx.createImageData(res, res);
  const d = img.data;
  for (let y = 0; y < res; y++) {
    const yu = (y - 1 + res) % res, yd = (y + 1) % res;
    for (let x = 0; x < res; x++) {
      const xl = (x - 1 + res) % res, xr = (x + 1) % res;
      const l = h[y * res + xl], r = h[y * res + xr], u = h[yu * res + x], dn = h[yd * res + x];
      let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * res + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function makeTex(c, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function scribble(ctx, size, n, color, alpha, lenMin, lenMax, width, seed, vertical = false) {
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, seed) * size, y = hash2(i, 2, seed) * size;
    const a = vertical ? Math.PI / 2 + (hash2(i, 3, seed) - 0.5) * 0.3 : hash2(i, 3, seed) * Math.PI * 2;
    const l = lenMin + hash2(i, 4, seed) * (lenMax - lenMin);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function speckle(ctx, size, n, color, alpha, rMin, rMax, seed) {
  ctx.fillStyle = color; ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 11, seed) * size, y = hash2(i, 12, seed) * size;
    const r = rMin + hash2(i, 13, seed) * (rMax - rMin);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + hash2(i, 14, seed) * 0.6), hash2(i, 15, seed) * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
/** Draw into a height field through a canvas (for details like pebbles/gaps). */
function heightFromCanvas(c) {
  const res = c.width, ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, res, res).data;
  const h = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) h[i] = d[i * 4] / 255;
  return h;
}
function heightToCanvas(h, res) {
  const c = canvas(res), ctx = c.getContext('2d');
  const img = ctx.createImageData(res, res);
  for (let i = 0; i < res * res; i++) { const v = clamp(h[i], 0, 1) * 255; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

const SET = (map, normal) => ({ map, normal });

// ---- ground sets ------------------------------------------------------------------------
const groundBuilders = {
  grass() {
    const R = 1024, F = 512;
    const macro = field(F, 3, 3, 11), mid = field(F, 12, 4, 12), fine = field(F, 40, 2, 13);
    const dark = rgb(0x3d5423), light = rgb(0x7b9444), dry = rgb(0x97a05a), soil = rgb(0x5d4b33), moss = rgb(0x4f6a2c);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), k = sampleF(mid, F, u, v), f = sampleF(fine, F, u, v);
      const h = k * 0.65 + f * 0.35;
      H[y * R + x] = h;
      let col = mix(dark, light, h);
      col = mix(col, moss, sstep(0.45, 0.6, m) * 0.5);
      col = mix(col, dry, sstep(0.62, 0.82, m) * 0.7);
      const soilMask = sstep(0.42, 0.3, m * 0.6 + k * 0.4);
      col = mix(col, soil, soilMask);
      const g = hash2(x, y, 7);
      col = mul(col, 0.9 + g * 0.2);
      return col;
    });
    const ctx = c.getContext('2d');
    scribble(ctx, R, 9000, '#2f4518', 0.35, 3, 9, 1.1, 21, true);
    scribble(ctx, R, 6000, '#9db65a', 0.28, 2, 7, 1, 22, true);
    speckle(ctx, R, 500, '#6b5636', 0.25, 1.5, 5, 23);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 2.6), { srgb: false }));
  },
  dirt() {
    const R = 1024, F = 512;
    const macro = field(F, 4, 3, 31), mid = field(F, 16, 4, 32), fine = field(F, 64, 2, 33);
    const dark = rgb(0x554433), light = rgb(0x8d7858), pale = rgb(0xa08d6c);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), k = sampleF(mid, F, u, v), f = sampleF(fine, F, u, v);
      H[y * R + x] = k * 0.6 + f * 0.4;
      let col = mix(dark, light, k);
      col = mix(col, pale, sstep(0.6, 0.85, m) * 0.5);
      return mul(col, 0.85 + f * 0.3 + hash2(x, y, 9) * 0.08);
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 2600, '#4a3b2a', 0.35, 1, 4, 34);
    speckle(ctx, R, 1800, '#b3a184', 0.3, 1, 3.5, 35);
    scribble(ctx, R, 60, '#3a2d20', 0.45, 60, 220, 1.4, 36);
    // pebbles into height
    const hc = heightToCanvas(H, R), hctx = hc.getContext('2d');
    speckle(hctx, R, 1800, '#ffffff', 0.5, 1, 3.5, 35);
    scribble(hctx, R, 60, '#000000', 0.8, 60, 220, 1.4, 36);
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 3.2), { srgb: false }));
  },
  rock() {
    const R = 1024, F = 512;
    const macro = field(F, 5, 4, 41, 0.55), fine = field(F, 24, 3, 42);
    const dark = rgb(0x4a4b4e), light = rgb(0x8f8d87), warm = rgb(0x7d7467);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), f = sampleF(fine, F, u, v);
      const h = m * 0.7 + f * 0.3;
      H[y * R + x] = h;
      let col = mix(dark, light, h);
      col = mix(col, warm, sstep(0.55, 0.75, f) * 0.4);
      return mul(col, 0.9 + hash2(x, y, 3) * 0.2);
    });
    const ctx = c.getContext('2d');
    scribble(ctx, R, 140, '#36373a', 0.5, 40, 260, 1.6, 43);
    const hc = heightToCanvas(H, R), hctx = hc.getContext('2d');
    scribble(hctx, R, 140, '#000000', 0.9, 40, 260, 1.8, 43);
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 4.0), { srgb: false }));
  },
  sand() {
    const R = 1024, F = 512;
    const macro = field(F, 3, 3, 51), mid = field(F, 14, 3, 52);
    const dark = rgb(0xb89f70), light = rgb(0xe2d0a4), hot = rgb(0xeadcb6);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), k = sampleF(mid, F, u, v);
      const ripple = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (v * 22 + 0.9 * k + 0.3 * m));
      const h = ripple * 0.55 + k * 0.45;
      H[y * R + x] = h;
      let col = mix(dark, light, h * 0.7 + m * 0.3);
      col = mix(col, hot, sstep(0.6, 0.9, m) * 0.5);
      return mul(col, 0.95 + hash2(x, y, 5) * 0.1);
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 3500, '#9a8459', 0.2, 0.6, 1.8, 53);
    speckle(ctx, R, 2000, '#f4ead0', 0.2, 0.6, 1.5, 54);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 1.6), { srgb: false }));
  },
  snow() {
    const R = 1024, F = 512;
    const macro = field(F, 3, 3, 61), mid = field(F, 10, 3, 62), fine = field(F, 48, 2, 63);
    const shade = rgb(0xcfdbe6), white = rgb(0xffffff), blue = rgb(0xbfd0e2);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), k = sampleF(mid, F, u, v), f = sampleF(fine, F, u, v);
      const h = k * 0.75 + f * 0.25;
      H[y * R + x] = h;
      let col = mix(shade, white, h);
      col = mix(col, blue, sstep(0.3, 0.1, m) * 0.5);
      return mul(col, 0.96 + hash2(x, y, 6) * 0.06);
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 2500, '#ffffff', 0.5, 0.5, 1.5, 64);
    speckle(ctx, R, 900, '#b9c8d8', 0.25, 1, 3, 65);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 1.4), { srgb: false }));
  },
  asphalt() {
    const R = 1024, F = 512;
    const macro = field(F, 3, 3, 71), fine = field(F, 96, 2, 72);
    const dark = rgb(0x303134), light = rgb(0x5a5c60), pale = rgb(0x6c6e72);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), f = sampleF(fine, F, u, v);
      const g = hash2(x, y, 8);
      const h = f * 0.6 + g * 0.4;
      H[y * R + x] = h;
      let col = mix(dark, light, h);
      col = mix(col, pale, sstep(0.65, 0.9, m) * 0.6);
      return col;
    });
    const ctx = c.getContext('2d');
    scribble(ctx, R, 26, '#1f2022', 0.7, 120, 420, 1.6, 73);
    scribble(ctx, R, 300, '#262729', 0.4, 10, 40, 1, 74);
    speckle(ctx, R, 1200, '#44464a', 0.3, 1, 3, 75);
    const hc = heightToCanvas(H, R), hctx = hc.getContext('2d');
    scribble(hctx, R, 26, '#000000', 0.9, 120, 420, 2, 73);
    // puddles: low roughness blobs so the asphalt reflects the sky after rain
    const puddle = field(F, 5, 3, 76);
    const rc = paintCanvas(R, (u, v) => { const k = sampleF(puddle, F, u, v); const r = 235 - 200 * sstep(0.62, 0.7, k); return [r, r, r]; });
    const set = SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 2.2), { srgb: false }));
    set.rough = makeTex(rc, { srgb: false });
    return set;
  },
};

// ---- prop sets ----------------------------------------------------------------------------
const propBuilders = {
  concrete() {
    const R = 512, F = 256;
    const mid = field(F, 6, 4, 81), fine = field(F, 40, 2, 82);
    const a = rgb(0x7a7c7f), b = rgb(0xa6a7a8);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const k = sampleF(mid, F, u, v), f = sampleF(fine, F, u, v);
      H[y * R + x] = k * 0.5 + f * 0.5;
      // vertical weathering streaks
      const streak = sstep(0.7, 1, sampleF(fine, F, u * 0.3, 0.17)) * (0.3 + 0.7 * v);
      return mul(mix(a, b, k * 0.6 + f * 0.4), (0.92 + hash2(x, y, 4) * 0.12) * (1 - streak * 0.25));
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 500, '#5f6164', 0.25, 0.8, 2.2, 83);
    scribble(ctx, R, 10, '#56585b', 0.3, 40, 160, 1, 84);
    // panel seams and form-tie holes
    ctx.fillStyle = 'rgba(40,42,45,0.55)';
    ctx.fillRect(0, R / 2 - 2, R, 4); ctx.fillRect(R / 2 - 2, 0, 4, R);
    ctx.fillStyle = 'rgba(30,32,35,0.7)';
    for (const [x, y] of [[R * 0.25, R * 0.25], [R * 0.75, R * 0.25], [R * 0.25, R * 0.75], [R * 0.75, R * 0.75]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    // water stains running down from the seam
    for (let i = 0; i < 8; i++) {
      const x = hash2(i, 5, 85) * R, w = 10 + hash2(i, 6, 85) * 30, len = 60 + hash2(i, 7, 85) * 120;
      const g = ctx.createLinearGradient(0, R / 2, 0, R / 2 + len);
      g.addColorStop(0, 'rgba(50,52,55,0.35)'); g.addColorStop(1, 'rgba(50,52,55,0)');
      ctx.fillStyle = g; ctx.fillRect(x, R / 2, w, len);
    }
    const hc = heightToCanvas(H, R), hctx = hc.getContext('2d');
    speckle(hctx, R, 500, '#000000', 0.5, 0.8, 2.2, 83);
    hctx.fillStyle = '#000000'; hctx.fillRect(0, R / 2 - 2, R, 4); hctx.fillRect(R / 2 - 2, 0, 4, R);
    for (const [x, y] of [[R * 0.25, R * 0.25], [R * 0.75, R * 0.25], [R * 0.25, R * 0.75], [R * 0.75, R * 0.75]]) { hctx.beginPath(); hctx.arc(x, y, 4, 0, Math.PI * 2); hctx.fill(); }
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 2.0), { srgb: false }));
  },
  bunker() {
    const R = 512, F = 256;
    const mid = field(F, 5, 4, 91), fine = field(F, 36, 2, 92);
    const a = rgb(0x55585c), b = rgb(0x7d8186);
    const c = paintCanvas(R, (u, v, x, y) => {
      const k = sampleF(mid, F, u, v), f = sampleF(fine, F, u, v);
      const streak = sstep(0.72, 1, sampleF(fine, F, u * 0.25, 0.4)) * v;
      return mul(mix(a, b, k * 0.6 + f * 0.4), (0.9 + hash2(x, y, 4) * 0.15) * (1 - streak * 0.3));
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 1600, '#404346', 0.35, 0.8, 2.5, 93);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, R * 0.44, R, R * 0.07);
    const H = heightCanvas(R, (u, v) => sampleF(mid, F, u, v) * 0.5 + sampleF(fine, F, u, v) * 0.5);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 1.4), { srgb: false }));
  },
  metal() {
    const R = 512, F = 256;
    const fine = field(F, 30, 3, 101);
    const a = rgb(0x5e646b), b = rgb(0x8a9097);
    const c = paintCanvas(R, (u, v, x, y) => {
      const f = sampleF(fine, F, u, v);
      const brushed = hash2(x >> 3, y, 3) * 0.08;
      return mul(mix(a, b, f * 0.6 + 0.2), 0.9 + brushed + hash2(x, y, 2) * 0.05);
    });
    const ctx = c.getContext('2d');
    const hc = canvas(R), hctx = hc.getContext('2d');
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, R, R);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3; hctx.strokeStyle = '#303030'; hctx.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      for (const [x0, y0, x1, y1] of [[i * R / 2, 0, i * R / 2, R], [0, i * R / 2, R, i * R / 2]]) {
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        hctx.beginPath(); hctx.moveTo(x0, y0); hctx.lineTo(x1, y1); hctx.stroke();
      }
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (const [dx, dy] of [[14, 14], [R / 2 - 14, 14], [14, R / 2 - 14], [R / 2 - 14, R / 2 - 14]]) {
      const x = i * R / 2 + dx, y = j * R / 2 + dy;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      hctx.fillStyle = '#d0d0d0'; hctx.beginPath(); hctx.arc(x, y, 4, 0, Math.PI * 2); hctx.fill();
    }
    scribble(ctx, R, 120, '#2b2f33', 0.25, 10, 60, 1, 102);
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 2.4), { srgb: false }));
  },
  crate() {
    const R = 512, F = 256;
    const grain = field(F, 40, 3, 111);
    const a = rgb(0x6a4524), b = rgb(0xa67d4b);
    const planks = 5, ph = R / planks;
    const c = paintCanvas(R, (u, v, x, y) => {
      const g = sampleF(grain, F, u * 0.12 + Math.floor(v * planks) * 0.37, v * 3);
      let col = mix(a, b, g);
      const inPlank = (y % ph);
      if (inPlank < 3 || inPlank > ph - 3) col = mul(col, 0.35);
      return mul(col, 0.9 + hash2(x, y, 1) * 0.15);
    });
    const ctx = c.getContext('2d');
    scribble(ctx, R, 500, '#55371c', 0.3, 20, 120, 1, 112);
    // frame boards + diagonal
    ctx.fillStyle = 'rgba(70,45,20,0.55)';
    ctx.fillRect(0, 0, R, 14); ctx.fillRect(0, R - 14, R, 14); ctx.fillRect(0, 0, 14, R); ctx.fillRect(R - 14, 0, 14, R);
    ctx.save(); ctx.translate(R / 2, R / 2); ctx.rotate(Math.PI / 4); ctx.fillRect(-R, -8, R * 2, 16); ctx.restore();
    ctx.fillStyle = 'rgba(30,30,30,0.8)';
    for (const [x, y] of [[26, 26], [R - 26, 26], [26, R - 26], [R - 26, R - 26], [R / 2, 26], [R / 2, R - 26], [26, R / 2], [R - 26, R / 2]]) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); }
    const hc = canvas(R), hctx = hc.getContext('2d');
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, R, R);
    hctx.fillStyle = '#000000';
    for (let i = 0; i <= planks; i++) hctx.fillRect(0, i * ph - 2, R, 4);
    hctx.fillStyle = '#b0b0b0'; hctx.fillRect(0, 0, R, 14); hctx.fillRect(0, R - 14, R, 14); hctx.fillRect(0, 0, 14, R); hctx.fillRect(R - 14, 0, 14, R);
    hctx.save(); hctx.translate(R / 2, R / 2); hctx.rotate(Math.PI / 4); hctx.fillRect(-R, -8, R * 2, 16); hctx.restore();
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 3.0), { srgb: false }));
  },
  container() {
    const R = 512, F = 256;
    const rust = field(F, 6, 4, 121);
    const base = rgb(0xd9d9d9), rustC = rgb(0x7a3b1e);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const corr = 0.5 + 0.5 * Math.sin(Math.PI * 2 * u * 14);
      H[y * R + x] = corr;
      const r = sampleF(rust, F, u, v);
      const streak = sstep(0.62, 0.95, r) * (0.4 + 0.6 * v);
      let col = mul(base, 0.8 + corr * 0.25);
      col = mix(col, rustC, streak * 0.85);
      return mul(col, 0.95 + hash2(x, y, 2) * 0.08);
    });
    const ctx = c.getContext('2d');
    speckle(ctx, R, 300, '#5a3a22', 0.3, 1, 5, 122);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, R, 10); ctx.fillRect(0, R - 10, R, 10);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 3.2), { srgb: false }));
  },
  brick() {
    const R = 512;
    const c = canvas(R), ctx = c.getContext('2d');
    const hc = canvas(R), hctx = hc.getContext('2d');
    ctx.fillStyle = '#6b6560'; ctx.fillRect(0, 0, R, R);
    hctx.fillStyle = '#202020'; hctx.fillRect(0, 0, R, R);
    const bh = 32, bw = 64;
    for (let y = 0, row = 0; y < R; y += bh, row++) {
      for (let x = -(row % 2) * bw / 2; x < R; x += bw) {
        const n = hash2(x, y, 70);
        ctx.fillStyle = `rgb(${115 + n * 45 | 0},${58 + n * 24 | 0},${44 + n * 18 | 0})`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        hctx.fillStyle = `rgb(${190 + n * 40 | 0},${190 + n * 40 | 0},${190 + n * 40 | 0})`;
        hctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
    speckle(ctx, R, 2500, '#000000', 0.12, 0.5, 2, 131);
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 3.0), { srgb: false }));
  },
  building() {
    const R = 512, F = 256;
    const mid = field(F, 6, 3, 141);
    const a = rgb(0x8c8d90), b = rgb(0xb0b1b3);
    const c = paintCanvas(R, (u, v, x, y) => {
      const k = sampleF(mid, F, u, v);
      const streak = sstep(0.7, 1, sampleF(mid, F, u * 0.4, 0.3)) * v;
      return mul(mix(a, b, k), (0.92 + hash2(x, y, 4) * 0.1) * (1 - streak * 0.2));
    });
    const ctx = c.getContext('2d');
    const hc = canvas(R), hctx = hc.getContext('2d');
    hctx.fillStyle = '#909090'; hctx.fillRect(0, 0, R, R);
    const cols = 4, rows = 4, cw = R / cols, rh = R / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = i * cw + cw * 0.2, y = j * rh + rh * 0.18, w = cw * 0.6, h = rh * 0.52;
      const lit = hash2(i, j, 81) < 0.22;
      // frame
      ctx.fillStyle = '#4a4d52'; ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
      // glass with gradient
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      if (lit) { g.addColorStop(0, '#ffe7b0'); g.addColorStop(1, '#d8b56a'); }
      else { g.addColorStop(0, '#2a3a4c'); g.addColorStop(0.5, '#17202b'); g.addColorStop(1, '#3a4d63'); }
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + w / 2 - 2, y, 4, h); ctx.fillRect(x, y + h / 2 - 2, w, 4);
      // ledge
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 10, y + h + 6, w + 20, 5);
      hctx.fillStyle = '#202020'; hctx.fillRect(x, y, w, h);
      hctx.fillStyle = '#c0c0c0'; hctx.fillRect(x - 10, y + h + 6, w + 20, 6);
    }
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 3.2), { srgb: false }));
  },
  barrier() {
    const R = 512, F = 256;
    const mid = field(F, 6, 4, 151);
    const a = rgb(0x9a9c9f), b = rgb(0xbdbfc2);
    const c = paintCanvas(R, (u, v, x, y) => mul(mix(a, b, sampleF(mid, F, u, v)), 0.92 + hash2(x, y, 4) * 0.12));
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(180,36,30,0.78)';
    for (let x = -R; x < R * 2; x += 128) { ctx.beginPath(); ctx.moveTo(x, R); ctx.lineTo(x + 64, R); ctx.lineTo(x + 128, 0); ctx.lineTo(x + 64, 0); ctx.closePath(); ctx.fill(); }
    speckle(ctx, R, 500, '#6a6c6f', 0.4, 1, 4, 152);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, R, 10); ctx.fillRect(0, R - 10, R, 10);
    const H = heightCanvas(R, (u, v) => sampleF(mid, F, u, v));
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 1.2), { srgb: false }));
  },
  rock() {
    const R = 512, F = 256;
    const macro = field(F, 4, 4, 161, 0.55), fine = field(F, 20, 3, 162);
    const dark = rgb(0x46474a), light = rgb(0x8d8b85), warm = rgb(0x6f685c);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const m = sampleF(macro, F, u, v), f = sampleF(fine, F, u, v);
      const h = m * 0.7 + f * 0.3;
      H[y * R + x] = h;
      let col = mix(dark, light, h);
      col = mix(col, warm, sstep(0.55, 0.8, f) * 0.4);
      return mul(col, 0.9 + hash2(x, y, 3) * 0.2);
    });
    const ctx = c.getContext('2d');
    scribble(ctx, R, 60, '#303134', 0.5, 30, 160, 1.4, 163);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 3.5), { srgb: false }));
  },
  bark() {
    const R = 256, F = 128;
    const f = field(F, 10, 3, 171);
    const a = rgb(0x3b2a1b), b = rgb(0x6a5038);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => { const k = sampleF(f, F, u * 4, v * 0.5); H[y * R + x] = k; return mul(mix(a, b, k), 0.9 + hash2(x, y, 1) * 0.15); });
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 3.0), { srgb: false }));
  },
  leaves() {
    const R = 256, F = 128;
    const f = field(F, 8, 3, 181);
    const a = rgb(0x24461c), b = rgb(0x5c8a3a);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => { const k = sampleF(f, F, u, v); H[y * R + x] = k; return mul(mix(a, b, k), 0.85 + hash2(x, y, 1) * 0.3); });
    speckle(c.getContext('2d'), R, 700, '#1a3314', 0.4, 1, 3, 182);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 2.5), { srgb: false }));
  },
  pine() {
    const R = 256, F = 128;
    const f = field(F, 7, 3, 191);
    const a = rgb(0x1f3f24), b = rgb(0x3f7243);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => { const k = sampleF(f, F, u, v); H[y * R + x] = k; return mul(mix(a, b, k), 0.85 + hash2(x, y, 1) * 0.3); });
    speckle(c.getContext('2d'), R, 500, '#e7eef4', 0.45, 1, 3, 192);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 2.5), { srgb: false }));
  },
  treads() {
    const R = 256;
    const c = canvas(R), ctx = c.getContext('2d');
    const hc = canvas(R), hctx = hc.getContext('2d');
    ctx.fillStyle = '#26282a'; ctx.fillRect(0, 0, R, R);
    hctx.fillStyle = '#404040'; hctx.fillRect(0, 0, R, R);
    for (let y = 0; y < R; y += 32) {
      ctx.fillStyle = '#4a4d50'; ctx.fillRect(0, y, R, 18);
      ctx.fillStyle = '#5a5e62'; ctx.fillRect(R * 0.35, y + 4, R * 0.3, 10);
      ctx.fillStyle = '#141516'; ctx.fillRect(0, y + 18, R, 4);
      hctx.fillStyle = '#c8c8c8'; hctx.fillRect(0, y, R, 18);
      hctx.fillStyle = '#ffffff'; hctx.fillRect(R * 0.35, y + 4, R * 0.3, 10);
      hctx.fillStyle = '#000000'; hctx.fillRect(0, y + 18, R, 4);
    }
    speckle(ctx, R, 400, '#7a6a50', 0.25, 0.5, 2, 201);
    return SET(makeTex(c), makeTex(normalFromHeight(heightFromCanvas(hc), R, 3.0), { srgb: false }));
  },
  steel() {
    const R = 256;
    const c = paintCanvas(R, (u, v, x, y) => { const k = 0.8 + hash2(x >> 2, y, 7) * 0.2; return mul(rgb(0x3c4046), k + hash2(x, y, 9) * 0.05); });
    const H = heightCanvas(R, (u, v, x, y) => hash2(x >> 2, y, 7) * 0.5 + hash2(x, y, 9) * 0.1);
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 0.6), { srgb: false }));
  },
  sandbag() {
    const R = 256, F = 128;
    const f = field(F, 8, 3, 331), f2 = field(F, 40, 2, 332);
    const a = rgb(0x8a7a52), b = rgb(0xb3a376);
    const H = new Float32Array(R * R);
    const c = paintCanvas(R, (u, v, x, y) => {
      const k = sampleF(f, F, u, v), k2 = sampleF(f2, F, u, v);
      const seam = 0.5 + 0.5 * Math.sin(Math.PI * 2 * v * 3);
      H[y * R + x] = k2 * 0.4 + seam * 0.6;
      return mul(mix(a, b, k), (0.85 + k2 * 0.25) * (0.8 + 0.2 * seam));
    });
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 2.2), { srgb: false }));
  },
  rubber() {
    const R = 128;
    const c = paintCanvas(R, (u, v, x, y) => mul(rgb(0x1e1f21), 0.9 + hash2(x, y, 3) * 0.2));
    const H = heightCanvas(R, (u, v, x, y) => hash2(x, y, 3));
    return SET(makeTex(c), makeTex(normalFromHeight(H, R, 0.8), { srgb: false }));
  },
};

// ---- misc ----------------------------------------------------------------------------------
const miscBuilders = {
  particle(size = 64) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  smoke(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const f = field(64, 4, 3, 211);
    for (let i = 0; i < img.data.length; i += 4) { const x = (i / 4) % size, y = (i / 4 / size) | 0; img.data[i + 3] *= 0.45 + 0.55 * sampleF(f, 64, x / size, y / size); }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  spark(size = 32) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  blob(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  glare(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.08, 'rgba(255,245,220,0.9)'); g.addColorStop(0.25, 'rgba(255,230,180,0.25)'); g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  grassBlade(size = 256) { return bladeTex(size, ['#3f6a22', '#5d8f32', '#7aa63e'], '#2a4a16'); },
  dryBlade(size = 256) { return bladeTex(size, ['#a6965a', '#c2b074', '#8f834c'], '#6e6338'); },
  leafCard(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 70; i++) {
      const x = size * (0.15 + hash2(i, 1, 311) * 0.7), y = size * (0.15 + hash2(i, 2, 311) * 0.7);
      const r = size * (0.05 + hash2(i, 3, 311) * 0.06);
      const g = 60 + hash2(i, 4, 311) * 90, rr = 30 + hash2(i, 5, 311) * 40;
      ctx.fillStyle = `rgb(${rr | 0},${g | 0},${(20 + hash2(i, 6, 311) * 30) | 0})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, hash2(i, 7, 311) * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  },
  paintRough(size = 256) {
    const F = 128;
    const f = field(F, 6, 3, 321), f2 = field(F, 30, 2, 322);
    const c = paintCanvas(size, (u, v, x, y) => { const k = sampleF(f, F, u, v) * 0.5 + sampleF(f2, F, u, v) * 0.3 + hash2(x, y, 4) * 0.2; const r = 110 + k * 120; return [r, r, r]; });
    const ctx = c.getContext('2d');
    scribble(ctx, size, 140, '#f0f0f0', 0.5, 6, 40, 1, 323);
    return makeTex(c, { srgb: false });
  },
  clouds(size = 1024) {
    const F = 256;
    const f1 = field(F, 3, 4, 251, 0.5), f2 = field(F, 9, 3, 252), cover = field(F, 2, 2, 253);
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = sampleF(f1, F, u, v) * 0.7 + sampleF(f2, F, u, v) * 0.3;
      const cv = sstep(0.45, 0.65, sampleF(cover, F, u, v));           // large clear areas between cloud banks
      const a = sstep(0.56, 0.74, n) * cv;
      const shade = 0.9 + 0.1 * sstep(0.6, 0.9, n);
      const i = (y * size + x) * 4;
      img.data[i] = 255 * shade; img.data[i + 1] = 255 * shade; img.data[i + 2] = 255; img.data[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = makeTex(c);
    return t;
  },
  flagRed() { return flagTex(128, '#c62828'); },
  flagBlue() { return flagTex(128, '#1565c0'); },
  parachute(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#e8e4dc' : '#c0392b'; ctx.fillRect(i * size / 8, 0, size / 8, size); }
    speckle(ctx, size, 200, '#000000', 0.08, 1, 3, 221);
    return makeTex(c);
  },
  paintNormal() {
    const R = 256, F = 128;
    const f = field(F, 12, 3, 231);
    const H = heightCanvas(R, (u, v, x, y) => sampleF(f, F, u, v) * 0.6 + hash2(x, y, 5) * 0.4);
    return makeTex(normalFromHeight(H, R, 0.5), { srgb: false });
  },
};

/** Alpha-cutout grass blade cluster. */
function bladeTex(size, colors, dark) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 44; i++) {
    const x0 = size * (0.08 + hash2(i, 1, 301) * 0.84);
    const h = size * (0.3 + hash2(i, 2, 301) * 0.55);
    const lean = (hash2(i, 3, 301) - 0.5) * size * 0.5;
    const w = size * (0.035 + hash2(i, 4, 301) * 0.045);
    const col = colors[i % colors.length];
    const g = ctx.createLinearGradient(0, size, 0, size - h);
    g.addColorStop(0, dark); g.addColorStop(0.55, col); g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - w, size);
    ctx.bezierCurveTo(x0 - w * 0.9 + lean * 0.2, size - h * 0.5, x0 - w * 0.25 + lean * 0.8, size - h * 0.95, x0 + lean, size - h);
    ctx.bezierCurveTo(x0 + w * 0.25 + lean * 0.8, size - h * 0.95, x0 + w * 0.9 + lean * 0.2, size - h * 0.5, x0 + w, size);
    ctx.closePath(); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

function flagTex(size, color) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, size * 0.42, size, size * 0.16);
  ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.1, 0, Math.PI * 2); ctx.fill();
  speckle(ctx, size, 150, '#000000', 0.08, 1, 3, 241);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export const Textures = {
  /** Ground set { map, normal } for 'grass' | 'dirt' | 'rock' | 'sand' | 'snow' | 'asphalt'. */
  ground(name) {
    const file = Assets.set(GROUND_SETS[name] || name);
    if (file) return file;
    const key = 'g:' + name;
    if (!cache.has(key)) { const b = groundBuilders[name] || groundBuilders.grass; cache.set(key, b()); }
    return cache.get(key);
  },
  /** Prop set { map, normal }. */
  prop(name) {
    const file = Assets.set(PROP_SETS[name] || name);
    if (file) return file;
    const key = 'p:' + name;
    if (!cache.has(key)) { const b = propBuilders[name] || propBuilders.concrete; cache.set(key, b()); }
    return cache.get(key);
  },
  /** Full PBR material for a prop set (file based maps with every channel, procedural fallback). */
  material(name, extra = {}) {
    const file = PROP_SETS[name] || GROUND_SETS[name] || name;
    if (Assets.has(file)) return Assets.material(file, extra);
    const t = this.prop(name);
    const { physical, normalScale, ...rest } = extra;
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.85, metalness: 0.05, ...rest });
  },
  /** Misc single textures (particles, flags, blobs...). */
  get(name) {
    if (cache.has(name)) return cache.get(name);
    const b = miscBuilders[name];
    if (!b) throw new Error('unknown texture ' + name);
    const t = b();
    cache.set(name, t);
    return t;
  },
  /** Paint pattern texture (null for solid paints). */
  paint(paint) {
    if (!paint || paint.pattern === 'solid') return null;
    const key = 'paint:' + paint.id;
    if (cache.has(key)) return cache.get(key);
    const size = 256;
    const c = canvas(size), ctx = c.getContext('2d');
    const hex = (col) => '#' + col.toString(16).padStart(6, '0');
    const c1 = hex(paint.color), c2 = hex(paint.color2 ?? 0x222222);
    ctx.fillStyle = c1; ctx.fillRect(0, 0, size, size);
    if (paint.pattern === 'stripes') {
      ctx.fillStyle = c2;
      for (let x = -size; x < size * 2; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 20 + size, size); ctx.lineTo(x + size, size); ctx.closePath(); ctx.fill(); }
    } else if (paint.pattern === 'camo') {
      const f1 = field(128, 4, 3, 300 + paint.id.length), f2 = field(128, 9, 2, 400 + paint.id.length);
      const img = ctx.getImageData(0, 0, size, size);
      const a = rgb(paint.color), b = rgb(paint.color2 ?? 0x222222);
      const mid = mul(mix(a, b, 0.5), 0.9);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const n = sampleF(f1, 128, x / size, y / size), n2 = sampleF(f2, 128, x / size, y / size);
        const col = n > 0.56 ? b : n2 > 0.6 ? mid : a;
        const i = (y * size + x) * 4;
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    } else if (paint.pattern === 'flames') {
      ctx.fillStyle = c2; ctx.fillRect(0, 0, size, size);
      const f = field(64, 3, 2, 500);
      const g = ctx.createLinearGradient(0, size, 0, 0);
      g.addColorStop(0, c1); g.addColorStop(0.55, c1); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 8) { const h = size * (0.35 + 0.4 * sampleF(f, 64, x / size, 0)); ctx.lineTo(x, size - h); }
      ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,120,0.55)';
      ctx.beginPath(); ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 8) { const h = size * (0.15 + 0.25 * sampleF(f, 64, x / size + 0.3, 0.5)); ctx.lineTo(x, size - h); }
      ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
    } else if (paint.pattern === 'carbon') {
      for (let y = 0; y < size; y += 8) for (let x = 0; x < size; x += 8) {
        const odd = ((x / 8 + y / 8) | 0) % 2;
        ctx.fillStyle = odd ? c1 : c2; ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, 8, 3);
      }
    }
    speckle(ctx, size, 400, '#000000', 0.06, 1, 3, 600);
    const t = makeTex(c);
    cache.set(key, t);
    return t;
  },
};
