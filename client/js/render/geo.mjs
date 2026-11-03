// Geometry helpers shared by props and tank models.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Box-projected UVs (metres / scale) so tiled textures work on any shape. Keeps existing normals. */
export function boxUV(geo, scale = 1) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Rounded box with box-projected UVs. */
export function rbox(w, h, l, r = 0.06, seg = 2, uvScale = 1) {
  const radius = Math.min(r, Math.min(w, h, l) * 0.45);
  const g = new RoundedBoxGeometry(w, h, l, seg, radius);
  return boxUV(g, uvScale);
}

/** Convex prism: bottom rect (bw x bl) at y=0, top rect (tw x tl) at y=h shifted by tz. Flat shaded, box UVs. */
export function prism(bw, bl, tw, tl, h, tz = 0, uvScale = 1) {
  const b = [[-bw / 2, 0, -bl / 2], [bw / 2, 0, -bl / 2], [bw / 2, 0, bl / 2], [-bw / 2, 0, bl / 2]];
  const t = [[-tw / 2, h, -tl / 2 + tz], [tw / 2, h, -tl / 2 + tz], [tw / 2, h, tl / 2 + tz], [-tw / 2, h, tl / 2 + tz]];
  const quads = [[t[0], t[1], t[2], t[3]], [b[3], b[2], b[1], b[0]], [b[2], b[3], t[3], t[2]], [b[0], b[1], t[1], t[0]], [b[1], b[2], t[2], t[1]], [b[3], b[0], t[0], t[3]]];
  const verts = [];
  for (const [a, b2, c, d] of quads) verts.push(...a, ...b2, ...c, ...a, ...c, ...d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return boxUV(geo, uvScale);
}

/** Rounded rectangle path (for extrusions). */
export function roundedRect(path, x, y, w, h, r) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - r);
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y + h);
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r);
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}

/** Simple seeded RNG for deterministic scatter. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
