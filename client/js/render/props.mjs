// Map props: buildings with recessed windows and ledges, sloped bunkers with sandbags, Jersey barriers, perimeter
// wall panels, scanned CC0 boulders and trees (Poly Haven), crates, containers and real-world clutter models.
import * as THREE from 'three';
import { Textures } from './textures.mjs';
import { Assets, instanceModel, modelBounds } from './assets.mjs';
import { rbox, boxUV, seeded, prism } from './geo.mjs';
import { fbm } from '/shared/noise.mjs';
import { getNav } from '/shared/sim/nav.mjs';

const CONTAINER_TINTS = [0xa8423c, 0x2f5f94, 0x3f7a3a, 0xc07a2a, 0x7a7f86];
const BUILDING_TINTS = [0xb5b7bb, 0xa7b0b8, 0xc2b9ab, 0x9ea6a2];
const matCache = new Map();

function material(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}
const pbr = (name, extra = {}) => Textures.material(name, extra);
const darkMetal = () => material('darkmetal', () => pbr('steel', { color: 0x4a4d50, roughness: 0.7, metalness: 0.7 }));
const glassMat = (lit) => material('glass' + (lit ? 'L' : ''), () => new THREE.MeshPhysicalMaterial({ color: lit ? 0xffe2a8 : 0x16222e, emissive: lit ? 0xffd48a : 0x000000, emissiveIntensity: lit ? 0.9 : 0, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 }));

function propMaterial(p) {
  switch (p.mat) {
    case 'concrete': return material('concrete', () => pbr('concrete', { roughness: 1, color: 0xb9b9b7 }));
    case 'metal': return material('metal', () => pbr('metal', { roughness: 1, metalness: 0.6, color: 0xb0aaa4 }));
    case 'crate': return material('crate', () => pbr('crate', { roughness: 1, metalness: 0 }));
    case 'container': return material('container' + (p.tint | 0), () => pbr('container', { color: CONTAINER_TINTS[(p.tint | 0) % CONTAINER_TINTS.length], roughness: 0.9, metalness: 0.9 }));
    case 'brick': return material('brick', () => pbr('brick', { roughness: 1 }));
    case 'building': return material('building' + (p.tint | 0), () => pbr('building', { color: BUILDING_TINTS[(p.tint | 0) % BUILDING_TINTS.length], roughness: 1 }));
    case 'barrier': return material('barrier', () => pbr('barrier', { roughness: 1 }));
    case 'bunker': return material('bunker', () => pbr('bunker', { roughness: 1, color: 0xc2c2be }));
    case 'rock': return material('rock', () => pbr('rock', { roughness: 1 }));
    default: return material('concrete', () => pbr('concrete', { roughness: 1, color: 0xb9b9b7 }));
  }
}

function contactShadow(x, y, z, w, l, yaw, opacity = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ map: Textures.get('blob'), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -yaw;
  m.position.set(x, y + 0.03, z);
  m.renderOrder = 1;
  return m;
}

const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

// ---- scanned models ------------------------------------------------------------
const ROCK_MODELS = { grass: ['boulder_01', 'namaqualand_boulder_04'], sand: ['namaqualand_boulder_04', 'boulder_01'], snow: ['boulder_01', 'namaqualand_boulder_04'], asphalt: ['boulder_01', 'namaqualand_boulder_04'] };
const TREE_MODELS = { grass: { id: 'island_tree_02', height: 6.8 }, sand: { id: 'quiver_tree_01', height: 4.6 } };
const CLUTTER = {
  common: [['Barrel_01', 3, 1], ['barrel_03', 3, 1], ['old_tyre', 2, 1], ['metal_jerrycan_green', 1, 1], ['wooden_crate_02', 2, 1], ['old_military_crate', 2, 1], ['plastic_crate_02', 1, 1], ['propane_tank', 1, 1]],
  grass: [['dead_tree_trunk', 2, 1], ['dry_branches_medium_01', 2, 1], ['rock_moss_set_01', 2, 0.35], ['boulder_01', 2, 0.45]],
  sand: [['namaqualand_boulder_04', 3, 0.4], ['dry_branches_medium_01', 2, 1], ['boulder_01', 1, 0.4]],
  snow: [['boulder_01', 2, 0.45], ['dead_tree_trunk', 1, 1]],
  asphalt: [['concrete_road_barrier', 3, 1], ['concrete_road_barrier_02', 2, 1], ['modular_industrial_pipes_01', 1, 1], ['metal_trash_can', 2, 1], ['power_box_01', 1, 1], ['ladder_sectioned_01', 1, 1], ['old_military_compressor', 1, 1], ['industrial_pastic_container', 1, 1]],
};

/** Every scanned model a map needs (preload before building). */
export function propModelIds(map) {
  const ground = map.theme.ground;
  const ids = new Set([...(ROCK_MODELS[ground] || ROCK_MODELS.grass), 'rock_moss_set_01']);
  if (TREE_MODELS[ground]) ids.add(TREE_MODELS[ground].id);
  for (const [id] of [...CLUTTER.common, ...(CLUTTER[ground] || [])]) ids.add(id);
  return [...ids];
}

// ---- rocks ---------------------------------------------------------------------
function rockGeometry(seed, detail = 3) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const f = 1.3;
    const n = (fbm(v.x * f + seed, v.y * f, seed) + fbm(v.y * f, v.z * f + seed, seed + 7) + fbm(v.z * f + seed, v.x * f, seed + 13)) / 3;
    const n2 = fbm(v.x * 4 + seed, v.z * 4, seed + 21);
    const r = 0.78 + n * 0.5 + n2 * 0.12;
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  geo.computeVertexNormals();
  boxUV(geo, 1.2);
  return geo;
}

function buildRock(p, ground) {
  const list = ROCK_MODELS[ground] || ROCK_MODELS.grass;
  const flat = p.size[0] > p.size[1] * 1.6 && ground === 'grass';
  const id = flat ? 'rock_moss_set_01' : list[p.id % list.length];
  const src = Assets.modelSync(id);
  const g = new THREE.Group();
  if (src) {
    const m = src.clone();
    const box = modelBounds(m);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const sx = p.size[0] / size.x * 1.08, sy = p.size[1] / size.y * 1.1, sz = p.size[2] / size.z * 1.08;
    m.scale.set(sx, sy, sz);
    m.position.set(-center.x * sx, -box.min.y * sy - p.size[1] / 2 - 0.08, -center.z * sz);
    g.add(m);
  } else {
    const mesh = new THREE.Mesh(rockGeometry(p.id * 0.37, 3), propMaterial(p));
    mesh.scale.set(p.size[0] / 2, p.size[1] / 2 * 1.1, p.size[2] / 2);
    g.add(mesh);
  }
  g.position.set(p.pos[0], p.pos[1], p.pos[2]);
  g.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.prop = p; } });
  return g;
}

// ---- trees ---------------------------------------------------------------------
class LeafCards {
  constructor(group) {
    this.group = group;
    this.items = [];
  }
  add(matrix) { this.items.push(matrix.clone()); }
  finish() {
    if (!this.items.length) return;
    const geo = new THREE.PlaneGeometry(1.9, 1.9);
    const mat = material('leafcard', () => new THREE.MeshStandardMaterial({ map: Textures.get('leafCard'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 }));
    const im = new THREE.InstancedMesh(geo, mat, this.items.length);
    this.items.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
  }
}

function buildTreeProcedural(p, theme, map, cards) {
  const g = new THREE.Group();
  const s = p.tint || 1;
  const rng = seeded(p.id * 7 + 1);
  const bark = material('bark', () => pbr('bark', { roughness: 1 }));
  const trunkH = 2.6 * s;
  const trunk = shadowed(new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.17 * s, 0.34 * s, trunkH, 9), 0.8), bark));
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  const pine = theme.ground === 'snow' || (theme.ground === 'grass' && (p.id % 3 === 0));
  if (pine) {
    const m = material('pine', () => pbr('pine', { roughness: 1, color: 0x6c7a52 }));
    for (let i = 0; i < 5; i++) {
      const r = (2.4 - i * 0.42) * s, h = 2.0 * s;
      const cone = shadowed(new THREE.Mesh(boxUV(new THREE.ConeGeometry(r, h, 10), 1.2), m));
      cone.position.y = trunkH + i * 1.15 * s + h / 2 - 1.2 * s;
      cone.rotation.y = rng() * Math.PI;
      g.add(cone);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const br = shadowed(new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.06 * s, 0.11 * s, 1.6 * s, 7), 0.8), bark));
      br.position.set(0, trunkH - 0.2 * s, 0);
      br.rotation.set((rng() - 0.5) * 1.2, rng() * Math.PI * 2, 0.9 + rng() * 0.4);
      br.translateY(0.7 * s);
      g.add(br);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), e = new THREE.Euler();
    const centre = new THREE.Vector3(p.pos[0], map.heightAt(p.pos[0], p.pos[2]) - 0.1 + trunkH + 1.4 * s, p.pos[2]);
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2, b = Math.acos(2 * rng() - 1), r = (1.1 + rng() * 1.2) * s;
      pos.set(centre.x + Math.sin(b) * Math.cos(a) * r, centre.y + Math.cos(b) * r * 0.75, centre.z + Math.sin(b) * Math.sin(a) * r);
      e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      q.setFromEuler(e);
      const k = (0.8 + rng() * 0.6) * s;
      scl.set(k, k, k);
      m.compose(pos, q, scl);
      cards.add(m);
    }
  }
  const gy = map.heightAt(p.pos[0], p.pos[2]);
  g.position.set(p.pos[0], gy - 0.1, p.pos[2]);
  g.rotation.y = (p.id * 1.7) % Math.PI;
  g.add(contactShadow(0, 0.1, 0, 3.8 * s, 3.8 * s, 0, 0.35));
  return g;
}

// ---- buildings -----------------------------------------------------------------
class Windows {
  constructor(group) { this.group = group; this.frames = []; this.glass = []; this.lit = []; }
  add(frameM, glassM, lit) { this.frames.push(frameM.clone()); (lit ? this.lit : this.glass).push(glassM.clone()); }
  finish() {
    const make = (list, geo, mat, cast) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false;
      this.group.add(im);
    };
    make(this.frames, rbox(1.7, 2.0, 0.3, 0.03, 1, 1), darkMetal(), true);
    make(this.glass, new THREE.PlaneGeometry(1.4, 1.7), glassMat(false), false);
    make(this.lit, new THREE.PlaneGeometry(1.4, 1.7), glassMat(true), false);
  }
}

function buildBuilding(p, group, windows) {
  const [w, h, l] = p.size;
  const body = shadowed(new THREE.Mesh(rbox(w, h, l, 0.1, 2, 3.2), propMaterial(p)));
  body.position.set(p.pos[0], p.pos[1], p.pos[2]);
  body.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
  body.userData.prop = p;
  group.add(body);
  const rng = seeded(p.id * 31 + 7);
  const floorH = 3.1;
  const floors = Math.max(1, Math.floor(h / floorH));
  const bottom = p.pos[1] - h / 2;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  const ledgeMat = material('ledge', () => pbr('concrete', { color: 0x8e9094, roughness: 1 }));
  const yaw = p.yaw || 0;
  const rotY = (a) => q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
  const faces = [[0, 0, 1, w], [0, 0, -1, w], [1, 0, 0, l], [-1, 0, 0, l]];
  for (const [nx, , nz, len] of faces) {
    const count = Math.max(1, Math.floor(len / 2.8));
    const faceYaw = yaw + Math.atan2(nx, nz);
    for (let f = 0; f < floors; f++) {
      const y = bottom + floorH * f + 1.55;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5;
        const lx = nx !== 0 ? nx * (w / 2 - 0.02) : t * len;
        const lz = nz !== 0 ? nz * (l / 2 - 0.02) : t * len;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const wx = p.pos[0] + lx * c + lz * s, wz = p.pos[2] - lx * s + lz * c;
        rotY(faceYaw);
        pos.set(wx, y, wz);
        m.compose(pos, q, scl);
        const frame = m.clone();
        pos.set(wx - Math.sin(faceYaw) * 0.08, y, wz - Math.cos(faceYaw) * 0.08);
        m.compose(pos, q, scl);
        windows.add(frame, m, rng() < 0.22);
      }
      const ledge = shadowed(new THREE.Mesh(rbox(nx !== 0 ? 0.35 : len + 0.3, 0.16, nz !== 0 ? 0.35 : len + 0.3, 0.02, 1, 2), ledgeMat));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = nx * (w / 2 + 0.1), lz = nz * (l / 2 + 0.1);
      ledge.position.set(p.pos[0] + lx * c + lz * s, bottom + floorH * f + 2.85, p.pos[2] - lx * s + lz * c);
      ledge.rotation.y = yaw;
      ledge.userData.prop = p;
      group.add(ledge);
    }
  }
  const parapet = shadowed(new THREE.Mesh(rbox(w + 0.3, 0.5, l + 0.3, 0.04, 1, 2), ledgeMat));
  parapet.position.set(p.pos[0], p.pos[1] + h / 2 + 0.1, p.pos[2]);
  parapet.rotation.y = yaw;
  group.add(parapet);
  const roofBox = shadowed(new THREE.Mesh(rbox(w * 0.28, 1.3, l * 0.28, 0.05, 2, 2), propMaterial({ mat: 'concrete' })));
  roofBox.position.set(p.pos[0] + w * 0.2, p.pos[1] + h / 2 + 0.75, p.pos[2] - l * 0.15);
  roofBox.rotation.y = yaw;
  group.add(roofBox);
  const ac = shadowed(new THREE.Mesh(rbox(1.6, 0.9, 1.6, 0.04, 2, 1), propMaterial({ mat: 'metal' })));
  ac.position.set(p.pos[0] - w * 0.25, p.pos[1] + h / 2 + 0.55, p.pos[2] + l * 0.2);
  group.add(ac);
  const door = shadowed(new THREE.Mesh(rbox(2.2, 2.6, 0.3, 0.03, 1, 1), darkMetal()));
  door.position.set(p.pos[0] + Math.sin(yaw) * (l / 2 + 0.05), bottom + 1.3, p.pos[2] + Math.cos(yaw) * (l / 2 + 0.05));
  door.rotation.y = yaw;
  group.add(door);
  for (const mm of [parapet, roofBox, ac, door]) mm.userData.prop = p;
}

// ---- bunkers -------------------------------------------------------------------
function buildBunker(p, group) {
  const [w, h, l] = p.size;
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(prism(w, l, w * 0.84, l * 0.7, h * 0.92, -l * 0.08, 2), propMaterial(p)));
  body.position.y = -h / 2;
  g.add(body);
  const roof = shadowed(new THREE.Mesh(rbox(w * 0.9, 0.3, l * 0.78, 0.06, 2, 2), propMaterial({ mat: 'concrete' })));
  roof.position.set(0, h / 2 - 0.05, -l * 0.08);
  g.add(roof);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.28, 0.3), material('slit', () => new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 1 })));
  slit.position.set(0, h * 0.2, l * 0.36);
  g.add(slit);
  const bagMat = material('sandbag', () => pbr('sandbag', { color: 0xb3a17c, roughness: 1 }));
  const bagGeo = boxUV(new THREE.CapsuleGeometry(0.24, 0.5, 4, 8), 0.6);
  const bagCount = Math.floor(w / 0.6);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < bagCount - row; i++) {
      const bag = shadowed(new THREE.Mesh(bagGeo, bagMat));
      bag.rotation.z = Math.PI / 2;
      bag.position.set(-w / 2 + 0.35 + i * 0.6 + row * 0.3, -h / 2 + 0.25 + row * 0.42, l / 2 + 0.45);
      g.add(bag);
    }
  }
  g.position.set(p.pos[0], p.pos[1], p.pos[2]);
  g.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
  g.traverse((o) => { if (o.isMesh) o.userData.prop = p; });
  group.add(g);
  return body;
}

// ---- barriers ------------------------------------------------------------------
function jerseyGeometry(len) {
  const shape = new THREE.Shape();
  const pts = [[-0.45, 0], [0.45, 0], [0.45, 0.14], [0.2, 0.58], [0.14, 1.3], [-0.14, 1.3], [-0.2, 0.58], [-0.45, 0.14]];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  geo.translate(0, -0.65, -len / 2);
  geo.computeVertexNormals();
  boxUV(geo, 2.5);
  return geo;
}

export function buildProps(map) {
  const group = new THREE.Group();
  group.name = 'props';
  const ground = map.theme.ground;
  const cards = new LeafCards(group);
  const windows = new Windows(group);
  const treeModel = TREE_MODELS[ground] && Assets.modelSync(TREE_MODELS[ground].id);
  const treeMats = [];
  let treeInfo = null;
  if (treeModel) {
    const box = modelBounds(treeModel);
    treeInfo = { height: box.max.y - box.min.y || 1, minY: box.min.y, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2 };
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const p of map.props) {
    if (p.kind === 'tree') {
      if (treeModel && treeInfo) {
        const s = p.tint || 1;
        const k = (TREE_MODELS[ground].height * s) / treeInfo.height;
        q.setFromAxisAngle(up, (p.id * 1.7) % (Math.PI * 2));
        v3.set(p.pos[0], map.heightAt(p.pos[0], p.pos[2]) - 0.08 - treeInfo.minY * k, p.pos[2]);
        s3.set(k, k, k);
        m4.compose(v3, q, s3);
        treeMats.push(m4.clone());
        group.add(contactShadow(p.pos[0], map.heightAt(p.pos[0], p.pos[2]), p.pos[2], 4 * s, 4 * s, 0, 0.3));
      } else group.add(buildTreeProcedural(p, map.theme, map, cards));
      continue;
    }
    if (p.kind === 'building') {
      buildBuilding(p, group, windows);
      group.add(contactShadow(p.pos[0], map.heightAt(p.pos[0], p.pos[2]), p.pos[2], p.size[0] * 1.6, p.size[2] * 1.6, p.yaw, 0.6));
      continue;
    }
    if (p.mat === 'bunker' && p.kind === 'box') {
      buildBunker(p, group);
      group.add(contactShadow(p.pos[0], map.heightAt(p.pos[0], p.pos[2]), p.pos[2], p.size[0] * 1.6, p.size[2] * 1.9, p.yaw, 0.5));
      continue;
    }
    if (p.kind === 'rock') {
      group.add(buildRock(p, ground));
      group.add(contactShadow(p.pos[0], map.heightAt(p.pos[0], p.pos[2]), p.pos[2], p.size[0] * 1.5, p.size[2] * 1.5, p.yaw, 0.45));
      continue;
    }
    let mesh;
    if (p.mat === 'barrier') {
      mesh = new THREE.Mesh(jerseyGeometry(p.size[2]), propMaterial(p));
    } else if (p.kind === 'wall') {
      // Perimeter walls are single inward-facing panels: solid from inside the arena, invisible from behind,
      // so the camera can sit outside the map without a slab filling the screen. They do not occlude the camera.
      const along = p.size[0] > p.size[2] ? 'x' : 'z';
      const len = along === 'x' ? p.size[0] : p.size[2];
      const thick = along === 'x' ? p.size[2] : p.size[0];
      const inward = along === 'x' ? [0, -Math.sign(p.pos[2])] : [-Math.sign(p.pos[0]), 0];
      const geo = new THREE.PlaneGeometry(len, p.size[1]);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 3, uv.getY(i) * p.size[1] / 3);
      const panel = new THREE.Mesh(geo, propMaterial(p));
      panel.position.set(p.pos[0] + inward[0] * thick / 2, p.pos[1], p.pos[2] + inward[1] * thick / 2);
      panel.rotation.y = Math.atan2(inward[0], inward[1]);
      panel.receiveShadow = true;
      panel.userData.wall = p;
      group.add(panel);
      const n = Math.floor(len / 12);
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (i / n) * len;
        const pillar = shadowed(new THREE.Mesh(rbox(along === 'x' ? 1.4 : 0.5, p.size[1] + 0.6, along === 'x' ? 0.5 : 1.4, 0.05, 2, 2), propMaterial({ mat: 'concrete' })));
        pillar.position.set(
          (along === 'x' ? p.pos[0] + t : p.pos[0]) + inward[0] * (thick / 2 + 0.05),
          p.pos[1] + 0.3,
          (along === 'x' ? p.pos[2] : p.pos[2] + t) + inward[1] * (thick / 2 + 0.05),
        );
        group.add(pillar);
      }
      const coping = shadowed(new THREE.Mesh(rbox(along === 'x' ? len : 1.2, 0.35, along === 'x' ? 1.2 : len, 0.04, 1, 2), propMaterial({ mat: 'concrete' })));
      coping.position.set(p.pos[0] + inward[0] * (thick / 2 + 0.2), p.pos[1] + p.size[1] / 2 + 0.15, p.pos[2] + inward[1] * (thick / 2 + 0.2));
      group.add(coping);
      continue;
    } else {
      const r = p.mat === 'crate' ? 0.07 : p.mat === 'container' ? 0.06 : 0.08;
      const tex = p.mat === 'crate' ? p.size[0] * 0.8 : p.mat === 'container' ? 2.4 : p.mat === 'metal' ? 2.2 : 2.5;
      mesh = new THREE.Mesh(rbox(p.size[0], p.size[1], p.size[2], r, 2, tex), propMaterial(p));
    }
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    mesh.castShadow = p.kind !== 'wall';
    mesh.receiveShadow = true;
    mesh.userData.prop = p;
    group.add(mesh);
    if (p.kind !== 'wall' && p.kind !== 'ramp') {
      const gy = map.heightAt(p.pos[0], p.pos[2]);
      const onGround = Math.abs((p.pos[1] - p.size[1] / 2) - gy) < 0.6;
      if (onGround) group.add(contactShadow(p.pos[0], gy, p.pos[2], p.size[0] * 1.7, p.size[2] * 1.7, p.yaw, 0.45));
    }
    if (p.mat === 'crate') {
      const bm = darkMetal();
      const s = p.size[0] / 2;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), bm);
        b.position.set(sx * (s - 0.08), sy * (s - 0.08), sz * (s - 0.08));
        mesh.add(b);
      }
    }
    if (p.mat === 'container') {
      const bar = darkMetal();
      for (const dx of [-0.6, -0.2, 0.2, 0.6]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, p.size[1] * 0.9, 6), bar);
        b.position.set(dx, 0, p.size[2] / 2 + 0.04);
        mesh.add(b);
      }
      for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(p.size[0] + 0.06, 0.08, 0.12), bar);
        rib.position.set(0, p.size[1] / 2 + 0.02, -p.size[2] / 2 + 0.5 + i * (p.size[2] - 1) / 4);
        mesh.add(rib);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, p.size[1] + 0.04, 0.2), bar);
        c.position.set(sx * (p.size[0] / 2 - 0.08), 0, sz * (p.size[2] / 2 - 0.08));
        mesh.add(c);
      }
    }
    if (p.kind === 'ramp' || (p.kind === 'box' && (p.mat === 'concrete' || p.mat === 'metal') && p.size[0] >= 6)) {
      const trim = darkMetal();
      for (const sx of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, p.size[2]), trim);
        t.position.set(sx * (p.size[0] / 2 - 0.06), p.size[1] / 2 + 0.03, 0);
        mesh.add(t);
      }
    }
  }
  if (treeModel && treeMats.length) group.add(instanceModel(treeModel, treeMats));
  cards.finish();
  windows.finish();
  return group;
}

/** Scanned clutter (barrels, crates, tyres, debris, road barriers...) placed against structures and walls. */
export function buildClutter(map) {
  const group = new THREE.Group();
  group.name = 'clutter';
  const rng = seeded(map.id.length * 977 + map.nx);
  const ground = map.theme.ground;
  const nav = getNav(map);
  const avoid = [...map.spawns.dm, ...map.spawns.red, ...map.spawns.blue].map((s) => s.pos).concat([map.flags.red, map.flags.blue], map.points.map((p) => p.pos), map.drops, map.gold);
  const nearObjective = (x, z) => avoid.some((a) => Math.hypot(a[0] - x, a[2] - z) < 7);
  const spots = [];
  for (const p of map.props) {
    if (p.kind === 'tree' || p.kind === 'rock' || p.kind === 'ramp') continue;
    const hw = p.size[0] / 2, hl = p.size[2] / 2;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const perim = 2 * (p.size[0] + p.size[2]);
    const n = Math.floor(perim / 3.2);
    for (let i = 0; i < n; i++) {
      if (rng() > (p.kind === 'wall' ? 0.22 : 0.4)) continue;
      const t = rng() * perim;
      let lx, lz, nx, nz;
      if (t < p.size[0]) { lx = -hw + t; lz = hl; nx = 0; nz = 1; }
      else if (t < p.size[0] + p.size[2]) { lx = hw; lz = hl - (t - p.size[0]); nx = 1; nz = 0; }
      else if (t < 2 * p.size[0] + p.size[2]) { lx = hw - (t - p.size[0] - p.size[2]); lz = -hl; nx = 0; nz = -1; }
      else { lx = -hw; lz = -hl + (t - 2 * p.size[0] - p.size[2]); nx = -1; nz = 0; }
      const off = 0.7 + rng() * 0.9;
      lx += nx * off; lz += nz * off;
      const x = p.pos[0] + lx * c + lz * s, z = p.pos[2] - lx * s + lz * c;
      if (Math.abs(x) > map.halfW - 2 || Math.abs(z) > map.halfL - 2) continue;
      if (nav.isBlocked(x, z) || nearObjective(x, z)) continue;
      const top = p.pos[1] - p.size[1] / 2;
      if (p.kind !== 'wall' && Math.abs(top - map.heightAt(x, z)) > 1.2) continue; // elevated platforms
      spots.push({ x, z, yaw: Math.atan2(nx, nz) + p.yaw + (rng() - 0.5) * 0.8 });
    }
  }
  const table = [...CLUTTER.common, ...(CLUTTER[ground] || [])].filter(([id]) => Assets.modelSync(id));
  const total = table.reduce((a, [, w]) => a + w, 0);
  const byModel = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const sp of spots.slice(0, 140)) {
    if (!table.length) break;
    let r = rng() * total, pick = table[0];
    for (const row of table) { r -= row[1]; if (r <= 0) { pick = row; break; } }
    const [id, , scale] = pick;
    const k = scale * (0.9 + rng() * 0.2);
    q.setFromAxisAngle(up, sp.yaw);
    v3.set(sp.x, map.heightAt(sp.x, sp.z) - 0.02, sp.z);
    s3.set(k, k, k);
    m4.compose(v3, q, s3);
    if (!byModel.has(id)) byModel.set(id, []);
    byModel.get(id).push(m4.clone());
  }
  for (const [id, mats] of byModel) {
    const model = Assets.modelSync(id);
    const box = modelBounds(model);
    // models whose origin is not at their base are dropped onto the ground
    if (Math.abs(box.min.y) > 0.05) { const lift = new THREE.Matrix4().makeTranslation(0, -box.min.y, 0); for (const m of mats) m.multiply(lift); }
    group.add(instanceModel(model, mats));
  }
  return group;
}

/** Objective markers: flag bases and control point rings. */
export function buildFlagBase(pos, team) {
  const g = new THREE.Group();
  const color = team === 1 ? 0xe53935 : 0x1e88e5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.08, 40), new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.3 }));
  pad.position.y = 0.04;
  g.add(pad);
  g.position.set(pos[0], pos[1], pos[2]);
  return g;
}

export function buildFlag(team) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.8, roughness: 0.3 }));
  pole.position.y = 1.6;
  pole.castShadow = true;
  g.add(pole);
  const clothGeo = new THREE.PlaneGeometry(1.6, 1.0, 10, 5);
  clothGeo.translate(0.8, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: Textures.get(team === 1 ? 'flagRed' : 'flagBlue'), side: THREE.DoubleSide, roughness: 0.85 }));
  cloth.position.y = 2.7;
  cloth.castShadow = true;
  g.add(cloth);
  g.userData.cloth = cloth;
  g.userData.base = clothGeo.attributes.position.array.slice();
  const light = new THREE.PointLight(team === 1 ? 0xff5a4d : 0x4da3ff, 0.8, 8);
  light.position.y = 2.5;
  g.add(light);
  return g;
}

export function animateFlag(flag, t) {
  const cloth = flag.userData.cloth;
  const base = flag.userData.base;
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    pos.setZ(i, Math.sin(x * 3.5 - t * 6) * 0.12 * x + Math.sin(y * 4 + t * 4) * 0.04 * x);
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}

export function buildControlPoint(pos, id) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 7, 56), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beam.position.y = 7;
  g.add(beam);
  const post = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 12), 1), material('metal', () => pbr('metal', { roughness: 0.9, metalness: 0.8 })));
  post.position.y = 1.1;
  post.castShadow = true;
  g.add(post);
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(id, 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.4, 2.4, 1);
  sprite.position.y = 4.2;
  g.add(sprite);
  const prog = new THREE.Mesh(new THREE.RingGeometry(5.0, 5.5, 56, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  prog.rotation.x = -Math.PI / 2;
  prog.position.y = 0.1;
  g.add(prog);
  g.userData = { ring, beam, progress: prog };
  g.position.set(pos[0], pos[1], pos[2]);
  return g;
}

export function setControlPointState(g, owner, capTeam, cap) {
  const col = owner === 1 ? 0xe53935 : owner === 2 ? 0x1e88e5 : 0xaaaaaa;
  g.userData.ring.material.color.setHex(col);
  g.userData.beam.material.color.setHex(col);
  const prog = g.userData.progress;
  const pc = capTeam === 1 ? 0xff8a80 : capTeam === 2 ? 0x90caf9 : 0xffffff;
  prog.material.color.setHex(pc);
  const len = Math.max(0.001, cap * Math.PI * 2);
  if (Math.abs((prog.userData.len || 0) - len) > 0.01) {
    prog.geometry.dispose();
    prog.geometry = new THREE.RingGeometry(5.0, 5.5, 56, 1, 0, len);
    prog.userData.len = len;
  }
}

/** Rugby ball. */
export function buildBall() {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.45, 20, 14);
  geo.scale(1, 1, 1.4);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a4a24'; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#e8dcc4'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 64); ctx.stroke();
  ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 128); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const ball = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 }));
  ball.castShadow = true;
  g.add(ball);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.get('particle'), color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  glow.scale.set(2.2, 2.2, 1);
  g.add(glow);
  const light = new THREE.PointLight(0xffc070, 1.2, 8);
  g.add(light);
  g.userData.ball = ball;
  return g;
}
