// Tank models: the CC0 Abrams hull / turret / gun (OpenGameArt, by Sketlux) fitted to each Tanki hull class, with the
// weapon variants built onto the real turret. Falls back to parametric geometry when the models are unavailable.
import * as THREE from 'three';
import { getHull, getTurret, getPaint } from '/shared/items.mjs';
import { Textures } from './textures.mjs';
import { Assets, modelBounds } from './assets.mjs';
import { rbox, boxUV, prism, roundedRect } from './geo.mjs';
import { MUZZLE_HEIGHT } from '/shared/constants.mjs';

const TURRET_BODY_TOP = 0.76; // model-space y of the scanned turret roof (its bbox also holds the antenna)

export const TANK_MODELS = ['tank_hull', 'tank_turret', 'tank_gun'];

const matCache = new Map();
function mat(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }
const MAT = {
  get dark() { return mat('dark', () => Textures.material('steel', { color: 0x4a4e52, roughness: 0.8, metalness: 0.6 })); },
  get gun() { return mat('gun', () => Textures.material('metalSmooth', { color: 0x70747a, roughness: 0.6, metalness: 0.9 })); },
  get rubber() { return mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.92, metalness: 0.05 })); },
  get glass() { return mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x8fc8ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.75, clearcoat: 1 })); },
  get canvas() { return mat('canvas', () => Textures.material('sandbag', { color: 0x6b6a52, roughness: 1, metalness: 0 })); },
  track() { const t = Textures.prop('treads'); return new THREE.MeshStandardMaterial({ map: t.map.clone(), normalMap: t.normal ? t.normal.clone() : null, roughness: 0.9, metalness: 0.3 }); },
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
    const painted = Textures.prop('painted');
    const m = new THREE.MeshPhysicalMaterial({
      color: map ? 0xffffff : paint.color, map, normalMap: painted.normal, normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: painted.rough || null, roughness: 0.82, metalness: 0.3, clearcoat: 0.1, clearcoatRoughness: 0.6,
    });
    // weathering: grime toward the bottom of each part, broken up by noise
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLocalY; varying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalY = position.y; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLocalY; varying vec3 vWPos;')
        .replace('#include <map_fragment>', `
          #include <map_fragment>
          float gn = fract(sin(dot(floor(vWPos.xz * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
          float grime = smoothstep(0.25, -0.35, vLocalY + gn * 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.46, 0.4), grime * 0.7);
          diffuseColor.rgb *= 0.92 + 0.08 * gn;
        `);
    };
    m.customProgramCacheKey = () => 'paintWeathered';
    paintMats.set(paint.id, m);
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

// ---- scanned model parts -----------------------------------------------------------
const prepared = new Map();
/** Source model with node transforms baked into the geometry (except wheels, which keep their pivots) and box UVs. */
function part(id) {
  if (prepared.has(id)) return prepared.get(id);
  const src = Assets.modelSync(id);
  if (!src) return null;
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const meshes = [];
  src.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const wheels = [];
  for (const o of meshes) {
    const name = (o.material && o.material.name) || '';
    const isWheel = id === 'tank_hull' && (name === 'wheels' || name === '');
    if (isWheel) { wheels.push(o); continue; }
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    o.geometry.applyMatrix4(local);
    o.geometry.computeVertexNormals();
    boxUV(o.geometry, 1.0);
    o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
    o.updateMatrix();
  }
  // flatten: every mesh becomes a direct child of the root
  const root = new THREE.Group();
  root.name = id;
  for (const o of meshes) {
    if (wheels.includes(o)) { const wm = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); o.matrix.copy(wm); o.matrix.decompose(o.position, o.quaternion, o.scale); }
    root.add(o);
  }
  root.updateMatrixWorld(true);
  const box = modelBounds(root);
  const info = { root, box, wheels: wheels.map((w) => w.name) };
  prepared.set(id, info);
  return info;
}

function partMaterial(name, paintMat) {
  if (name === 'wheels' || name === '') return MAT.rubber;
  if (/barrel|guide|^Material$/.test(name)) return MAT.gun;
  return paintMat;
}

/** Clone of a prepared part with materials assigned; returns { group, paintMeshes, wheels } */
function instancePart(id, paintMat) {
  const p = part(id);
  if (!p) return null;
  const g = p.root.clone();
  const paintMeshes = [], wheels = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material && o.material.name) || '';
    o.material = partMaterial(name, paintMat);
    o.castShadow = true; o.receiveShadow = true;
    if (o.material === paintMat) paintMeshes.push(o);
    if (p.wheels.includes(o.name)) wheels.push(o);
  });
  return { group: g, paintMeshes, wheels, box: p.box };
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

/** Scanned hull fitted to the hull class box. */
function buildHullModel(hullId, paintMat) {
  const inst = instancePart('tank_hull', paintMat);
  if (!inst) return null;
  const hull = getHull(hullId);
  const [w, h, l] = hull.size;
  const s = HULL_SHAPES[hullId] || HULL_SHAPES.hunter;
  const size = inst.box.getSize(new THREE.Vector3()), center = inst.box.getCenter(new THREE.Vector3());
  const sx = w / size.x, sy = h / size.y, sz = l / size.z;
  const g = new THREE.Group();
  const wrap = new THREE.Group();
  wrap.add(inst.group);
  wrap.scale.set(sx, sy, sz);
  wrap.position.set(-center.x * sx, -center.y * sy, -center.z * sz);
  g.add(wrap);
  const paintMeshes = inst.paintMeshes;
  const topY = h / 2;
  const bw = w * 0.6;
  // class details on top of the scanned hull
  if (s.plate) {
    g.add(box(bw * 0.9, h * 0.3, 0.1, MAT.dark, 0, -h * 0.05, l / 2 - 0.02, 0.02));
    for (let i = 0; i < 4; i++) g.add(box(0.22, 0.08, 0.06, MAT.dark, -bw * 0.35 + i * bw * 0.23, h * 0.12, l / 2 + 0.03, 0.01));
  }
  if (s.double) { const m = new THREE.Mesh(prism(w * 0.6, l * 0.5, w * 0.5, l * 0.4, h * 0.14, 0, 1), paintMat); m.position.set(0, topY - 0.02, -l * 0.12); m.castShadow = true; g.add(m); paintMeshes.push(m); }
  if (s.mount) { const m = cyl(w * 0.28, w * 0.32, h * 0.22, paintMat, 0, topY + h * 0.1, 0, 22); g.add(m); paintMeshes.push(m); }
  if (s.fins) for (const side of [-1, 1]) g.add(box(0.05, h * 0.26, l * 0.28, MAT.dark, side * (w / 2 - 0.1), topY - h * 0.1, -l * 0.3, 0.01));
  // headlights, exhausts, antenna with the team light
  for (const side of [-1, 1]) {
    const housing = cyl(0.07, 0.07, 0.06, MAT.dark, side * w * 0.3, -h * 0.05, l / 2 - 0.02, 10);
    housing.rotation.x = Math.PI / 2;
    g.add(housing);
    const lens = cyl(0.05, 0.05, 0.02, emissive(0xfff2c0, 1.2), side * w * 0.3, -h * 0.05, l / 2 + 0.02, 10);
    lens.rotation.x = Math.PI / 2;
    g.add(lens);
    const ex = cyl(0.06, 0.06, 0.3, MAT.dark, side * w * 0.28, h * 0.1, -l / 2 - 0.08, 10);
    ex.rotation.x = Math.PI / 2;
    g.add(ex);
  }
  g.add(cyl(0.012, 0.018, 1.2, MAT.dark, -w * 0.36, topY + 0.6, -l * 0.3, 6));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), emissive(0x9bd33a));
  tip.position.set(-w * 0.36, topY + 1.2, -l * 0.3);
  g.add(tip);
  const rw = size.y * sy * 0.3;
  return { group: g, paintMeshes, trackMats: [], wheels: inst.wheels, wheelAxis: 'y', teamTip: tip, size: [w, h, l], rw, scale: [sx, sy, sz], modelTop: inst.box.max.y, modelBox: inst.box };
}

function buildHullProcedural(hullId, paintMat) {
  const hull = getHull(hullId);
  const [w, h, l] = hull.size;
  const s = HULL_SHAPES[hullId] || HULL_SHAPES.hunter;
  const g = new THREE.Group();
  const paintMeshes = [];
  const y0 = -h / 2;
  const tw = s.trackW * w;
  const bw = w - 2 * tw - 0.08;
  const paint = (mesh) => { g.add(mesh); paintMeshes.push(mesh); return mesh; };
  paint(box(bw, h * s.lower, l * 0.96, paintMat, 0, y0 + h * s.lower / 2, 0, 0.05));
  const upW = w * 0.98, upL = l * 0.92;
  const upper = new THREE.Mesh(prism(upW, upL, upW * s.glacis, upL - s.front - s.back, h * s.upperH, -(s.front - s.back) / 2, 1), paintMat);
  upper.position.set(0, y0 + h * s.lower, 0);
  upper.castShadow = true;
  paint(upper);
  const topY = y0 + h * (s.lower + s.upperH);
  for (let i = 0; i < 3; i++) g.add(box(bw * 0.7, 0.03, 0.16, MAT.dark, 0, topY + 0.015, -l * 0.42 + i * 0.26, 0.005));
  g.add(cyl(0.012, 0.018, 1.2, MAT.dark, bw * 0.4, topY + 0.6, -l * 0.3, 6));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), emissive(0x9bd33a));
  tip.position.set(bw * 0.4, topY + 1.2, -l * 0.3);
  g.add(tip);
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
    }
    paint(box(tw + 0.06, 0.05, beltLen * 0.98, paintMat, x, y0 + 0.02 + beltH + 0.04, 0, 0.01));
  }
  return { group: g, paintMeshes, trackMats, wheels, wheelAxis: 'x', teamTip: tip, size: [w, h, l], rw, scale: [1, 1, 1], modelTop: h / 2 };
}

function buildTurret(turretId, H, paintMat) {
  const t = getTurret(turretId);
  const [w, h, l] = H.size;
  const g = new THREE.Group();
  const paintMeshes = [];
  const bl = l / 2 + 0.9;      // muzzle z (matches server)
  const by = MUZZLE_HEIGHT;    // barrel height (matches server)
  const em = emissive(t.color);
  const barrels = [];
  const add = (m, isPaint = false) => { g.add(m); if (isPaint) paintMeshes.push(m); return m; };
  const bw = Math.min(w * 0.56, 1.6);
  const [sx, sy, sz] = H.scale;

  // turret body: the scanned turret (pivot at the ring centre) lifted so its gun axis sits at the server muzzle height
  const gunPart = part('tank_gun');
  const tur = instancePart('tank_turret', paintMat);
  const gunNatural = gunPart ? ((gunPart.box.min.y + gunPart.box.max.y) / 2 - H.modelTop) * sy : by;
  const lift = tur ? Math.max(0, by - gunNatural) : 0;
  let top = 0.5;
  if (tur) {
    const wrap = new THREE.Group();
    wrap.add(tur.group);
    wrap.scale.set(sx, sy, sz);
    wrap.position.set(0, -H.modelTop * sy + lift, 0);
    g.add(wrap);
    paintMeshes.push(...tur.paintMeshes);
    top = (TURRET_BODY_TOP - H.modelTop) * sy + lift;
    const base = (tur.box.min.y - H.modelTop) * sy + lift;
    if (base > 0.01) { const r = cyl(bw * 0.5, bw * 0.55, base + 0.03, MAT.dark, 0, (base + 0.03) / 2 - 0.02, 0, 24); g.add(r); }
  } else {
    const body = new THREE.Mesh(prism(bw, bw * 1.15, bw * 0.86, bw, 0.5, -0.07, 1), paintMat);
    body.castShadow = true;
    add(body, true);
  }
  const antennaY = tur ? (tur.box.max.y - H.modelTop) * sy + lift : 0.5;
  // gun: the scanned barrel stretched to the server muzzle length
  const realGun = (x = 0, radius = 1, length = 1, material = null) => {
    if (!gunPart) return barrel(0.085 * radius, bw * 0.4, bl, by, x, material);
    const inst = instancePart('tank_gun', paintMat);
    if (material) inst.group.traverse((o) => { if (o.isMesh) o.material = material; });
    const gb = inst.box;
    const gLen = gb.max.z - gb.min.z, gcy = (gb.min.y + gb.max.y) / 2, gcx = (gb.min.x + gb.max.x) / 2;
    const wrap = new THREE.Group();
    wrap.add(inst.group);
    const zs = ((bl - gb.min.z * sz) * length) / gLen;
    wrap.scale.set(sx * radius, sy * radius, zs);
    wrap.position.set(x - gcx * sx * radius, by - gcy * sy * radius, gb.min.z * (sz - zs));
    return wrap;
  };
  const hatch = (x = -bw * 0.25, z = -bw * 0.2, y = top) => { add(cyl(0.2, 0.2, 0.07, MAT.dark, x, y, z, 14)); add(cyl(0.16, 0.16, 0.05, paintMat, x, y + 0.04, z, 14), true); };
  const launchers = (z = -0.05, y = top - 0.15) => { for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { const c = cyl(0.035, 0.035, 0.18, MAT.dark, side * (bw / 2 + 0.03), y, z + i * 0.09 - 0.09, 8); c.rotation.z = side * 0.5; c.rotation.x = -0.5; add(c); } };
  const mantlet = (r, z) => { const m = cyl(r, r * 1.08, 0.32, MAT.dark, 0, by, z, 14); m.rotation.x = Math.PI / 2; add(m); };
  const muzzleBrake = (r) => { const brake = cyl(r * 1.55, r * 1.55, 0.34, MAT.dark, 0, by, bl - 0.17, 12); brake.rotation.x = Math.PI / 2; add(brake); for (const side of [-1, 1]) add(box(0.1, r * 1.3, 0.14, MAT.gun, side * r * 1.5, by, bl - 0.17, 0.01)); };
  switch (turretId) {
    case 'smoky': { barrels.push(add(realGun(0, 1, 1))); if (!tur) { hatch(); launchers(); } break; }
    case 'thunder': { barrels.push(add(realGun(0, 1.45, 1))); muzzleBrake(0.14); mantlet(0.3, bw * 0.55); if (!tur) hatch(); break; }
    case 'hammer': { barrels.push(add(realGun(0, 1.8, 0.92))); add(box(0.26, 0.3, 0.5, MAT.dark, bw * 0.45, top - 0.1, 0.1, 0.02)); add(box(bw * 0.4, 0.12, 0.12, MAT.dark, 0, by + 0.25, bl - 0.7, 0.02)); break; }
    case 'railgun': { barrels.push(add(realGun(0, 0.85, 1))); for (let i = 0; i < 4; i++) add(ring(0.15, 0.035, em, 0, by, bw * 0.75 + i * (bl - bw * 0.75) / 4.3)); for (const side of [-1, 1]) add(box(0.04, 0.07, bw * 1.1, em, side * bw * 0.3, top, -0.1, 0.01)); break; }
    case 'shaft': { barrels.push(add(realGun(0, 0.7, 1.18))); for (let i = 1; i < 5; i++) add(ring(0.07, 0.015, MAT.dark, 0, by, bw * 0.5 + i * 0.5)); const scope = cyl(0.07, 0.07, 0.6, MAT.dark, 0, by + 0.22, bw * 0.4, 10); scope.rotation.x = Math.PI / 2; add(scope); add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), MAT.glass)).position.set(0, by + 0.22, bw * 0.4 - 0.3); break; }
    case 'ricochet': { barrels.push(add(realGun(0, 1.3, 0.9))); add(box(0.36, 0.08, 0.5, em, 0, by, bl - 0.45, 0.01)); add(box(0.5, 0.05, 0.05, em, 0, top, 0, 0.01)); break; }
    case 'twins': { for (const side of [-1, 1]) { barrels.push(add(realGun(side * 0.3, 0.75, 1))); } add(box(bw * 0.3, 0.22, 0.44, MAT.dark, 0, top, 0.05, 0.02)); break; }
    case 'firebird': case 'freeze': {
      const col = turretId === 'firebird' ? 0xb8431a : 0x2a8fbf;
      const tankMat = mat('tank' + col, () => Textures.material('metalSmooth', { color: col, roughness: 0.5, metalness: 0.7 }));
      for (const side of [-1, 1]) { const tank = cyl(0.17, 0.17, bw * 0.95, tankMat, side * bw * 0.42, top - 0.05, -0.1, 14); tank.rotation.x = Math.PI / 2; add(tank); add(ring(0.18, 0.025, MAT.dark, side * bw * 0.42, top - 0.05, -0.1 - bw * 0.3)); add(ring(0.18, 0.025, MAT.dark, side * bw * 0.42, top - 0.05, -0.1 + bw * 0.3)); }
      barrels.push(add(barrel(0.1, bw * 0.3, bl - 0.25, by)));
      add(barrel(0.16, bl - 0.3, bl, by, 0, MAT.gun, 0.23));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), em)).position.set(0, by, bl - 0.05);
      break;
    }
    case 'isida': {
      add(new THREE.Mesh(boxUV(new THREE.SphereGeometry(bw * 0.3, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), 1), paintMat), true).position.y = top - 0.05;
      for (const side of [-1, 1]) barrels.push(add(barrel(0.045, bw * 0.3, bl, by + 0.05, side * 0.2, em)));
      add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), em)).position.set(0, by + 0.05, bl - 0.5);
      add(barrel(0.09, bw * 0.3, bl - 0.55, by - 0.05, 0));
      add(ring(0.24, 0.03, MAT.dark, 0, by + 0.05, bl - 0.5));
      break;
    }
    case 'striker': {
      add(box(bw * 0.95, 0.54, bw * 0.9, MAT.dark, 0, top + 0.2, bw * 0.3, 0.04));
      for (const sx2 of [-1, 1]) for (const sy2 of [0, 1]) {
        const tube = barrel(0.1, bw * 0.3, bl, top + 0.05 + sy2 * 0.26, sx2 * 0.24, MAT.gun);
        barrels.push(add(tube));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.2, 10), em);
        cone.position.set(sx2 * 0.24, top + 0.05 + sy2 * 0.26, bl - 0.02); cone.rotation.x = Math.PI / 2; add(cone);
      }
      break;
    }
    case 'vulcan': {
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
      const drum = cyl(0.3, 0.3, 0.5, MAT.dark, bw * 0.5, top - 0.1, -0.1, 16); drum.rotation.z = Math.PI / 2; add(drum);
      for (const z of [bl - 0.4, bw * 0.75]) { const r = cyl(0.19, 0.19, 0.12, MAT.gun, 0, by, z, 12); r.rotation.x = Math.PI / 2; add(r); }
      break;
    }
    default: { barrels.push(add(realGun(0, 1, 1))); }
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, by, bl);
  g.add(muzzle);
  return { group: g, paintMeshes, barrels, muzzle, antennaY };
}

/**
 * Build a complete tank. Hull local +Z is forward. Returns handles for animation.
 */
export function buildTank({ hull = 'wasp', turret = 'smoky', paint = 'green', team = 0 } = {}) {
  const group = new THREE.Group();
  const paintMat = paintMaterial(paint);
  const H = buildHullModel(hull, paintMat) || buildHullProcedural(hull, paintMat);
  const T = buildTurret(turret, H, paintMat);
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
      for (const tm of H.trackMats) { tm.map.offset.y -= off * 0.5; if (tm.normalMap) tm.normalMap.offset.y -= off * 0.5; }
      const ang = (speed * dt) / H.rw;
      if (H.wheelAxis === 'y') for (const wh of H.wheels) wh.rotateY(-ang); else for (const wh of H.wheels) wh.rotation.x += ang;
      if (api.recoil > 0) api.recoil = Math.max(0, api.recoil - dt * 4);
      const k = api.recoil * 0.25;
      for (const b of T.barrels) b.position.z = (b.userData.z0 ??= b.position.z) - k;
      if (api.spin) api.spin.rotation.z += dt * (firing ? 30 : 0);
    },
    kick() { api.recoil = 1; },
    dispose() {
      group.traverse((o) => { if (o.geometry && !o.userData.shared && !prepared.size) o.geometry.dispose(); });
      for (const tm of H.trackMats) { tm.map.dispose(); if (tm.normalMap) tm.normalMap.dispose(); tm.dispose(); }
    },
  };
  api.setTeam(team);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return api;
}
