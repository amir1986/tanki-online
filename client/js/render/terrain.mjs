// Terrain mesh built from the shared heightfield, shaded with three blended PBR layers (base / dirt / rock)
// from scanned CC0 texture sets, with macro variation to hide tiling.
import * as THREE from 'three';
import { Textures } from './textures.mjs';
import { fbm } from '/shared/noise.mjs';

export const THEMES = {
  grass: { base: 'grass', dirt: 'dirt', rock: 'rockMoss', scale: 3.2, dirtScale: 3.4, rockScale: 4.6, tint: [0xffffff, 0xe3e6d6], rockSlope: [0.32, 0.72], patch: 0.6 },
  sand: { base: 'sand', dirt: 'dirtDry', rock: 'rock', scale: 3.4, dirtScale: 3.4, rockScale: 4.6, tint: [0xffffff, 0xece4d2], rockSlope: [0.5, 0.9], patch: 0.72 },
  snow: { base: 'snow', dirt: 'snowDirty', rock: 'rock', scale: 3.6, dirtScale: 3.6, rockScale: 4.6, tint: [0xffffff, 0xeef2f6], rockSlope: [0.3, 0.6], patch: 0.9 },
  asphalt: { base: 'asphaltDark', dirt: 'gravel', rock: 'concrete', scale: 4.2, dirtScale: 3.2, rockScale: 3.5, tint: [0xffffff, 0xe0e0e0], rockSlope: [0.6, 0.95], patch: 0.78 },
};

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function roadMaskFor(map) {
  const roads = map.theme.roads || [];
  return (x, z) => {
    let m = 0;
    for (const r of roads) {
      const ax = r.a[0], az = r.a[1], bx = r.b[0], bz = r.b[1];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      m = Math.max(m, 1 - Math.min(1, Math.max(0, (d - r.w * 0.5) / (r.w * 0.5))));
    }
    return m;
  };
}

/** Layer weights at a world position: { dirt, rock, slope, n2 } — shared by the terrain shader and foliage scatter. */
export function terrainBlend(map, x, z, roadMask = roadMaskFor(map)) {
  const theme = THEMES[map.theme.ground] || THEMES.grass;
  const cell = map.cell;
  const hx = map.heightAt(Math.min(map.halfW - 0.01, x + cell), z) - map.heightAt(Math.max(-map.halfW + 0.01, x - cell), z);
  const hz = map.heightAt(x, Math.min(map.halfL - 0.01, z + cell)) - map.heightAt(x, Math.max(-map.halfL + 0.01, z - cell));
  const slope = Math.hypot(hx, hz) / (2 * cell);
  const rock = smooth(theme.rockSlope[0], theme.rockSlope[1], slope);
  const n = fbm(x / 21 + 7, z / 21 + 3, 900, 3);
  const n2 = fbm(x / 7 + 1, z / 7 + 9, 901, 2);
  let dirt = smooth(theme.patch, theme.patch + 0.12, n * 0.75 + n2 * 0.25) * (1 - rock);
  dirt = Math.max(dirt, roadMask(x, z) * (1 - rock));
  return { dirt, rock, slope, n2 };
}

export function buildTerrain(map) {
  const theme = THEMES[map.theme.ground] || THEMES.grass;
  const base = Textures.ground(theme.base);
  const dirt = theme.dirt === 'concrete' ? Textures.prop('concrete') : Textures.ground(theme.dirt);
  const rock = theme.rock === 'concrete' ? Textures.prop('concrete') : Textures.ground(theme.rock);
  const { nx, nz, cell, halfW, halfL } = map;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const blend = new Float32Array(nx * nz * 2);
  const ca = new THREE.Color(theme.tint[0]), cb = new THREE.Color(theme.tint[1]);
  const tmp = new THREE.Color();
  const roadMask = roadMaskFor(map);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = -halfW + i * cell, z = -halfL + j * cell;
      const y = map.heightAt(x, z);
      positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
      uvs[k * 2] = x / theme.scale; uvs[k * 2 + 1] = z / theme.scale;
      const b = terrainBlend(map, x, z, roadMask);
      blend[k * 2] = b.dirt; blend[k * 2 + 1] = b.rock;
      tmp.copy(ca).lerp(cb, fbm(x / 33 + 5, z / 33 + 2, 902, 2));
      const v = 0.95 + 0.1 * b.n2;
      colors[k * 3] = tmp.r * v; colors[k * 3 + 1] = tmp.g * v; colors[k * 3 + 2] = tmp.b * v;
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('blend', new THREE.BufferAttribute(blend, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    map: base.map, normalMap: base.normal, normalScale: new THREE.Vector2(1, 1), vertexColors: true,
    roughness: 1, roughnessMap: base.rough || null, aoMap: base.ao || null, aoMapIntensity: 0.8, metalness: 0.0,
  });
  const uvMul2 = theme.scale / theme.dirtScale, uvMul3 = theme.scale / theme.rockScale;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.map2 = { value: dirt.map };
    shader.uniforms.normalMap2 = { value: dirt.normal };
    shader.uniforms.map3 = { value: rock.map };
    shader.uniforms.normalMap3 = { value: rock.normal };
    shader.uniforms.uvMul2 = { value: uvMul2 };
    shader.uniforms.uvMul3 = { value: uvMul3 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 blend;\nvarying vec2 vBlend;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBlend = blend;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D map2; uniform sampler2D normalMap2; uniform sampler2D map3; uniform sampler2D normalMap3; uniform float uvMul2; uniform float uvMul3; varying vec2 vBlend;')
      .replace('#include <map_fragment>', `
        vec4 c1 = texture2D( map, vMapUv );
        vec4 c2 = texture2D( map2, vMapUv * uvMul2 );
        vec4 c3 = texture2D( map3, vMapUv * uvMul3 );
        vec4 sampledDiffuseColor = mix( mix( c1, c2, vBlend.x ), c3, vBlend.y );
        float macro = texture2D( map, vMapUv * 0.047 ).g;
        float macro2 = texture2D( map2, vMapUv * 0.013 + 0.37 ).r;
        sampledDiffuseColor.rgb *= ( 0.86 + 0.28 * macro ) * ( 0.92 + 0.16 * macro2 );
        diffuseColor *= sampledDiffuseColor;
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 n1 = texture2D( normalMap, vNormalMapUv ).xyz;
        vec3 n2 = texture2D( normalMap2, vNormalMapUv * uvMul2 ).xyz;
        vec3 n3 = texture2D( normalMap3, vNormalMapUv * uvMul3 ).xyz;
        vec3 mapN = mix( mix( n1, n2, vBlend.x ), n3, vBlend.y ) * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
      `);
  };
  mat.customProgramCacheKey = () => 'terrain3layer' + (base.rough ? 'R' : '') + (base.ao ? 'A' : '');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';

  // ground skirt beyond the walls
  const skirtGeo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  skirtGeo.rotateX(-Math.PI / 2);
  const skirtMap = base.map.clone(); skirtMap.repeat.set(2400 / theme.scale, 2400 / theme.scale); skirtMap.needsUpdate = true;
  const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: 0xb5b5b5, map: skirtMap, roughness: 1 }));
  skirt.position.y = map.minH - 0.8;
  skirt.receiveShadow = true;
  skirt.name = 'skirt';
  const group = new THREE.Group();
  group.add(skirt, mesh);
  return group;
}
