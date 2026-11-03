// Asset loading: CC0 PBR texture sets (ambientCG), HDRI skies (Poly Haven) and glTF models (Poly Haven props,
// OpenGameArt tank). Everything is cached. Call `preloadSets()` / `hdri()` / `models()` and then `ready()` before
// building a scene so that materials never render with half-loaded textures.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = '/client/assets';
const texLoader = new THREE.TextureLoader();
const rgbeLoader = new RGBELoader().setDataType(THREE.HalfFloatType);
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

let texIndex = null, modelIndex = null;
const sets = new Map();
const hdris = new Map();
const models = new Map();
const loadedModels = new Map();
const pending = new Set();
let aniso = 8;

function track(p) { pending.add(p); p.finally(() => pending.delete(p)); return p; }

function loadTex(url, srgb) {
  let done;
  const p = new Promise((res) => { done = res; });
  const t = texLoader.load(url, () => done(t), undefined, () => { console.warn('[assets] missing texture', url); done(t); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  track(p);
  return t;
}

/** Sun direction, sun colour, horizon and zenith colours of an equirectangular HDRI (half float RGBA data). */
function analyzeHdri(tex) {
  const { data, width: w, height: h } = tex.image;
  const half = THREE.DataUtils.fromHalfFloat;
  const ch = data.length / (w * h);
  const lum = (i) => 0.2126 * half(data[i]) + 0.7152 * half(data[i + 1]) + 0.0722 * half(data[i + 2]);
  let max = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const l = lum((y * w + x) * ch); if (l > max) max = l; }
  const sunAcc = new THREE.Vector3(), sunCol = new THREE.Color(0, 0, 0), horizon = new THREE.Color(0, 0, 0), zenith = new THREE.Color(0, 0, 0);
  let sunN = 0, horN = 0, zenN = 0;
  const dir = new THREE.Vector3();
  const flip = tex.flipY !== false; // row 0 is the top of the picture
  for (let y = 0; y < h; y++) {
    const v = flip ? 1 - (y + 0.5) / h : (y + 0.5) / h;
    const theta = (v - 0.5) * Math.PI;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const l = lum(i);
      if (l > max * 0.5) {
        const u = (x + 0.5) / w, phi = (u - 0.5) * Math.PI * 2;
        dir.set(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
        sunAcc.addScaledVector(dir, l); sunN += l;
        sunCol.r += half(data[i]); sunCol.g += half(data[i + 1]); sunCol.b += half(data[i + 2]);
      }
      if (v > 0.5 && v < 0.56 && (x & 3) === 0) { horizon.r += half(data[i]); horizon.g += half(data[i + 1]); horizon.b += half(data[i + 2]); horN++; }
      if (v > 0.88 && (x & 7) === 0) { zenith.r += half(data[i]); zenith.g += half(data[i + 1]); zenith.b += half(data[i + 2]); zenN++; }
    }
  }
  const sun = sunN > 0 ? sunAcc.divideScalar(sunN).normalize() : new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  if (sunN > 0) { const m = Math.max(sunCol.r, sunCol.g, sunCol.b) || 1; sunCol.multiplyScalar(1 / m); } else sunCol.setHex(0xfff2dc);
  if (horN) horizon.multiplyScalar(1 / horN);
  if (zenN) zenith.multiplyScalar(1 / zenN);
  // the fog colour is the tone-mapped horizon: compress the HDR value into a display-friendly range
  const toDisplay = (c) => { const k = 1 / (1 + Math.max(c.r, c.g, c.b) * 0.8); return new THREE.Color(c.r * k, c.g * k, c.b * k); };
  return { sun, sunColor: sunCol, horizon: toDisplay(horizon), zenith: toDisplay(zenith), maxLum: max };
}

/** For each mesh in a model, an InstancedMesh carrying `matrices` (pre-multiplied by the mesh's local transform). */
export function instanceModel(model, matrices, { castShadow = true, receiveShadow = true } = {}) {
  const group = new THREE.Group();
  if (!model || !matrices.length) return group;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const tmp = new THREE.Matrix4();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    for (let i = 0; i < matrices.length; i++) { tmp.multiplyMatrices(matrices[i], local); im.setMatrixAt(i, tmp); }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = castShadow; im.receiveShadow = receiveShadow;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

/** Bounding box of a model in its own space. */
export function modelBounds(model) {
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model);
}

export const Assets = {
  async init(renderer) {
    if (renderer) aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const [ti, mi] = await Promise.all([
      fetch(`${BASE}/textures/index.json`).then((r) => r.json()).catch(() => ({})),
      fetch(`${BASE}/models/index.json`).then((r) => r.json()).catch(() => ({})),
    ]);
    texIndex = ti; modelIndex = mi;
    return this;
  },
  has(name) { return !!(texIndex && texIndex[name]); },
  /** PBR set { map, normal, rough, ao, metal } (entries null when that map does not exist). */
  set(name) {
    if (!this.has(name)) return null;
    if (sets.has(name)) return sets.get(name);
    const maps = texIndex[name].maps;
    const dir = `${BASE}/textures/${name}`;
    const s = {
      name,
      map: loadTex(`${dir}/color.jpg`, true),
      normal: maps.includes('normal') ? loadTex(`${dir}/normal.jpg`, false) : null,
      rough: maps.includes('rough') ? loadTex(`${dir}/rough.jpg`, false) : null,
      ao: maps.includes('ao') ? loadTex(`${dir}/ao.jpg`, false) : null,
      metal: maps.includes('metal') ? loadTex(`${dir}/metal.jpg`, false) : null,
    };
    sets.set(name, s);
    return s;
  },
  /** Start loading the named sets (unknown names are ignored). */
  preloadSets(names) { for (const n of names) this.set(n); return this.ready(); },
  /** MeshStandardMaterial (or Physical) with every available map of a set wired in. */
  material(name, { color = 0xffffff, roughness = 1, metalness = null, physical = false, normalScale = 1, ...extra } = {}) {
    const s = this.set(name);
    const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    if (!s) return new M({ color, roughness, metalness: metalness ?? 0, ...extra });
    const m = new M({
      color, map: s.map, normalMap: s.normal, normalScale: new THREE.Vector2(normalScale, normalScale),
      roughnessMap: s.rough, roughness, aoMap: s.ao, aoMapIntensity: 1,
      metalnessMap: s.metal, metalness: metalness ?? (s.metal ? 1 : 0), ...extra,
    });
    return m;
  },
  /** Average display colour of a set's colour map (after it loaded). */
  averageColor(name, fallback = 0x808080) {
    const s = this.set(name);
    const img = s && s.map && s.map.image;
    if (!img || !img.width) return new THREE.Color(fallback);
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  },
  hdri(id) {
    if (!hdris.has(id)) {
      hdris.set(id, rgbeLoader.loadAsync(`${BASE}/hdri/${id}.hdr`).then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const info = analyzeHdri(tex);
        if (info.sun.y < 0) info.sun.y = Math.abs(info.sun.y); // row order guard
        return { id, texture: tex, ...info };
      }));
    }
    return hdris.get(id);
  },
  model(id) {
    if (!models.has(id)) {
      models.set(id, gltfLoader.loadAsync(`${BASE}/models/${id}.glb`).then((g) => {
        const s = g.scene;
        s.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) { if (m.map) m.map.anisotropy = aniso; }
          }
        });
        s.userData.id = id;
        loadedModels.set(id, s);
        return s;
      }).catch((e) => { console.warn('[assets] model failed', id, e.message || e); loadedModels.set(id, null); return null; }));
    }
    return models.get(id);
  },
  async models(ids) { await Promise.all(ids.map((id) => this.model(id))); },
  /** Loaded model root (null until `model(id)` resolved). Clone before adding to a scene. */
  modelSync(id) { return loadedModels.get(id) || null; },
  modelInfo(id) { return (modelIndex && modelIndex[id]) || null; },
  async ready() { while (pending.size) await Promise.all([...pending]); },
};
