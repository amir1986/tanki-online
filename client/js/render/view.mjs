// Renderer / scene / camera wrapper: AgX tone mapping, shadows, MSAA post pipeline with ambient occlusion,
// post-tonemap bloom (so bright terrain never washes out), a film grading pass and a CSS2D layer for nameplates.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) }, vignette: { value: 0.32 }, grain: { value: 0.0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution; uniform float vignette; uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.08);                 // saturation
      col = (col - 0.5) * 1.05 + 0.5;                 // contrast
      col += vec3(0.012, 0.005, -0.008) * l;          // warm highlights
      col -= vec3(0.0, 0.003, 0.009) * (1.0 - l);     // cool shadows
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * vignette;
      col += (hash(vUv * resolution + fract(time) * 100.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.15, 3000);
    this.camera.position.set(0, 6, -12);
    this.scale = 1;
    this.bloomEnabled = false;
    this.ao = false;
    this.composer = null;
    this.gtao = null;
    this.bloomPass = null;
    this.filmPass = null;
    this.time = 0;
    // DOM layer for nameplates (CSS2DRenderer): sits between the canvas and the HUD
    this.labels = new CSS2DRenderer();
    const le = this.labels.domElement;
    le.id = 'labels';
    le.style.position = 'fixed';
    le.style.inset = '0';
    le.style.pointerEvents = 'none';
    le.style.overflow = 'hidden';
    const ui = document.getElementById('ui');
    if (ui) document.body.insertBefore(le, ui); else document.body.appendChild(le);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality({ scale = 1, shadows = 2, bloom = false, ao = false } = {}) {
    this.scale = scale;
    this.renderer.shadowMap.enabled = shadows > 0;
    this.renderer.shadowMap.needsUpdate = true;
    const rebuild = bloom !== this.bloomEnabled || ao !== this.ao || !this.composer;
    this.bloomEnabled = bloom;
    this.ao = ao;
    if (rebuild) this.rebuildComposer();
    this.resize();
  }

  setExposure(v) { this.renderer.toneMappingExposure = v; }

  rebuildComposer() {
    if (this.composer) { try { this.composer.dispose(); } catch (e) { /* ignore */ } this.composer = null; this.gtao = null; this.bloomPass = null; this.filmPass = null; }
    const w = window.innerWidth, h = window.innerHeight;
    const target = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.ao) {
      try {
        const gtao = new GTAOPass(this.scene, this.camera, w, h);
        gtao.output = GTAOPass.OUTPUT.Default;
        gtao.blendIntensity = 0.85;
        gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
        gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
        this.composer.addPass(gtao);
        this.gtao = gtao;
      } catch (e) { console.warn('[tanki] ambient occlusion unavailable', e); this.gtao = null; }
    }
    this.composer.addPass(new OutputPass());
    if (this.bloomEnabled) {
      // bloom on the tone-mapped image: only true highlights (sun, flashes, explosions) glow
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.5, 0.88);
      this.composer.addPass(this.bloomPass);
    }
    this.filmPass = new ShaderPass(FilmShader);
    this.filmPass.uniforms.resolution.value.set(w, h);
    this.composer.addPass(this.filmPass);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    if (this.filmPass) this.filmPass.uniforms.resolution.value.set(w * pr, h * pr);
    this.labels.setSize(w, h);
  }

  render(dt = 0.016) {
    this.time += dt;
    if (this.filmPass) this.filmPass.uniforms.time.value = this.time;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /** Remove everything from the scene (map change). */
  clearScene() {
    const kill = [];
    this.scene.traverse((o) => { if (o !== this.scene) kill.push(o); });
    for (const o of kill) {
      if (o.parent) o.parent.remove(o);
      if (o.geometry && !o.userData.keepGeo) o.geometry.dispose?.();
    }
    this.scene.fog = null;
    this.scene.background = null;
    this.scene.environment = null;
  }
}
