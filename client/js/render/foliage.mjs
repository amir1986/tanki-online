// Blade grass: instanced three-blade clumps in 10 m chunks streamed around the camera, GPU wind, blades pushed
// aside by the player's tank. Colours are derived from the ground texture so the grass matches the terrain.
import * as THREE from 'three';
import { terrainBlend } from './terrain.mjs';
import { getNav } from '/shared/sim/nav.mjs';
import { seeded } from './geo.mjs';
import { Assets } from './assets.mjs';

const CHUNK = 10;
const VIEW = 64;
const NEAR = 30;

/** Three tapered blades in a star, pivot at the base, 1 m tall. Attribute `bh` = normalized height. */
function clumpGeometry() {
  const pos = [], uv = [], bh = [], idx = [];
  const segs = 3;
  let base = 0;
  for (let k = 0; k < 3; k++) {
    const ang = k * (Math.PI / 3) + 0.2, lean = 0.12 + k * 0.08;
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.02 * (1 - t * t * 0.9);
      const y = t, bendOut = lean * t * t;
      // blade lies in the plane spanned by (c, s) horizontally; bend outward along (-s, c)
      const ox = -s * bendOut, oz = c * bendOut;
      pos.push(-w * c + ox, y, -w * s + oz, w * c + ox, y, w * s + oz);
      uv.push(0, t, 1, t);
      bh.push(t, t);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    base += (segs + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('bh', new THREE.Float32BufferAttribute(bh, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function grassMaterial(colorBase, colorTip, windStrength) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = { value: 0 };
    shader.uniforms.player = { value: new THREE.Vector3(0, -100, 0) };
    shader.uniforms.windDir = { value: new THREE.Vector2(0.7, 0.4) };
    shader.uniforms.windStrength = { value: windStrength };
    shader.uniforms.colorBase = { value: colorBase };
    shader.uniforms.colorTip = { value: colorTip };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float bh;
        uniform float time; uniform vec3 player; uniform vec2 windDir; uniform float windStrength; uniform vec3 colorBase; uniform vec3 colorTip;
        varying vec3 vGrassColor;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( mix( vec3( normal ), vec3( 0.0, 1.0, 0.0 ), 0.78 ) );')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float tint = 0.82 + 0.36 * fract( sin( instanceMatrix[3][0] * 12.9898 + instanceMatrix[3][2] * 78.233 ) * 43758.5453 );
        #else
          float tint = 1.0;
        #endif
        vec4 wPos = modelMatrix * mvPosition;
        float bend = bh * bh;
        float ph = wPos.x * 0.35 + wPos.z * 0.27;
        float gust = sin( time * 1.3 + ph ) * 0.6 + sin( time * 2.9 + ph * 1.7 + wPos.z * 0.2 ) * 0.4;
        wPos.xz += normalize( windDir ) * ( 0.1 + 0.16 * gust ) * bend * windStrength;
        vec2 toP = wPos.xz - player.xz;
        float pd = length( toP );
        float push = smoothstep( 2.6, 0.6, pd ) * bend;
        if ( pd > 0.001 ) wPos.xz += ( toP / pd ) * push * 0.9;
        wPos.y -= push * 0.3;
        mvPosition = viewMatrix * wPos;
        gl_Position = projectionMatrix * mvPosition;
        vGrassColor = mix( colorBase, colorTip, bh ) * tint;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassColor;');
  };
  mat.customProgramCacheKey = () => 'bladeGrass';
  return mat;
}

/**
 * Streaming blade grass for a map. Returns a Group with `userData.update(dt, camPos, playerPos)`.
 * quality: density multiplier (1 = high).
 */
export function buildFoliage(map, quality = 1) {
  const group = new THREE.Group();
  group.name = 'foliage';
  const ground = map.theme.ground;
  const noop = () => {};
  if (ground !== 'grass' && ground !== 'sand') { group.userData.update = noop; return group; }
  const nav = getNav(map);
  const geo = clumpGeometry();
  let density, base, tip, hRange, accept, wind;
  if (ground === 'grass') {
    const avg = Assets.averageColor('grass', 0x4d6b2a);
    base = avg.clone().multiplyScalar(0.42);
    tip = avg.clone().multiplyScalar(1.08).lerp(new THREE.Color(0xcfd08a), 0.12);
    density = 16 * quality; hRange = [0.14, 0.34]; wind = 1;
    accept = (b) => b.dirt < 0.45 && b.rock < 0.35;
  } else {
    base = new THREE.Color(0x6e5f3a); tip = new THREE.Color(0xcfc08a);
    density = 2.4 * quality; hRange = [0.1, 0.26]; wind = 0.7;
    accept = (b) => b.rock < 0.3 && b.n2 > 0.47;
  }
  const mat = grassMaterial(base, tip, wind);
  const chunks = new Map();
  const halfW = map.halfW - 2, halfL = map.halfL - 2;
  const nx = Math.ceil(halfW * 2 / CHUNK), nz = Math.ceil(halfL * 2 / CHUNK);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  const makeChunk = (ix, iz) => {
    const rng = seeded(ix * 7919 + iz * 104729 + map.nx);
    const x0 = -halfW + ix * CHUNK, z0 = -halfL + iz * CHUNK;
    const count = Math.round(density * CHUNK * CHUNK);
    const near = [], far = [];
    for (let i = 0; i < count; i++) {
      const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK;
      if (Math.abs(x) > halfW || Math.abs(z) > halfL || nav.isBlocked(x, z)) continue;
      const b = terrainBlend(map, x, z);
      if (!accept(b)) continue;
      if (rng() > 0.25 + 0.75 * b.n2) continue; // patchy density with bare spots
      const h = hRange[0] + rng() * (hRange[1] - hRange[0]);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      s.set(0.85 + rng() * 0.4, h, 0.85 + rng() * 0.4);
      p.set(x, map.heightAt(x, z) - 0.02, z);
      m.compose(p, q, s);
      (i % 4 === 0 ? far : near).push(m.clone());
    }
    const make = (list) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.visible = false;
      group.add(im);
      return im;
    };
    const c = { near: make(near), far: make(far), cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2 };
    chunks.set(ix + ',' + iz, c);
    return c;
  };

  let time = 0;
  group.userData.update = (dt, camPos, playerPos) => {
    time += dt;
    const sh = mat.userData.shader;
    if (sh) { sh.uniforms.time.value = time; if (playerPos) sh.uniforms.player.value.copy(playerPos); }
    if (!camPos) return;
    let budget = 3;
    const r = Math.ceil(VIEW / CHUNK);
    const cix = Math.floor((camPos.x + halfW) / CHUNK), ciz = Math.floor((camPos.z + halfL) / CHUNK);
    for (const c of chunks.values()) { if (c.near) c.near.visible = false; if (c.far) c.far.visible = false; }
    for (let iz = ciz - r; iz <= ciz + r; iz++) {
      for (let ix = cix - r; ix <= cix + r; ix++) {
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        const cx = -halfW + ix * CHUNK + CHUNK / 2, cz = -halfL + iz * CHUNK + CHUNK / 2;
        const d = Math.hypot(cx - camPos.x, cz - camPos.z);
        if (d > VIEW) continue;
        let c = chunks.get(ix + ',' + iz);
        if (!c) { if (budget-- <= 0) continue; c = makeChunk(ix, iz); }
        if (c.far) c.far.visible = true;
        if (c.near) c.near.visible = d < NEAR;
      }
    }
  };
  group.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return group;
}
