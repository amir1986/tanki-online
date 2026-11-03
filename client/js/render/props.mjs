// Map props: bevelled PBR boxes, buildings, ramps, walls, rocks, trees, contact shadows and ground clutter.
import * as THREE from 'three';
import { Textures } from './textures.mjs';
import { rbox, boxUV, seeded } from './geo.mjs';

const CONTAINER_TINTS = [0xa8423c, 0x2f5f94, 0x3f7a3a, 0xc07a2a, 0x7a7f86];
const BUILDING_TINTS = [0xb5b7bb, 0xa7b0b8, 0xc2b9ab, 0x9ea6a2];
const matCache = new Map();

function material(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}
const pbr = (name, extra = {}) => { const t = Textures.prop(name); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.85, metalness: 0.05, ...extra }); };

function propMaterial(p) {
  switch (p.mat) {
    case 'concrete': return material('concrete', () => pbr('concrete', { roughness: 0.92 }));
    case 'metal': return material('metal', () => pbr('metal', { roughness: 0.62, metalness: 0.35 }));
    case 'crate': return material('crate', () => pbr('crate', { roughness: 0.8 }));
    case 'container': return material('container' + (p.tint | 0), () => pbr('container', { color: CONTAINER_TINTS[(p.tint | 0) % CONTAINER_TINTS.length], roughness: 0.55, metalness: 0.55 }));
    case 'brick': return material('brick', () => pbr('brick', { roughness: 0.95 }));
    case 'building': return material('building' + (p.tint | 0), () => pbr('building', { color: BUILDING_TINTS[(p.tint | 0) % BUILDING_TINTS.length], roughness: 0.7, metalness: 0.1 }));
    case 'barrier': return material('barrier', () => pbr('barrier', { roughness: 0.88 }));
    case 'bunker': return material('bunker', () => pbr('bunker', { roughness: 0.93 }));
    case 'rock': return material('rock', () => pbr('rock', { roughness: 0.95 }));
    default: return material('concrete', () => pbr('concrete', { roughness: 0.92 }));
  }
}

function texScale(p) {
  if (p.kind === 'building') return 3.6;
  if (p.mat === 'crate') return p.size[0];
  if (p.mat === 'container') return 2.6;
  if (p.mat === 'barrier') return 2.5;
  if (p.mat === 'metal') return 2.2;
  return 2;
}

function contactShadow(x, y, z, w, l, yaw, opacity = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ map: Textures.get('blob'), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -yaw;
  m.position.set(x, y + 0.03, z);
  m.renderOrder = 1;
  return m;
}

function buildTree(p, theme, map) {
  const g = new THREE.Group();
  const s = p.tint || 1;
  const trunkH = 2.4 * s;
  const bark = material('bark', () => pbr('bark', { roughness: 1 }));
  const trunk = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, trunkH, 9), 0.8), bark);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const pine = theme.ground === 'snow' || (theme.ground === 'grass' && (p.id % 3 === 0));
  if (pine) {
    const m = material('pine', () => pbr('pine', { roughness: 0.9 }));
    for (let i = 0; i < 4; i++) {
      const r = (2.3 - i * 0.45) * s, h = 2.2 * s;
      const cone = new THREE.Mesh(boxUV(new THREE.ConeGeometry(r, h, 9), 1.2), m);
      cone.position.y = trunkH + i * 1.35 * s + h / 2 - 0.8 * s;
      cone.castShadow = true;
      g.add(cone);
    }
  } else {
    const m = material('leaves', () => pbr('leaves', { roughness: 0.9 }));
    const rng = seeded(p.id * 7 + 1);
    for (let i = 0; i < 5; i++) {
      const r = (1.3 + rng() * 1.1) * s;
      const blob = new THREE.Mesh(boxUV(new THREE.IcosahedronGeometry(r, 1), 1.2), m);
      blob.position.set((rng() - 0.5) * 2.2 * s, trunkH + 1.2 * s + rng() * 1.6 * s, (rng() - 0.5) * 2.2 * s);
      blob.scale.set(1, 0.8 + rng() * 0.3, 1);
      blob.castShadow = true;
      g.add(blob);
    }
  }
  const gy = map.heightAt(p.pos[0], p.pos[2]);
  g.position.set(p.pos[0], gy - 0.1, p.pos[2]);
  g.rotation.y = (p.id * 1.7) % Math.PI;
  g.add(contactShadow(0, 0.1, 0, 3.5 * s, 3.5 * s, 0, 0.35));
  return g;
}

export function buildProps(map) {
  const group = new THREE.Group();
  group.name = 'props';
  for (const p of map.props) {
    if (p.kind === 'tree') { group.add(buildTree(p, map.theme, map)); continue; }
    let mesh;
    if (p.kind === 'rock') {
      const geo = new THREE.DodecahedronGeometry(1, 1);
      const pos = geo.attributes.position;
      const rng = seeded(p.id * 13 + 5);
      for (let i = 0; i < pos.count; i++) {
        const k = 0.78 + rng() * 0.4;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      boxUV(geo, 1.4);
      mesh = new THREE.Mesh(geo, propMaterial(p));
      mesh.scale.set(p.size[0] / 2, p.size[1] / 2 * 1.1, p.size[2] / 2);
    } else if (p.kind === 'building') {
      mesh = new THREE.Mesh(rbox(p.size[0], p.size[1], p.size[2], 0.12, 2, texScale(p)), propMaterial(p));
    } else {
      const r = p.kind === 'wall' ? 0.05 : p.mat === 'crate' ? 0.07 : p.mat === 'container' ? 0.06 : p.mat === 'barrier' ? 0.05 : 0.08;
      mesh = new THREE.Mesh(rbox(p.size[0], p.size[1], p.size[2], r, 2, texScale(p)), propMaterial(p));
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
      if (onGround) group.add(contactShadow(p.pos[0], gy, p.pos[2], p.size[0] * 1.7, p.size[2] * 1.7, p.yaw, p.kind === 'building' ? 0.6 : 0.45));
    }
    if (p.kind === 'building') {
      const roof = new THREE.Mesh(rbox(p.size[0] * 0.3, 1.2, p.size[2] * 0.3, 0.05, 2, 2), propMaterial({ mat: 'concrete' }));
      roof.position.set(p.pos[0] + p.size[0] * 0.2, p.pos[1] + p.size[1] / 2 + 0.6, p.pos[2] - p.size[2] * 0.15);
      roof.castShadow = true;
      group.add(roof);
      const ac = new THREE.Mesh(rbox(1.6, 0.9, 1.6, 0.04, 2, 1), propMaterial({ mat: 'metal' }));
      ac.position.set(p.pos[0] - p.size[0] * 0.25, p.pos[1] + p.size[1] / 2 + 0.45, p.pos[2] + p.size[2] * 0.2);
      ac.castShadow = true;
      group.add(ac);
    }
    if (p.mat === 'container') {
      // door bars
      const bar = material('darkmetal', () => new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.7 }));
      for (const dx of [-0.6, -0.2, 0.2, 0.6]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, p.size[1] * 0.9, 6), bar);
        b.position.set(dx, 0, p.size[2] / 2 + 0.04);
        mesh.add(b);
      }
    }
  }
  return group;
}

/** Purely visual ground clutter (small rocks, bushes, debris) as instanced meshes. */
export function buildClutter(map) {
  const group = new THREE.Group();
  group.name = 'clutter';
  const rng = seeded(map.id.length * 977 + map.nx);
  const ground = map.theme.ground;
  const avoid = [...map.spawns.dm, ...map.spawns.red, ...map.spawns.blue].map((s) => s.pos).concat([map.flags.red, map.flags.blue], map.points.map((p) => p.pos), map.drops, map.gold);
  const blocked = (x, z) => {
    for (const a of avoid) if (Math.hypot(a[0] - x, a[2] - z) < 6) return true;
    for (const p of map.props) {
      if (p.kind === 'tree') continue;
      const hw = p.size[0] / 2 + 1.2, hl = p.size[2] / 2 + 1.2;
      const dx = x - p.pos[0], dz = z - p.pos[2];
      const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < hw && Math.abs(lz) < hl) return true;
    }
    return false;
  };
  const place = (count) => {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 20) {
      const x = (rng() - 0.5) * (map.size[0] - 6), z = (rng() - 0.5) * (map.size[1] - 6);
      if (blocked(x, z)) continue;
      out.push([x, map.heightAt(x, z), z]);
    }
    return out;
  };
  const addInstanced = (geo, mat, positions, scaleRange, yOffset = 0) => {
    if (!positions.length) return;
    const im = new THREE.InstancedMesh(geo, mat, positions.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    positions.forEach((pos, i) => {
      const k = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      s.set(k * (0.8 + rng() * 0.4), k, k * (0.8 + rng() * 0.4));
      p.set(pos[0], pos[1] + yOffset * k, pos[2]);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  };
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  { const pos = rockGeo.attributes.position; for (let i = 0; i < pos.count; i++) { const k = 0.75 + rng() * 0.5; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k); } rockGeo.computeVertexNormals(); boxUV(rockGeo, 1.2); }
  const rockMat = material('rock', () => pbr('rock', { roughness: 0.95 }));
  const bushGeo = boxUV(new THREE.IcosahedronGeometry(1, 1), 1);
  if (ground === 'grass') {
    addInstanced(rockGeo, rockMat, place(70), [0.25, 0.7], -0.1);
    addInstanced(bushGeo, material('leaves', () => pbr('leaves', { roughness: 0.9 })), place(90), [0.45, 1.1], 0.3);
  } else if (ground === 'sand') {
    addInstanced(rockGeo, rockMat, place(90), [0.25, 0.8], -0.1);
    addInstanced(bushGeo, material('drybush', () => pbr('leaves', { color: 0xa89a62, roughness: 1 })), place(50), [0.35, 0.8], 0.25);
  } else if (ground === 'snow') {
    addInstanced(rockGeo, material('snowrock', () => pbr('rock', { color: 0xd8dde3, roughness: 0.95 })), place(80), [0.3, 0.9], -0.1);
    addInstanced(bushGeo, material('pinebush', () => pbr('pine', { roughness: 0.95 })), place(40), [0.4, 0.8], 0.25);
  } else {
    addInstanced(rbox(0.7, 0.35, 0.5, 0.03, 1, 1), material('concrete', () => pbr('concrete', { roughness: 0.92 })), place(60), [0.6, 1.3], 0.15);
    addInstanced(rockGeo, rockMat, place(30), [0.2, 0.45], -0.05);
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
  const post = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 12), 1), material('metal', () => pbr('metal', { roughness: 0.5, metalness: 0.65 })));
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
