// HDRI sky: the equirectangular sky photograph (Poly Haven, CC0) is both the background and, prefiltered with
// PMREM, the image based lighting. A shadow casting sun is placed along the brightest direction of the image and
// the fog takes the colour of its horizon, so lighting, sky and haze always agree.
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { Textures } from './textures.mjs';

export const HDRI_FOR = {
  sandbox: 'qwantani_noon_puresky', polygon: 'kloofendal_48d_partly_cloudy_puresky', silence: 'kloofendal_overcast_puresky',
  kungur: 'snow_field_puresky', ruins: 'belfast_sunset_puresky', canyon: 'qwantani_sunset_puresky', frontier: 'farm_field_puresky',
  arena: 'industrial_sunset_puresky', oasis: 'qwantani_noon_puresky', highland: 'snow_field_puresky',
  forest: 'kloofendal_48d_partly_cloudy_puresky', factory: 'kloofendal_overcast_puresky', showroom: 'qwantani_sunset_puresky',
};
const GROUND_SKY = { grass: 'kloofendal_48d_partly_cloudy_puresky', sand: 'qwantani_noon_puresky', snow: 'snow_field_puresky', asphalt: 'kloofendal_overcast_puresky' };
export function skyFor(map) {
  if (map && map.theme && map.theme.hdri) return map.theme.hdri;
  return (map && HDRI_FOR[map.id]) || GROUND_SKY[map && map.theme && map.theme.ground] || GROUND_SKY.grass;
}

export function buildSky(theme, scene, renderer, hdri) {
  const overcast = /overcast|snow_field|mud_road|misty/.test(hdri.id);
  const sunset = /sunset|dusk|dawn|sunrise|belfast/.test(hdri.id);
  const sun = hdri.sun.clone();
  if (sun.y < 0.14) { sun.y = 0.14; sun.normalize(); } // keep shadows usable for low suns

  // image based lighting + background
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTarget = pmrem.fromEquirectangular(hdri.texture);
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = theme.envIntensity ?? (overcast ? 1.0 : 0.9);
  scene.background = hdri.texture;
  scene.backgroundIntensity = theme.skyIntensity ?? 1.0;
  scene.backgroundBlurriness = 0;
  scene.fog = new THREE.FogExp2(hdri.horizon.clone(), theme.fogDensity ?? (overcast ? 0.0032 : 0.0022));

  const hemi = new THREE.HemisphereLight(hdri.zenith, hdri.horizon.clone().multiplyScalar(0.45), overcast ? 0.25 : 0.12);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(hdri.sunColor, theme.sunIntensity ?? (overcast ? 0.55 : sunset ? 1.7 : 2.4));
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 420;
  const S = 70;
  dir.shadow.camera.left = -S; dir.shadow.camera.right = S; dir.shadow.camera.top = S; dir.shadow.camera.bottom = -S;
  dir.shadow.camera.updateProjectionMatrix();
  dir.shadow.bias = -0.0003;
  dir.shadow.normalBias = 0.04;
  dir.shadow.radius = 2.5;
  const target = new THREE.Object3D();
  scene.add(target);
  dir.target = target;
  scene.add(dir);
  if (!overcast) {
    try {
      const flare = new Lensflare();
      const soft = Textures.get('particle');
      flare.addElement(new LensflareElement(Textures.get('glare'), sunset ? 260 : 340, 0, new THREE.Color(0xfff0d0)));
      flare.addElement(new LensflareElement(soft, 60, 0.55, new THREE.Color(0xffd9a0)));
      flare.addElement(new LensflareElement(soft, 90, 0.7, new THREE.Color(0xa0c8ff)));
      flare.addElement(new LensflareElement(soft, 40, 0.9, new THREE.Color(0xffb080)));
      flare.addElement(new LensflareElement(soft, 130, 1.0, new THREE.Color(0xb0d0ff)));
      dir.add(flare);
    } catch (e) { /* flare is optional */ }
  }

  return {
    dir, hemi, sun, hdri,
    setShadowQuality(level) {
      const size = level === 0 ? 0 : level === 1 ? 1024 : level === 2 ? 2048 : 4096;
      dir.castShadow = size > 0;
      if (size > 0 && dir.shadow.mapSize.x !== size) {
        dir.shadow.mapSize.set(size, size);
        if (dir.shadow.map) { dir.shadow.map.dispose(); dir.shadow.map = null; }
      }
    },
    update(camera, focus) {
      const f = focus || camera.position;
      const texel = (S * 2) / dir.shadow.mapSize.x;
      const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
      target.position.set(fx, f.y, fz);
      dir.position.set(fx + sun.x * 200, f.y + sun.y * 200, fz + sun.z * 200);
      target.updateMatrixWorld();
    },
    dispose() {
      envTarget.dispose();
      scene.environment = null;
      scene.background = null;
    },
  };
}
