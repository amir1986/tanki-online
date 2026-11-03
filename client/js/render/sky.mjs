// Physically based sky (atmospheric scattering), image based lighting, sun light with shadows, haze.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Textures } from './textures.mjs';

export function buildSky(theme, scene, renderer) {
  const sun = new THREE.Vector3(...theme.sun).normalize();
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = theme.turbidity ?? 6;
  u.rayleigh.value = theme.rayleigh ?? 2;
  u.mieCoefficient.value = theme.mie ?? 0.005;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sun);
  // scale the sky radiance down so it tone-maps to natural blues and stays under the bloom threshold
  u.skyScale = { value: theme.skyScale ?? 0.42 };
  sky.material.fragmentShader = 'uniform float skyScale;\n' + sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyScale, 1.0 );');
  sky.material.needsUpdate = true;
  sky.renderOrder = -1000;
  sky.frustumCulled = false;

  // image based lighting from the same sky
  let envTarget = null;
  if (renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(sky);
      envTarget = pmrem.fromScene(envScene, 0.04);
      envScene.remove(sky);
      pmrem.dispose();
      scene.environment = envTarget.texture;
      scene.environmentIntensity = (theme.envIntensity ?? 0.55) * 1.8;
    } catch (e) { console.warn('environment map failed', e); }
  }
  scene.add(sky);
  scene.background = null;
  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fogDensity ?? 0.003);

  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], 0.22);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(theme.sunColor || 0xfff4e0, theme.sunIntensity ?? 3.0);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 420;
  const S = 70;
  dir.shadow.camera.left = -S; dir.shadow.camera.right = S; dir.shadow.camera.top = S; dir.shadow.camera.bottom = -S;
  dir.shadow.camera.updateProjectionMatrix();
  dir.shadow.bias = -0.00035;
  dir.shadow.normalBias = 0.05;
  dir.shadow.radius = 3;
  const target = new THREE.Object3D();
  scene.add(target);
  dir.target = target;
  scene.add(dir);

  // sun glare sprite
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.get('glare'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: 0.85 }));
  glare.scale.set(260, 260, 1);
  glare.renderOrder = -999;
  scene.add(glare);

  // procedural cloud layer: a large disc high above the map, slowly drifting
  const cloudTex = Textures.get('clouds');
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: theme.cloudOpacity ?? 0.75, side: THREE.DoubleSide });
  const clouds = new THREE.Mesh(new THREE.CircleGeometry(2600, 48), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 420;
  clouds.renderOrder = -998;
  clouds.frustumCulled = false;
  cloudTex.repeat.set(6, 6);
  scene.add(clouds);

  return {
    sky, dir, hemi, sun, glare,
    setShadowQuality(level) {
      const size = level === 0 ? 0 : level === 1 ? 1024 : level === 2 ? 2048 : 4096;
      dir.castShadow = size > 0;
      if (size > 0 && dir.shadow.mapSize.x !== size) {
        dir.shadow.mapSize.set(size, size);
        if (dir.shadow.map) { dir.shadow.map.dispose(); dir.shadow.map = null; }
      }
    },
    update(camera, focus) {
      sky.position.copy(camera.position);
      glare.position.copy(camera.position).addScaledVector(sun, 900);
      const f = focus || camera.position;
      const texel = (S * 2) / dir.shadow.mapSize.x;
      const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
      target.position.set(fx, f.y, fz);
      dir.position.set(fx + sun.x * 200, f.y + sun.y * 200, fz + sun.z * 200);
      target.updateMatrixWorld();
    },
    dispose() {
      if (envTarget) envTarget.dispose();
      scene.environment = null;
      sky.material.dispose();
      sky.geometry.dispose();
    },
  };
}
