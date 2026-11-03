// Renderer / scene / camera wrapper: AgX tone mapping, soft shadows, MSAA post pipeline with ambient occlusion and bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.85;
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
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality({ scale = 1, shadows = 2, bloom = false, ao = false } = {}) {
    this.scale = scale;
    this.renderer.shadowMap.enabled = shadows > 0;
    this.renderer.shadowMap.needsUpdate = true;
    const rebuild = bloom !== this.bloomEnabled || ao !== this.ao || (!this.composer && (bloom || ao));
    this.bloomEnabled = bloom;
    this.ao = ao;
    if (rebuild) this.rebuildComposer();
    this.resize();
  }

  rebuildComposer() {
    if (this.composer) { try { this.composer.dispose(); } catch (e) { /* ignore */ } this.composer = null; this.gtao = null; this.bloomPass = null; }
    if (!this.bloomEnabled && !this.ao) return;
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
    if (this.bloomEnabled) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.35, 2.2);
      this.composer.addPass(this.bloomPass);
    }
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
