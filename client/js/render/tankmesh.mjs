// Parametric tank models: every hull and turret is built from primitives, painted with the garage paint.
import * as THREE from 'three';
import { getHull, getTurret, getPaint } from '/shared/items.mjs';
import { Textures } from './textures.mjs';

const MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, metalness: 0.75 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.85 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.95, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.8 }),
  track: () => new THREE.MeshStandardMaterial({ map: Textures.get('treads').clone(), roughness: 0.9, metalness: 0.2 }),
};
const emissiveMats = new Map();
function emissive(color) {
  if (!emissiveMats.has(color)) emissiveMats.set(color, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 }));
  return emissiveMats.get(color);
}
const paintMats = new Map();
export function paintMaterial(paintId) {
  const paint = getPaint(paintId);
  if (!paintMats.has(paint.id)) {
    const map = Textures.paint(paint);
    paintMats.set(paint.id, new THREE.MeshStandardMaterial({ color: map ? 0xffffff : paint.color, map, roughness: 0.55, metalness: 0.35 }));
  }
  return paintMats.get(paint.id);
}

/** Assign box-projected UVs so patterned paints tile over any shape. */
function boxUV(geo, scale = 1.5) {
  geo.computeVertexNormals();
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

/** Convex prism: bottom rect (bw x bl) at y=0, top rect (tw x tl) at y=h shifted by tz along z. Flat shaded. */
function prism(bw, bl, tw, tl, h, tz = 0) {
  const b = [[-bw / 2, 0, -bl / 2], [bw / 2, 0, -bl / 2], [bw / 2, 0, bl / 2], [-bw / 2, 0, bl / 2]];
  const t = [[-tw / 2, h, -tl / 2 + tz], [tw / 2, h, -tl / 2 + tz], [tw / 2, h, tl / 2 + tz], [-tw / 2, h, tl / 2 + tz]];
  const quads = [
    [t[0], t[1], t[2], t[3]],            // top
    [b[3], b[2], b[1], b[0]],            // bottom
    [b[2], b[3], t[3], t[2]],            // front (+z)
    [b[0], b[1], t[1], t[0]],            // back (-z)
    [b[1], b[2], t[2], t[1]],            // right (+x)
    [b[3], b[0], t[0], t[3]],            // left (-x)
  ];
  const verts = [];
  for (const [a, b2, c, d] of quads) verts.push(...a, ...b2, ...c, ...a, ...c, ...d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return boxUV(geo);
}

function box(w, h, l, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, l)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(rTop, rBot, h, seg)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
/** Barrel along +z from z0 to z1 at height y, x offset. */
function barrel(r, z0, z1, y, x = 0, mat = MAT.gun, rTip = null) {
  const len = z1 - z0;
  const g = new THREE.CylinderGeometry(rTip ?? r, r, len, 12);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z0 + len / 2);
  m.castShadow = true;
  return m;
}

const HULL_SHAPES = {
  wasp:     { lower: 0.5, upperW: 0.8, upperL: 0.86, upperH: 0.5, front: 0.7, back: 0.2, trackW: 0.17, wheels: 5 },
  hornet:   { lower: 0.5, upperW: 0.84, upperL: 0.88, upperH: 0.5, front: 0.6, back: 0.15, trackW: 0.18, wheels: 5, fins: true },
  hunter:   { lower: 0.5, upperW: 0.9, upperL: 0.9, upperH: 0.5, front: 0.4, back: 0.12, trackW: 0.19, wheels: 6 },
  viking:   { lower: 0.5, upperW: 0.95, upperL: 0.92, upperH: 0.5, front: 0.35, back: 0.1, trackW: 0.2, wheels: 6, skirts: true },
  dictator: { lower: 0.45, upperW: 0.86, upperL: 0.85, upperH: 0.55, front: 0.5, back: 0.2, trackW: 0.2, wheels: 6, mount: true },
  titan:    { lower: 0.5, upperW: 0.95, upperL: 0.95, upperH: 0.5, front: 0.3, back: 0.08, trackW: 0.22, wheels: 7, skirts: true, plate: true },
  mammoth:  { lower: 0.5, upperW: 0.97, upperL: 0.96, upperH: 0.5, front: 0.25, back: 0.06, trackW: 0.24, wheels: 8, skirts: true, plate: true, double: true },
};

function buildHull(hullId, paintMat) {
  const hull = getHull(hullId);
  const [w, h, l] = hull.size;
  const s = HULL_SHAPES[hullId] || HULL_SHAPES.hunter;
  const g = new THREE.Group();
  const paintMeshes = [];
  const y0 = -h / 2;
  // lower hull
  const innerW = w - 2 * s.trackW * w;
  const lower = box(innerW, h * s.lower, l * 0.98, paintMat, 0, y0 + h * s.lower / 2, 0);
  g.add(lower); paintMeshes.push(lower);
  // upper hull (sloped front)
  const upW = innerW * (s.upperW + 0.15), upL = l * s.upperL;
  const upper = new THREE.Mesh(prism(upW, upL, upW * 0.8, upL - s.front - s.back, h * s.upperH, -(s.front - s.back) / 2), paintMat);
  upper.position.set(0, y0 + h * s.lower, 0);
  upper.castShadow = true;
  g.add(upper); paintMeshes.push(upper);
  if (s.double) {
    const top = new THREE.Mesh(prism(upW * 0.7, upL * 0.6, upW * 0.6, upL * 0.5, h * 0.18, 0), paintMat);
    top.position.set(0, y0 + h * (s.lower + s.upperH), -l * 0.05);
    g.add(top); paintMeshes.push(top);
  }
  if (s.mount) {
    const m = cyl(w * 0.3, w * 0.34, h * 0.25, paintMat, 0, y0 + h * (s.lower + s.upperH) + h * 0.12, 0, 18);
    g.add(m); paintMeshes.push(m);
  }
  if (s.plate) {
    const plate = box(innerW * 0.9, h * 0.35, 0.12, MAT.dark, 0, y0 + h * 0.45, l / 2 - 0.02);
    g.add(plate);
  }
  if (s.fins) {
    g.add(box(0.08, h * 0.3, l * 0.3, MAT.dark, -innerW / 2 + 0.05, y0 + h * 0.85, -l * 0.3));
    g.add(box(0.08, h * 0.3, l * 0.3, MAT.dark, innerW / 2 - 0.05, y0 + h * 0.85, -l * 0.3));
  }
  // tracks
  const tw = s.trackW * w, th = h * 0.8;
  const trackMats = [];
  for (const side of [-1, 1]) {
    const tm = MAT.track();
    tm.map.repeat.set(1, l / 0.5);
    trackMats.push(tm);
    const t = box(tw, th, l * 1.04, tm, side * (w / 2 - tw / 2), y0 + th / 2, 0);
    g.add(t);
    if (s.skirts) {
      const skirt = box(0.06, th * 0.55, l * 0.95, paintMat, side * (w / 2 + 0.02), y0 + th * 0.72, 0);
      g.add(skirt); paintMeshes.push(skirt);
    }
    // road wheels
    const n = s.wheels, r = th * 0.32;
    for (let i = 0; i < n; i++) {
      const z = -l * 0.42 + (i / (n - 1)) * l * 0.84;
      const wh = cyl(r, r, 0.1, MAT.rubber, side * (w / 2 + 0.01), y0 + r * 1.05, z, 12);
      wh.rotation.z = Math.PI / 2;
      g.add(wh);
      const hub = cyl(r * 0.45, r * 0.45, 0.12, MAT.dark, side * (w / 2 + 0.03), y0 + r * 1.05, z, 10);
      hub.rotation.z = Math.PI / 2;
      g.add(hub);
    }
  }
  // headlights + exhaust
  g.add(box(0.16, 0.1, 0.06, emissive(0xfff2c0), innerW * 0.3, y0 + h * 0.55, l / 2 * 0.99));
  g.add(box(0.16, 0.1, 0.06, emissive(0xfff2c0), -innerW * 0.3, y0 + h * 0.55, l / 2 * 0.99));
  const exhaust = cyl(0.07, 0.07, 0.3, MAT.dark, -innerW * 0.35, y0 + h * 0.75, -l / 2 - 0.1, 8);
  exhaust.rotation.x = Math.PI / 2;
  g.add(exhaust);
  // antenna
  const ant = cyl(0.015, 0.02, 1.1, MAT.dark, innerW * 0.38, y0 + h + 0.4, -l * 0.35, 6);
  g.add(ant);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), emissive(0x9bd33a));
  tip.position.set(innerW * 0.38, y0 + h + 0.95, -l * 0.35);
  g.add(tip);
  return { group: g, paintMeshes, trackMats, teamTip: tip, size: [w, h, l], exhaust };
}

function buildTurret(turretId, hullSize, paintMat) {
  const t = getTurret(turretId);
  const [w, h, l] = hullSize;
  const g = new THREE.Group();
  const paintMeshes = [];
  const bl = l / 2 + 0.9;      // muzzle z (matches server)
  const by = 0.42;             // barrel height (matches server)
  const em = emissive(t.color);
  const barrels = [];
  const add = (m, paint = false) => { g.add(m); if (paint) paintMeshes.push(m); return m; };
  const bw = Math.min(w * 0.55, 1.6);
  switch (turretId) {
    case 'smoky': {
      add(new THREE.Mesh(prism(bw, bw * 1.1, bw * 0.85, bw * 0.9, 0.5, -0.05), paintMat), true);
      barrels.push(add(barrel(0.09, bw * 0.4, bl, by, 0)));
      add(cyl(0.13, 0.13, 0.3, MAT.gun, 0, by, bl - 0.2)).rotation.x = Math.PI / 2;
      break;
    }
    case 'firebird': case 'freeze': {
      const col = turretId === 'firebird' ? 0xd9531e : 0x2fa8d9;
      add(cyl(bw * 0.45, bw * 0.5, 0.5, paintMat, 0, 0.25, 0, 18), true);
      for (const side of [-1, 1]) { const tank = cyl(0.17, 0.17, bw * 0.9, new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.6 }), side * bw * 0.42, 0.45, -0.1, 12); tank.rotation.x = Math.PI / 2; add(tank); }
      barrels.push(add(barrel(0.1, bw * 0.3, bl - 0.25, by)));
      add(barrel(0.16, bl - 0.3, bl, by, 0, MAT.gun, 0.22));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), em)).position.set(0, by, bl - 0.05);
      break;
    }
    case 'twins': {
      add(box(bw, 0.42, bw * 0.9, paintMat, 0, 0.21, -0.05), true);
      for (const side of [-1, 1]) barrels.push(add(barrel(0.07, bw * 0.3, bl, by, side * 0.3)));
      add(box(bw * 0.3, 0.2, 0.4, MAT.dark, 0, 0.5, 0.1));
      break;
    }
    case 'isida': {
      add(cyl(bw * 0.4, bw * 0.5, 0.45, paintMat, 0, 0.22, 0, 18), true);
      add(new THREE.Mesh(new THREE.SphereGeometry(bw * 0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), paintMat), true).position.y = 0.45;
      for (const side of [-1, 1]) barrels.push(add(barrel(0.05, bw * 0.3, bl, by + 0.05, side * 0.2, em)));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), em)).position.set(0, by + 0.05, bl - 0.5);
      add(barrel(0.09, bw * 0.3, bl - 0.55, by - 0.05, 0));
      break;
    }
    case 'railgun': {
      add(new THREE.Mesh(prism(bw * 0.9, bw * 1.4, bw * 0.7, bw * 1.2, 0.46, 0), paintMat), true);
      barrels.push(add(barrel(0.08, bw * 0.5, bl, by)));
      for (let i = 0; i < 4; i++) { const ring = cyl(0.15, 0.15, 0.08, em, 0, by, bw * 0.7 + i * (bl - bw * 0.7) / 4.3, 10); ring.rotation.x = Math.PI / 2; add(ring); }
      for (const side of [-1, 1]) add(box(0.05, 0.08, bw * 1.1, em, side * bw * 0.3, 0.5, -0.1));
      break;
    }
    case 'thunder': {
      add(new THREE.Mesh(prism(bw * 1.05, bw * 1.1, bw * 0.9, bw * 0.95, 0.55, -0.05), paintMat), true);
      barrels.push(add(barrel(0.15, bw * 0.4, bl - 0.3, by)));
      add(barrel(0.2, bl - 0.35, bl, by, 0, MAT.gun, 0.2));
      add(cyl(0.22, 0.22, 0.3, MAT.dark, 0, by, bw * 0.55)).rotation.x = Math.PI / 2;
      break;
    }
    case 'hammer': {
      add(box(bw, 0.5, bw * 0.95, paintMat, 0, 0.25, -0.05), true);
      barrels.push(add(barrel(0.17, bw * 0.3, bl, by, 0, MAT.gun, 0.19)));
      add(box(0.25, 0.3, 0.5, MAT.dark, bw * 0.45, 0.4, 0.1));
      add(box(bw * 0.4, 0.12, 0.12, MAT.dark, 0, by + 0.2, bl - 0.6));
      break;
    }
    case 'ricochet': {
      add(new THREE.Mesh(prism(bw * 1.1, bw, bw * 0.95, bw * 0.8, 0.4, 0), paintMat), true);
      barrels.push(add(barrel(0.12, bw * 0.3, bl - 0.1, by)));
      add(box(0.36, 0.08, 0.5, em, 0, by, bl - 0.3));
      add(box(0.5, 0.06, 0.06, em, 0, 0.42, 0));
      break;
    }
    case 'striker': {
      add(box(bw * 0.9, 0.42, bw * 0.9, paintMat, 0, 0.21, -0.1), true);
      const pod = box(bw * 0.95, 0.52, bw * 0.9, MAT.dark, 0, by + 0.05, bw * 0.3);
      add(pod);
      for (const sx of [-1, 1]) for (const sy of [0, 1]) {
        const tube = barrel(0.1, bw * 0.3, bl, by - 0.1 + sy * 0.26, sx * 0.24, MAT.gun);
        barrels.push(add(tube));
        add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 8), em)).position.set(sx * 0.24, by - 0.1 + sy * 0.26, bl - 0.02).rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'vulcan': {
      add(new THREE.Mesh(prism(bw, bw * 1.1, bw * 0.85, bw * 0.95, 0.48, -0.05), paintMat), true);
      const spin = new THREE.Group();
      spin.position.set(0, by, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = barrel(0.045, bw * 0.4, bl, 0, 0);
        b.position.x = Math.cos(a) * 0.13; b.position.y = Math.sin(a) * 0.13;
        spin.add(b); barrels.push(b);
      }
      g.add(spin);
      g.userData.spin = spin;
      const drum = cyl(0.3, 0.3, 0.5, MAT.dark, bw * 0.5, 0.35, -0.1, 14); drum.rotation.z = Math.PI / 2; add(drum);
      const ring = cyl(0.2, 0.2, 0.15, MAT.gun, 0, by, bl - 0.4, 12); ring.rotation.x = Math.PI / 2; add(ring);
      break;
    }
    case 'shaft': {
      add(new THREE.Mesh(prism(bw * 0.85, bw * 1.5, bw * 0.7, bw * 1.3, 0.42, 0), paintMat), true);
      barrels.push(add(barrel(0.065, bw * 0.4, bl + 0.4, by, 0, MAT.gun, 0.05)));
      const scope = cyl(0.07, 0.07, 0.6, MAT.dark, 0, by + 0.2, bw * 0.4, 8); scope.rotation.x = Math.PI / 2; add(scope);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), MAT.glass)).position.set(0, by + 0.2, bw * 0.4 - 0.3);
      add(box(0.06, 0.05, 0.6, em, 0, by - 0.1, bw * 0.9));
      break;
    }
    default: {
      add(box(bw, 0.45, bw, paintMat, 0, 0.22, 0), true);
      barrels.push(add(barrel(0.09, bw * 0.4, bl, by)));
    }
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, by, bl);
  g.add(muzzle);
  return { group: g, paintMeshes, barrels, muzzle };
}

/**
 * Build a complete tank. Hull local +Z is forward. Returns handles for animation.
 */
export function buildTank({ hull = 'wasp', turret = 'smoky', paint = 'green', team = 0 } = {}) {
  const group = new THREE.Group();
  const paintMat = paintMaterial(paint);
  const H = buildHull(hull, paintMat);
  const T = buildTurret(turret, H.size, paintMat);
  group.add(H.group);
  T.group.position.set(0, H.size[1] / 2, 0);
  H.group.add(T.group);
  const api = {
    group, hullGroup: H.group, turretGroup: T.group, muzzle: T.muzzle, barrels: T.barrels, spin: T.group.userData.spin || null,
    trackMats: H.trackMats, size: H.size, hull, turret, paint, team, recoil: 0,
    setPaint(paintId) {
      const m = paintMaterial(paintId);
      for (const mesh of [...H.paintMeshes, ...T.paintMeshes]) mesh.material = m;
      api.paint = paintId;
    },
    setTeam(t) {
      api.team = t;
      H.teamTip.material = emissive(t === 1 ? 0xff5252 : t === 2 ? 0x42a5f5 : 0x9bd33a);
    },
    /** Animate tracks and recoil. */
    animate(dt, speed, firing) {
      const off = speed * dt / 0.5;
      for (const tm of H.trackMats) { tm.map.offset.y -= off * 0.5; }
      if (api.recoil > 0) {
        api.recoil = Math.max(0, api.recoil - dt * 4);
      }
      const k = api.recoil * 0.25;
      for (const b of T.barrels) b.position.z = (b.userData.z0 ??= b.position.z) - k;
      if (api.spin) api.spin.rotation.z += dt * (firing ? 30 : 0);
    },
    kick() { api.recoil = 1; },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const tm of H.trackMats) { tm.map.dispose(); tm.dispose(); }
    },
  };
  api.setTeam(team);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return api;
}
