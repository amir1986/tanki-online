// Map props: boxes, buildings, ramps, walls, rocks and trees.
import * as THREE from 'three';
import { Textures } from './textures.mjs';

const CONTAINER_TINTS = [0xb0413e, 0x2f6fb0, 0x3d8c40, 0xd08a2a];
const BUILDING_TINTS = [0xb9bcc2, 0xa8b4c0, 0xc9c0b0, 0x9fa8a3];
const matCache = new Map();

function material(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

/** BoxGeometry with per-face UV scaled so textures repeat per metre. */
function boxGeo(w, h, l, texSize = 2) {
  const g = new THREE.BoxGeometry(w, h, l);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const faceDims = [[l, h], [l, h], [w, l], [w, l], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = faceDims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * du / texSize, uv.getY(i) * dv / texSize);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function propMaterial(p) {
  switch (p.mat) {
    case 'concrete': return material('concrete', () => new THREE.MeshStandardMaterial({ map: Textures.get('concrete'), roughness: 0.9 }));
    case 'metal': return material('metal', () => new THREE.MeshStandardMaterial({ map: Textures.get('metal'), roughness: 0.55, metalness: 0.5 }));
    case 'crate': return material('crate', () => new THREE.MeshStandardMaterial({ map: Textures.get('crate'), roughness: 0.85 }));
    case 'container': return material('container' + (p.tint | 0), () => new THREE.MeshStandardMaterial({ map: Textures.get('container'), color: CONTAINER_TINTS[(p.tint | 0) % CONTAINER_TINTS.length], roughness: 0.6, metalness: 0.4 }));
    case 'brick': return material('brick', () => new THREE.MeshStandardMaterial({ map: Textures.get('brick'), roughness: 0.9 }));
    case 'building': return material('building' + (p.tint | 0), () => new THREE.MeshStandardMaterial({ map: Textures.get('building'), color: BUILDING_TINTS[(p.tint | 0) % BUILDING_TINTS.length], roughness: 0.8 }));
    case 'barrier': return material('barrier', () => new THREE.MeshStandardMaterial({ map: Textures.get('barrier'), roughness: 0.85 }));
    case 'bunker': return material('bunker', () => new THREE.MeshStandardMaterial({ map: Textures.get('bunker'), roughness: 0.9 }));
    case 'rock': return material('rock', () => new THREE.MeshStandardMaterial({ map: Textures.get('rock'), roughness: 0.95, flatShading: true }));
    default: return material('concrete', () => new THREE.MeshStandardMaterial({ map: Textures.get('concrete'), roughness: 0.9 }));
  }
}

function buildTree(p, theme) {
  const g = new THREE.Group();
  const s = p.tint || 1;
  const trunkH = 2.2 * s;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, trunkH, 7), material('bark', () => new THREE.MeshStandardMaterial({ map: Textures.get('bark'), roughness: 1 })));
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const pine = theme.ground === 'snow' || (theme.ground === 'grass' && (p.id % 3 === 0));
  if (pine) {
    const m = material('pine', () => new THREE.MeshStandardMaterial({ map: Textures.get('pine'), roughness: 0.9 }));
    for (let i = 0; i < 3; i++) {
      const r = (2.2 - i * 0.5) * s, h = 2.4 * s;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), m);
      cone.position.y = trunkH + i * 1.5 * s + h / 2 - 0.6 * s;
      cone.castShadow = true;
      g.add(cone);
    }
  } else {
    const m = material('leaves', () => new THREE.MeshStandardMaterial({ map: Textures.get('leaves'), roughness: 0.9 }));
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3 * s, 1), m);
    canopy.position.y = trunkH + 1.8 * s;
    canopy.scale.set(1, 0.85, 1);
    canopy.castShadow = true;
    g.add(canopy);
    const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 * s, 1), m);
    c2.position.set(0.9 * s, trunkH + 2.6 * s, 0.4 * s);
    c2.castShadow = true;
    g.add(c2);
  }
  g.position.set(p.pos[0], p.pos[1] - p.size[1] / 2, p.pos[2]);
  g.rotation.y = (p.id * 1.7) % Math.PI;
  return g;
}

export function buildProps(map) {
  const group = new THREE.Group();
  group.name = 'props';
  for (const p of map.props) {
    let mesh;
    if (p.kind === 'tree') { group.add(buildTree(p, map.theme)); continue; }
    if (p.kind === 'rock') {
      const geo = new THREE.DodecahedronGeometry(1, 1);
      // jitter vertices for a natural look
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.8 + 0.35 * Math.abs(Math.sin(i * 12.9898 + p.id * 78.233) * 43758.5453 % 1);
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      mesh = new THREE.Mesh(geo, propMaterial(p));
      mesh.scale.set(p.size[0] / 2, p.size[1] / 2 * 1.1, p.size[2] / 2);
    } else {
      const tex = p.kind === 'building' ? 3.2 : p.mat === 'crate' ? p.size[0] : p.mat === 'container' ? 2.6 : p.mat === 'barrier' ? 2.5 : 2;
      mesh = new THREE.Mesh(boxGeo(p.size[0], p.size[1], p.size[2], tex), propMaterial(p));
    }
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    mesh.castShadow = p.kind !== 'wall';
    mesh.receiveShadow = true;
    mesh.userData.prop = p;
    group.add(mesh);
    if (p.kind === 'building') {
      // roof edge + a rooftop box for silhouette variety
      const roof = new THREE.Mesh(boxGeo(p.size[0] * 0.3, 1.2, p.size[2] * 0.3, 2), propMaterial({ mat: 'concrete' }));
      roof.position.set(p.pos[0] + p.size[0] * 0.2, p.pos[1] + p.size[1] / 2 + 0.6, p.pos[2] - p.size[2] * 0.15);
      roof.castShadow = true;
      group.add(roof);
    }
  }
  return group;
}

/** Objective markers: flag bases and control point rings. */
export function buildFlagBase(pos, team) {
  const g = new THREE.Group();
  const color = team === 1 ? 0xe53935 : 0x1e88e5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.08, 32), new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.35 }));
  pad.position.y = 0.04;
  g.add(pad);
  g.position.set(pos[0], pos[1], pos[2]);
  return g;
}

export function buildFlag(team) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 }));
  pole.position.y = 1.6;
  g.add(pole);
  const clothGeo = new THREE.PlaneGeometry(1.6, 1.0, 8, 4);
  clothGeo.translate(0.8, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: Textures.get(team === 1 ? 'flagRed' : 'flagBlue'), side: THREE.DoubleSide, roughness: 0.8 }));
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 7, 48), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 7;
  g.add(beam);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x889099, metalness: 0.5, roughness: 0.5 }));
  post.position.y = 1.1;
  g.add(post);
  // label sprite
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(id, 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.4, 2.4, 1);
  sprite.position.y = 4.2;
  g.add(sprite);
  g.userData = { ring, beam, progress: null };
  // capture progress arc
  const prog = new THREE.Mesh(new THREE.RingGeometry(5.0, 5.5, 48, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  prog.rotation.x = -Math.PI / 2;
  prog.position.y = 0.1;
  g.add(prog);
  g.userData.progress = prog;
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
    prog.geometry = new THREE.RingGeometry(5.0, 5.5, 48, 1, 0, len);
    prog.userData.len = len;
  }
}
