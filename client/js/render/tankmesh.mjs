// Parametric tank models with PBR paint, detailed running gear and turret hardware.
import * as THREE from 'three';
import { getHull, getTurret, getPaint } from '/shared/items.mjs';
import { Textures } from './textures.mjs';
import { rbox, boxUV, prism, roundedRect } from './geo.mjs';

const matCache = new Map();
function mat(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }
const MAT = {
  get dark() { return mat('dark', () => { const t = Textures.prop('steel'); return new THREE.MeshStandardMaterial({ color: 0x33373c, map: t.map, normalMap: t.normal, roughness: 0.62, metalness: 0.72 }); }); },
  get gun() { return mat('gun', () => { const t = Textures.prop('steel'); return new THREE.MeshStandardMaterial({ color: 0x4a4f55, map: t.map, normalMap: t.normal, roughness: 0.42, metalness: 0.88 }); }); },
  get rubber() { return mat('rubber', () => { const t = Textures.prop('rubber'); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.95, metalness: 0.05 }); }); },
  get glass() { return mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x8fc8ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.75, clearcoat: 1 })); },
  get canvas() { return mat('canvas', () => { const t = Textures.prop('rubber'); return new THREE.MeshStandardMaterial({ color: 0x6b6a52, normalMap: t.normal, roughness: 0.98, metalness: 0 }); }); },
  track() { const t = Textures.prop('treads'); return new THREE.MeshStandardMaterial({ map: t.map.clone(), normalMap: t.normal.clone(), roughness: 0.82, metalness: 0.55 }); },
};
const emissiveMats = new Map();
function emissive(color, intensity = 1.6) {
  const key = color + ':' + intensity;
  if (!emissiveMats.has(key)) emissiveMats.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.2 }));
  return emissiveMats.get(key);
}
const paintMats = new Map();
export function paintMaterial(paintId) {
  const paint = getPaint(paintId);
  if (!paintMats.has(paint.id)) {
    const map = Textures.paint(paint);
    paintMats.set(paint.id, new THREE.MeshPhysicalMaterial({
      color: map ? 0xffffff : paint.color, map, normalMap: Textures.get('paintNormal'), normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.55, metalness: 0.3, clearcoat: 0.18, clearcoatRoughness: 0.55,
    }));
  }
  return paintMats.get(paint.id);
}

function box(w, h, l, m, x = 0, y = 0, z = 0, r = 0.03) {
  const mesh = new THREE.Mesh(rbox(w, h, l, r, 1, 1), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}
function cyl(rTop, rBot, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const mesh = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(rTop, rBot, h, seg), 1), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}
/** Barrel along +z from z0 to z1 at height y. */
function barrel(r, z0, z1, y, x = 0, m = null, rTip = null) {
  const len = z1 - z0;
  const g = new THREE.CylinderGeometry(rTip ?? r, r, len, 14);
  g.rotateX(Math.PI / 2);
  boxUV(g, 0.5);
  const mesh = new THREE.Mesh(g, m || MAT.gun);
  mesh.position.set(x, y, z0 + len / 2);
  mesh.castShadow = true;
  return mesh;
}
function ring(r, tube, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 18), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}
/** Muzzle brake + thermal sleeve rings for a barrel ending at z1. */
function barrelDetails(g, r, z0, z1, y, x = 0) {
  const brake = cyl(r * 1.55, r * 1.55, 0.34, MAT.dark, x, y, z1 - 0.17, 12);
  brake.rotation.x = Math.PI / 2;
  g.add(brake);
  for (const side of [-1, 1]) g.add(box(0.1, r * 1.3, 0.14, MAT.gun, x + side * r * 1.5, y, z1 - 0.17, 0.01));
  const n = Math.max(2, Math.floor((z1 - z0) / 0.55));
  for (let i = 1; i < n; i++) {
    const rr = ring(r * 1.12, r * 0.2, MAT.dark, x, y, z0 + ((z1 - z0) * i) / n);
    g.add(rr);
  }
}

const HULL_SHAPES = {
  wasp:     { lower: 0.46, upperH: 0.5, front: 0.75, back: 0.2, trackW: 0.17, wheels: 5, glacis: 0.9 },
  hornet:   { lower: 0.48, upperH: 0.5, front: 0.65, back: 0.15, trackW: 0.18, wheels: 5, fins: true, glacis: 0.9 },
  hunter:   { lower: 0.5, upperH: 0.5, front: 0.45, back: 0.12, trackW: 0.19, wheels: 6, glacis: 0.85 },
  viking:   { lower: 0.5, upperH: 0.5, front: 0.4, back: 0.1, trackW: 0.2, wheels: 6, skirts: true, glacis: 0.85 },
  dictator: { lower: 0.45, upperH: 0.55, front: 0.55, back: 0.2, trackW: 0.2, wheels: 6, mount: true, glacis: 0.85 },
  titan:    { lower: 0.5, upperH: 0.5, front: 0.35, back: 0.08, trackW: 0.22, wheels: 7, skirts: true, plate: true, glacis: 0.8 },
  mammoth:  { lower: 0.5, upperH: 0.5, front: 0.3, back: 0.06, trackW: 0.24, wheels: 8, skirts: true, plate: true, double: true, glacis: 0.8 },
};

/** Continuous track belt: rounded rectangle ring extruded sideways. */
function trackBelt(len, height, width, radius, m) {
  const t = 0.1;
  const shape = new THREE.Shape();
  roundedRect(shape, -len / 2, 0, len, height, radius);
  const hole = new THREE.Path();
  roundedRect(hole, -len / 2 + t, t, len - 2 * t, height - 2 * t, Math.max(0.05, radius - t));
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 10 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-width / 2, 0, 0);
  geo.computeVertexNormals();
  boxUV(geo, 0.5);
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  return mesh;
}

function buildHull(hullId, paintMat) {
  const hull = getHull(hullId);
  const [w, h, l] = hull.size;
  const s = HULL_SHAPES[hullId] || HULL_SHAPES.hunter;
  const g = new THREE.Group();
  const paintMeshes = [];
  const y0 = -h / 2;
  const tw = s.trackW * w;
  const bw = w - 2 * tw - 0.08;
  const paint = (mesh) => { g.add(mesh); paintMeshes.push(mesh); return mesh; };

  // lower hull
  paint(box(bw, h * s.lower, l * 0.96, paintMat, 0, y0 + h * s.lower / 2, 0, 0.05));
  // upper hull with sloped glacis, slightly overhanging the tracks (sponsons)
  const upW = w * 0.98, upL = l * 0.92;
  const upper = new THREE.Mesh(prism(upW, upL, upW * s.glacis, upL - s.front - s.back, h * s.upperH, -(s.front - s.back) / 2, 1), paintMat);
  upper.position.set(0, y0 + h * s.lower, 0);
  upper.castShadow = true;
  paint(upper);
  const topY = y0 + h * (s.lower + s.upperH);
  if (s.double) paint(new THREE.Mesh(prism(upW * 0.7, upL * 0.6, upW * 0.62, upL * 0.5, h * 0.16, 0, 1), paintMat)).position.set(0, topY, -l * 0.05);
  if (s.mount) paint(cyl(w * 0.3, w * 0.34, h * 0.25, paintMat, 0, topY + h * 0.12, 0, 22));
  if (s.plate) {
    const plate = box(bw * 0.9, h * 0.32, 0.1, MAT.dark, 0, y0 + h * 0.42, l / 2 - 0.03, 0.02);
    g.add(plate);
    for (let i = 0; i < 4; i++) g.add(box(0.22, 0.08, 0.06, MAT.dark, -bw * 0.35 + i * bw * 0.23, y0 + h * 0.6, l / 2 + 0.03, 0.01));
  }
  if (s.fins) for (const side of [-1, 1]) g.add(box(0.06, h * 0.3, l * 0.3, MAT.dark, side * (bw / 2 - 0.04), topY - h * 0.05, -l * 0.3, 0.01));
  // engine deck grilles
  for (let i = 0; i < 3; i++) g.add(box(bw * 0.7, 0.03, 0.16, MAT.dark, 0, topY + 0.015, -l * 0.42 + i * 0.26, 0.005));
  // hatch on the hull front
  g.add(cyl(0.22, 0.22, 0.06, MAT.dark, -bw * 0.25, topY + 0.03, l * 0.18, 14));
  // tow hooks + spare track links + jerrycans
  for (const side of [-1, 1]) {
    g.add(ring(0.08, 0.025, MAT.dark, side * bw * 0.35, y0 + h * 0.35, l / 2 + 0.02));
    g.add(box(0.22, 0.12, 0.28, MAT.dark, side * (bw / 2 - 0.2), topY - h * 0.1, -l * 0.46 + 0.02, 0.02));
  }
  g.add(box(0.5, 0.12, 0.1, MAT.dark, bw * 0.15, y0 + h * 0.7, l / 2 - 0.3, 0.01));
  // headlights
  for (const side of [-1, 1]) {
    const housing = cyl(0.07, 0.07, 0.06, MAT.dark, side * bw * 0.33, y0 + h * 0.6, l / 2 * 0.985, 10);
    housing.rotation.x = Math.PI / 2;
    g.add(housing);
    const lens = cyl(0.05, 0.05, 0.02, emissive(0xfff2c0, 1.2), side * bw * 0.33, y0 + h * 0.6, l / 2 * 0.985 + 0.03, 10);
    lens.rotation.x = Math.PI / 2;
    g.add(lens);
  }
  // exhausts
  for (const side of [-1, 1]) {
    const ex = cyl(0.06, 0.06, 0.34, MAT.dark, side * bw * 0.3, y0 + h * 0.72, -l / 2 - 0.1, 10);
    ex.rotation.x = Math.PI / 2;
    g.add(ex);
  }
  // antenna
  g.add(cyl(0.012, 0.018, 1.2, MAT.dark, bw * 0.4, topY + 0.6, -l * 0.3, 6));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), emissive(0x9bd33a));
  tip.position.set(bw * 0.4, topY + 1.2, -l * 0.3);
  g.add(tip);

  // running gear
  const trackMats = [];
  const wheels = [];
  const rw = h * 0.3;
  const beltH = rw * 2.35, beltLen = l * 1.02;
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - tw / 2);
    const tm = MAT.track();
    trackMats.push(tm);
    const belt = trackBelt(beltLen, beltH, tw * 0.86, rw * 1.05, tm);
    belt.position.set(x, y0 + 0.02, 0);
    g.add(belt);
    const n = s.wheels;
    for (let i = 0; i < n; i++) {
      const z = -beltLen * 0.36 + (i / (n - 1)) * beltLen * 0.72;
      const wh = cyl(rw * 0.92, rw * 0.92, tw * 0.6, MAT.rubber, x, y0 + rw + 0.08, z, 18);
      wh.rotation.z = Math.PI / 2;
      g.add(wh); wheels.push(wh);
      const hub = cyl(rw * 0.5, rw * 0.5, tw * 0.66, MAT.dark, x, y0 + rw + 0.08, z, 12);
      hub.rotation.z = Math.PI / 2;
      g.add(hub); wheels.push(hub);
    }
    for (const z of [-beltLen / 2 + rw * 1.05, beltLen / 2 - rw * 1.05]) {
      const sp = cyl(rw * 0.78, rw * 0.78, tw * 0.5, MAT.dark, x, y0 + 0.02 + beltH - rw * 1.05, z, 12);
      sp.rotation.z = Math.PI / 2;
      g.add(sp); wheels.push(sp);
    }
    // fender over the track
    paint(box(tw + 0.06, 0.05, beltLen * 0.98, paintMat, x, y0 + 0.02 + beltH + 0.04, 0, 0.01));
    if (s.skirts) paint(box(0.05, beltH * 0.55, beltLen * 0.92, paintMat, side * (w / 2 + 0.02), y0 + 0.02 + beltH * 0.72, 0, 0.01));
  }
  return { group: g, paintMeshes, trackMats, wheels, teamTip: tip, size: [w, h, l], rw };
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
  const add = (m, isPaint = false) => { g.add(m); if (isPaint) paintMeshes.push(m); return m; };
  const bw = Math.min(w * 0.56, 1.6);
  const turretBody = (W, L, H, slope = 0.15) => {
    const body = new THREE.Mesh(prism(W, L, W * 0.86, L - slope, H, -slope / 2, 1), paintMat);
    body.castShadow = true;
    return body;
  };
  const hatch = (x = -bw * 0.25, z = -bw * 0.2, y = 0.5) => { add(cyl(0.2, 0.2, 0.07, MAT.dark, x, y, z, 14)); add(cyl(0.16, 0.16, 0.05, paintMat, x, y + 0.04, z, 14), true); };
  const launchers = (z = -0.05, y = 0.3) => { for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { const c = cyl(0.035, 0.035, 0.18, MAT.dark, side * (bw / 2 + 0.03), y, z + i * 0.09 - 0.09, 8); c.rotation.z = side * 0.5; c.rotation.x = -0.5; add(c); } };
  const mantlet = (r, z) => { const m = cyl(r, r * 1.08, 0.32, MAT.dark, 0, by, z, 14); m.rotation.x = Math.PI / 2; add(m); };
  switch (turretId) {
    case 'smoky': {
      add(turretBody(bw, bw * 1.15, 0.52), true);
      mantlet(0.22, bw * 0.5);
      barrels.push(add(barrel(0.085, bw * 0.4, bl, by)));
      barrelDetails(g, 0.085, bw * 0.75, bl, by);
      hatch(); launchers();
      break;
    }
    case 'firebird': case 'freeze': {
      const col = turretId === 'firebird' ? 0xb8431a : 0x2a8fbf;
      add(cyl(bw * 0.46, bw * 0.52, 0.52, paintMat, 0, 0.26, 0, 22), true);
      const tankMat = mat('tank' + col, () => { const s = Textures.prop('metal'); return new THREE.MeshStandardMaterial({ color: col, map: s.map, normalMap: s.normal, roughness: 0.45, metalness: 0.6 }); });
      for (const side of [-1, 1]) { const tank = cyl(0.17, 0.17, bw * 0.95, tankMat, side * bw * 0.42, 0.46, -0.1, 14); tank.rotation.x = Math.PI / 2; add(tank); add(ring(0.18, 0.025, MAT.dark, side * bw * 0.42, 0.46, -0.1 - bw * 0.3)); add(ring(0.18, 0.025, MAT.dark, side * bw * 0.42, 0.46, -0.1 + bw * 0.3)); }
      barrels.push(add(barrel(0.1, bw * 0.3, bl - 0.25, by)));
      add(barrel(0.16, bl - 0.3, bl, by, 0, MAT.gun, 0.23));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), em)).position.set(0, by, bl - 0.05);
      add(box(0.5, 0.08, 0.5, MAT.dark, 0, 0.55, -0.1, 0.01));
      hatch(0, -0.25, 0.56);
      break;
    }
    case 'twins': {
      add(turretBody(bw, bw * 0.95, 0.44, 0.1), true);
      for (const side of [-1, 1]) { barrels.push(add(barrel(0.07, bw * 0.3, bl, by, side * 0.3))); add(cyl(0.11, 0.11, 0.3, MAT.dark, side * 0.3, by, bw * 0.45, 10)).rotation.x = Math.PI / 2; }
      add(box(bw * 0.3, 0.22, 0.44, MAT.dark, 0, 0.5, 0.05, 0.02));
      launchers();
      break;
    }
    case 'isida': {
      add(cyl(bw * 0.42, bw * 0.5, 0.46, paintMat, 0, 0.23, 0, 22), true);
      add(new THREE.Mesh(boxUV(new THREE.SphereGeometry(bw * 0.33, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), 1), paintMat), true).position.y = 0.46;
      for (const side of [-1, 1]) barrels.push(add(barrel(0.045, bw * 0.3, bl, by + 0.05, side * 0.2, em)));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), em)).position.set(0, by + 0.05, bl - 0.5);
      add(barrel(0.09, bw * 0.3, bl - 0.55, by - 0.05, 0));
      add(ring(0.24, 0.03, MAT.dark, 0, by + 0.05, bl - 0.5));
      break;
    }
    case 'railgun': {
      add(turretBody(bw * 0.9, bw * 1.45, 0.48, 0.25), true);
      barrels.push(add(barrel(0.075, bw * 0.5, bl, by)));
      for (let i = 0; i < 4; i++) add(ring(0.16, 0.035, em, 0, by, bw * 0.75 + i * (bl - bw * 0.75) / 4.3));
      for (const side of [-1, 1]) add(box(0.04, 0.07, bw * 1.1, em, side * bw * 0.3, 0.5, -0.1, 0.01));
      add(box(0.3, 0.2, 0.5, MAT.dark, 0, 0.52, -0.3, 0.02));
      break;
    }
    case 'thunder': {
      add(turretBody(bw * 1.05, bw * 1.15, 0.58, 0.22), true);
      mantlet(0.3, bw * 0.55);
      barrels.push(add(barrel(0.15, bw * 0.4, bl - 0.3, by)));
      add(barrel(0.2, bl - 0.35, bl, by, 0, MAT.gun, 0.21));
      barrelDetails(g, 0.15, bw * 0.8, bl - 0.35, by);
      hatch(); launchers(-0.1, 0.35);
      break;
    }
    case 'hammer': {
      add(turretBody(bw, bw, 0.52, 0.12), true);
      mantlet(0.26, bw * 0.45);
      barrels.push(add(barrel(0.16, bw * 0.3, bl, by, 0, MAT.gun, 0.19)));
      add(box(0.26, 0.3, 0.5, MAT.dark, bw * 0.45, 0.42, 0.1, 0.02));
      add(box(bw * 0.4, 0.12, 0.12, MAT.dark, 0, by + 0.22, bl - 0.6, 0.02));
      hatch(-bw * 0.28, -0.25);
      break;
    }
    case 'ricochet': {
      add(turretBody(bw * 1.1, bw, 0.42, 0.1), true);
      barrels.push(add(barrel(0.12, bw * 0.3, bl - 0.1, by)));
      add(box(0.36, 0.08, 0.5, em, 0, by, bl - 0.3, 0.01));
      add(box(0.5, 0.05, 0.05, em, 0, 0.44, 0, 0.01));
      add(ring(0.16, 0.03, MAT.dark, 0, by, bw * 0.5));
      break;
    }
    case 'striker': {
      add(turretBody(bw * 0.9, bw * 0.9, 0.44, 0.1), true);
      add(box(bw * 0.95, 0.54, bw * 0.9, MAT.dark, 0, by + 0.05, bw * 0.3, 0.04));
      for (const sx of [-1, 1]) for (const sy of [0, 1]) {
        const tube = barrel(0.1, bw * 0.3, bl, by - 0.1 + sy * 0.26, sx * 0.24, MAT.gun);
        barrels.push(add(tube));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.2, 10), em);
        cone.position.set(sx * 0.24, by - 0.1 + sy * 0.26, bl - 0.02); cone.rotation.x = Math.PI / 2; add(cone);
      }
      hatch(-bw * 0.25, -0.3);
      break;
    }
    case 'vulcan': {
      add(turretBody(bw, bw * 1.1, 0.5, 0.15), true);
      const spin = new THREE.Group();
      spin.position.set(0, by, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = barrel(0.04, bw * 0.4, bl, 0, 0);
        b.position.x = Math.cos(a) * 0.12; b.position.y = Math.sin(a) * 0.12;
        spin.add(b); barrels.push(b);
      }
      g.add(spin);
      g.userData.spin = spin;
      const drum = cyl(0.3, 0.3, 0.5, MAT.dark, bw * 0.5, 0.36, -0.1, 16); drum.rotation.z = Math.PI / 2; add(drum);
      for (const z of [bl - 0.4, bw * 0.75]) { const r = cyl(0.19, 0.19, 0.12, MAT.gun, 0, by, z, 12); r.rotation.x = Math.PI / 2; add(r); }
      add(box(0.12, 0.08, 0.6, MAT.dark, -bw * 0.3, 0.52, 0, 0.01));
      break;
    }
    case 'shaft': {
      add(turretBody(bw * 0.85, bw * 1.55, 0.44, 0.3), true);
      barrels.push(add(barrel(0.06, bw * 0.4, bl + 0.4, by, 0, MAT.gun, 0.05)));
      for (let i = 1; i < 5; i++) add(ring(0.075, 0.015, MAT.dark, 0, by, bw * 0.5 + i * 0.5));
      const scope = cyl(0.07, 0.07, 0.6, MAT.dark, 0, by + 0.2, bw * 0.4, 10); scope.rotation.x = Math.PI / 2; add(scope);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), MAT.glass)).position.set(0, by + 0.2, bw * 0.4 - 0.3);
      add(box(0.05, 0.04, 0.6, em, 0, by - 0.1, bw * 0.9, 0.01));
      hatch(-bw * 0.25, -0.4);
      break;
    }
    default: {
      add(turretBody(bw, bw, 0.46), true);
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
    animate(dt, speed, firing) {
      const off = (speed * dt) / 0.5;
      for (const tm of H.trackMats) { tm.map.offset.y -= off * 0.5; tm.normalMap.offset.y -= off * 0.5; }
      const ang = (speed * dt) / H.rw;
      for (const wh of H.wheels) wh.rotation.x += ang;
      if (api.recoil > 0) api.recoil = Math.max(0, api.recoil - dt * 4);
      const k = api.recoil * 0.25;
      for (const b of T.barrels) b.position.z = (b.userData.z0 ??= b.position.z) - k;
      if (api.spin) api.spin.rotation.z += dt * (firing ? 30 : 0);
    },
    kick() { api.recoil = 1; },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const tm of H.trackMats) { tm.map.dispose(); tm.normalMap.dispose(); tm.dispose(); }
    },
  };
  api.setTeam(team);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return api;
}
