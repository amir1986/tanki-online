// Terrain mesh built from the shared map heightfield (same grid as the physics).
import * as THREE from 'three';
import { Textures } from './textures.mjs';
import { fbm } from '/shared/noise.mjs';

const THEME_COLORS = {
  grass: { a: 0x8fbf63, b: 0x5f8f3e, slope: 0x7a6a4a, tex: 'grass' },
  sand: { a: 0xe6d3a3, b: 0xc8b283, slope: 0xa58c5c, tex: 'sand' },
  snow: { a: 0xffffff, b: 0xd9e3ec, slope: 0x7f8a95, tex: 'snow' },
  asphalt: { a: 0x8f949a, b: 0x6d7278, slope: 0x55595e, tex: 'asphalt' },
};

export function buildTerrain(map) {
  const theme = THEME_COLORS[map.theme.ground] || THEME_COLORS.grass;
  const { nx, nz, cell, halfW, halfL } = map;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const ca = new THREE.Color(theme.a), cb = new THREE.Color(theme.b), cs = new THREE.Color(theme.slope);
  const tmp = new THREE.Color();
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = -halfW + i * cell, z = -halfL + j * cell;
      const y = map.heightAt(x, z);
      positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
      uvs[k * 2] = x / 7; uvs[k * 2 + 1] = z / 7;
      // slope from neighbours
      const hx = map.heightAt(Math.min(halfW - 0.01, x + cell), z) - map.heightAt(Math.max(-halfW + 0.01, x - cell), z);
      const hz = map.heightAt(x, Math.min(halfL - 0.01, z + cell)) - map.heightAt(x, Math.max(-halfL + 0.01, z - cell));
      const slope = Math.min(1, Math.hypot(hx, hz) / (2 * cell) * 1.6);
      const n = fbm(x / 23 + 7, z / 23 + 3, 900, 3);
      tmp.copy(ca).lerp(cb, n).lerp(cs, slope * slope);
      // subtle brightness variation
      const v = 0.9 + 0.2 * fbm(x / 5, z / 5, 901, 2);
      colors[k * 3] = tmp.r * v; colors[k * 3 + 1] = tmp.g * v; colors[k * 3 + 2] = tmp.b * v;
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
      // same diagonal split as cannon's heightfield (C-B diagonal)
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: Textures.get(theme.tex), vertexColors: true, roughness: 0.96, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';

  // ground skirt beyond the walls so the horizon isn't empty
  const skirtGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
  skirtGeo.rotateX(-Math.PI / 2);
  const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.b).multiplyScalar(0.9), map: Textures.get(theme.tex), roughness: 1 }));
  skirt.material.map = skirt.material.map.clone();
  skirt.material.map.repeat.set(140, 140);
  skirt.material.map.needsUpdate = true;
  skirt.position.y = map.minH - 0.6;
  skirt.receiveShadow = true;
  const group = new THREE.Group();
  group.add(skirt, mesh);
  return group;
}
