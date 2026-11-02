// Sky dome, sun, hemisphere light and fog for a map theme.
import * as THREE from 'three';

const vert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // push to far plane
  }
`;
const frag = /* glsl */`
  uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col;
    if (h > 0.0) {
      float t = pow(clamp(h, 0.0, 1.0), 0.55);
      col = mix(horizon, top, t);
    } else {
      col = mix(horizon, ground, clamp(-h * 4.0, 0.0, 1.0));
    }
    float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.05);
    // faint cloud band
    float cl = smoothstep(0.02, 0.35, h) * (1.0 - smoothstep(0.35, 0.9, h));
    col = mix(col, col * 1.05 + 0.03, cl * 0.4);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function buildSky(theme, scene) {
  const sun = new THREE.Vector3(...theme.sun).normalize();
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(theme.sky.top) },
      horizon: { value: new THREE.Color(theme.sky.horizon) },
      ground: { value: new THREE.Color(theme.sky.ground) },
      sunDir: { value: sun.clone() },
      sunColor: { value: new THREE.Color(theme.sunColor || 0xffffff) },
    },
    vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.scale.setScalar(500);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  scene.background = new THREE.Color(theme.sky.horizon);

  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemiIntensity || 0.8);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(theme.sunColor || 0xffffff, theme.sunIntensity || 2);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 400;
  const S = 75;
  dir.shadow.camera.left = -S; dir.shadow.camera.right = S; dir.shadow.camera.top = S; dir.shadow.camera.bottom = -S;
  dir.shadow.bias = -0.0006;
  dir.shadow.normalBias = 0.03;
  const target = new THREE.Object3D();
  scene.add(target);
  dir.target = target;
  scene.add(dir);

  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  return {
    dome, dir, hemi, sun,
    setShadowQuality(level) {
      const size = level === 0 ? 0 : level === 1 ? 1024 : level === 2 ? 2048 : 4096;
      dir.castShadow = size > 0;
      if (size > 0 && dir.shadow.mapSize.x !== size) {
        dir.shadow.mapSize.set(size, size);
        if (dir.shadow.map) { dir.shadow.map.dispose(); dir.shadow.map = null; }
      }
    },
    update(camera, focus) {
      dome.position.copy(camera.position);
      // keep the shadow frustum centred on the focus point, snapped to texels to avoid shimmer
      const f = focus || camera.position;
      const texel = (S * 2) / dir.shadow.mapSize.x;
      const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
      target.position.set(fx, f.y, fz);
      dir.position.set(fx + sun.x * 180, f.y + sun.y * 180, fz + sun.z * 180);
      target.updateMatrixWorld();
    },
  };
}
