// Procedural canvas textures (no external assets needed).
import * as THREE from 'three';
import { hash2, fbm } from '/shared/noise.mjs';

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
function rgb(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }

/** Fill canvas with per-pixel noise between two colours. */
function noiseFill(ctx, size, c1, c2, scale, seed, octaves = 3, contrast = 1) {
  const img = ctx.createImageData(size, size);
  const a = rgb(c1), b = rgb(c2);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable: sample on a torus by blending 4 offsets
      let n = fbm(x / scale, y / scale, seed, octaves);
      n = Math.min(1, Math.max(0, (n - 0.5) * contrast + 0.5));
      const i = (y * size + x) * 4;
      d[i] = a[0] + (b[0] - a[0]) * n;
      d[i + 1] = a[1] + (b[1] - a[1]) * n;
      d[i + 2] = a[2] + (b[2] - a[2]) * n;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function makeTexture(c, { repeat = 1, srgb = true, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (nearest) { t.magFilter = THREE.NearestFilter; }
  t.needsUpdate = true;
  return t;
}

function scribble(ctx, size, n, color, alpha, lenMin, lenMax, width, seed) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, seed) * size, y = hash2(i, 2, seed) * size;
    const a = hash2(i, 3, seed) * Math.PI * 2;
    const l = lenMin + hash2(i, 4, seed) * (lenMax - lenMin);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function speckle(ctx, size, n, color, alpha, rMin, rMax, seed) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 11, seed) * size, y = hash2(i, 12, seed) * size;
    const r = rMin + hash2(i, 13, seed) * (rMax - rMin);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const builders = {
  grass(size = 512) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x4f7a2e, 0x7faa48, 38, 1, 4, 1.3);
    scribble(ctx, size, 2600, '#355a1f', 0.35, 4, 12, 1.2, 2);
    scribble(ctx, size, 1800, '#9ccc5a', 0.25, 3, 9, 1, 3);
    speckle(ctx, size, 200, '#6b5a3a', 0.25, 2, 6, 4);
    return makeTexture(c);
  },
  sand(size = 512) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0xc9b27d, 0xe3d2a3, 46, 5, 4, 1.1);
    scribble(ctx, size, 900, '#b89e68', 0.22, 20, 60, 1.5, 6);
    speckle(ctx, size, 2500, '#a88f5c', 0.18, 0.6, 1.6, 7);
    return makeTexture(c);
  },
  snow(size = 512) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0xdfe8f0, 0xffffff, 40, 8, 4, 0.9);
    speckle(ctx, size, 1500, '#b9c7d6', 0.18, 0.8, 2.5, 9);
    scribble(ctx, size, 300, '#c7d4e2', 0.2, 10, 40, 1, 10);
    return makeTexture(c);
  },
  asphalt(size = 512) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x3a3d42, 0x55595f, 24, 12, 4, 1.4);
    speckle(ctx, size, 4000, '#2a2c30', 0.3, 0.5, 1.8, 13);
    scribble(ctx, size, 60, '#26282c', 0.5, 40, 140, 1.5, 14);
    return makeTexture(c);
  },
  concrete(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x8c8f93, 0xa9acb0, 30, 20, 4, 1.1);
    speckle(ctx, size, 900, '#6f7276', 0.25, 0.5, 2, 21);
    scribble(ctx, size, 24, '#6a6d71', 0.35, 30, 90, 1, 22);
    return makeTexture(c);
  },
  bunker(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x5f6368, 0x7c8186, 26, 30, 4, 1.2);
    speckle(ctx, size, 1200, '#4a4e52', 0.3, 0.5, 2.2, 31);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, size * 0.42, size, size * 0.08);
    return makeTexture(c);
  },
  metal(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x6a7078, 0x8a9199, 20, 40, 3, 1.0);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * size / 4, 0); ctx.lineTo(i * size / 4, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      for (const [dx, dy] of [[8, 8], [size / 4 - 8, 8], [8, size / 4 - 8], [size / 4 - 8, size / 4 - 8]]) {
        ctx.beginPath(); ctx.arc(i * size / 4 + dx, j * size / 4 + dy, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    return makeTexture(c);
  },
  crate(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x8a5a2b, 0xb98448, 18, 50, 3, 1.0);
    scribble(ctx, size, 400, '#6b4420', 0.3, 20, 80, 1, 51);
    ctx.strokeStyle = 'rgba(40,20,5,0.8)'; ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, size - 12, size - 12);
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(size - 10, size - 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size - 10, 10); ctx.lineTo(10, size - 10); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, i * size / 5); ctx.lineTo(size, i * size / 5); ctx.stroke(); }
    return makeTexture(c);
  },
  container(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0xb8b8b8, 0xd8d8d8, 30, 60, 3, 0.8);
    // corrugation
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, 0, 5, size);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 8, 0, 3, size);
    }
    speckle(ctx, size, 300, '#5a4a3a', 0.25, 1, 4, 61);
    return makeTexture(c);
  },
  brick(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#6e6a66'; ctx.fillRect(0, 0, size, size);
    const bh = 16, bw = 32;
    for (let y = 0, row = 0; y < size; y += bh, row++) {
      for (let x = -(row % 2) * bw / 2; x < size; x += bw) {
        const n = hash2(x, y, 70);
        ctx.fillStyle = `rgb(${120 + n * 40 | 0},${60 + n * 25 | 0},${45 + n * 20 | 0})`;
        ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    return makeTexture(c);
  },
  building(size = 512) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x7d8188, 0x9a9ea5, 40, 80, 3, 0.9);
    const cols = 6, rows = 6, cw = size / cols, rh = size / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lit = hash2(i, j, 81) < 0.25;
      ctx.fillStyle = lit ? '#ffe9a8' : '#1c2733';
      ctx.fillRect(i * cw + cw * 0.22, j * rh + rh * 0.2, cw * 0.56, rh * 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(i * cw + cw * 0.22, j * rh + rh * 0.2, cw * 0.56, rh * 0.08);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(i * cw + cw * 0.2, j * rh + rh * 0.68, cw * 0.6, rh * 0.04);
    }
    return makeTexture(c);
  },
  barrier(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x9c9fa3, 0xb8bbbf, 24, 90, 3, 1.0);
    ctx.fillStyle = 'rgba(200,30,30,0.85)';
    for (let x = -size; x < size * 2; x += 64) { ctx.beginPath(); ctx.moveTo(x, size); ctx.lineTo(x + 32, size); ctx.lineTo(x + 64, 0); ctx.lineTo(x + 32, 0); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, size, 8); ctx.fillRect(0, size - 8, size, 8);
    return makeTexture(c);
  },
  rock(size = 256) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x5e5f61, 0x8c8d90, 22, 100, 4, 1.4);
    scribble(ctx, size, 120, '#404244', 0.4, 10, 50, 1.2, 101);
    return makeTexture(c);
  },
  bark(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x4a3522, 0x6e5238, 10, 110, 3, 1.2);
    for (let x = 0; x < size; x += 6) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, 0, 2, size); }
    return makeTexture(c);
  },
  leaves(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x2f6b2a, 0x5da646, 9, 120, 3, 1.4);
    speckle(ctx, size, 400, '#1f4a1c', 0.4, 1, 3, 121);
    return makeTexture(c);
  },
  pine(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    noiseFill(ctx, size, 0x24482a, 0x3f7a45, 7, 130, 3, 1.4);
    speckle(ctx, size, 300, '#dfe8f0', 0.5, 1, 3, 131);
    return makeTexture(c);
  },
  treads(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2c2e'; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 16) { ctx.fillStyle = '#4a4d50'; ctx.fillRect(0, y, size, 7); ctx.fillStyle = '#1a1b1c'; ctx.fillRect(0, y + 7, size, 2); }
    return makeTexture(c);
  },
  flagRed(size = 128) { return flagTex(size, '#e53935'); },
  flagBlue(size = 128) { return flagTex(size, '#1e88e5'); },
  parachute(size = 128) {
    const c = canvas(size), ctx = c.getContext('2d');
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f5f5f5' : '#ff7043'; ctx.fillRect(i * size / 8, 0, size / 8, size); }
    return makeTexture(c);
  },
  particle(size = 64) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  smoke(size = 64) {
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) { const x = (i / 4) % size, y = (i / 4 / size) | 0; img.data[i + 3] *= 0.6 + 0.4 * fbm(x / 9, y / 9, 140, 2); }
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
};

function flagTex(size, color) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, size * 0.42, size, size * 0.16);
  ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.1, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export const Textures = {
  get(name) {
    if (cache.has(name)) return cache.get(name);
    const b = builders[name];
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
    const c1 = hex(paint.color), c2 = hex(paint.color2 ?? 0x222222);
    ctx.fillStyle = c1; ctx.fillRect(0, 0, size, size);
    if (paint.pattern === 'stripes') {
      ctx.fillStyle = c2;
      for (let x = -size; x < size * 2; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 20 + size, size); ctx.lineTo(x + size, size); ctx.closePath(); ctx.fill(); }
    } else if (paint.pattern === 'camo') {
      const img = ctx.getImageData(0, 0, size, size);
      const a = rgb(paint.color), b = rgb(paint.color2 ?? 0x222222);
      const mid = [(a[0] + b[0]) / 2 * 0.9, (a[1] + b[1]) / 2 * 0.9, (a[2] + b[2]) / 2 * 0.9];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const n = fbm(x / 34, y / 34, 200 + paint.id.length, 3);
        const n2 = fbm(x / 17 + 9, y / 17 + 3, 300, 2);
        const col = n > 0.56 ? b : n2 > 0.6 ? mid : a;
        const i = (y * size + x) * 4;
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    } else if (paint.pattern === 'flames') {
      ctx.fillStyle = c2; ctx.fillRect(0, 0, size, size);
      const g = ctx.createLinearGradient(0, size, 0, 0);
      g.addColorStop(0, c1); g.addColorStop(0.55, c1); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 8) { const h = size * (0.35 + 0.4 * fbm(x / 20, 0, 400, 2)); ctx.lineTo(x, size - h); }
      ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,120,0.55)';
      ctx.beginPath(); ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 8) { const h = size * (0.15 + 0.25 * fbm(x / 16 + 5, 0, 401, 2)); ctx.lineTo(x, size - h); }
      ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
    } else if (paint.pattern === 'carbon') {
      for (let y = 0; y < size; y += 8) for (let x = 0; x < size; x += 8) {
        const odd = ((x / 8 + y / 8) | 0) % 2;
        ctx.fillStyle = odd ? c1 : c2; ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, 8, 3);
      }
    }
    const t = makeTexture(c, { repeat: 1 });
    cache.set(key, t);
    return t;
  },
};
