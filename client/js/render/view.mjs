// Renderer / scene / camera wrapper with quality settings and optional bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.15, 1400);
    this.camera.position.set(0, 6, -12);
    this.scale = 1;
    this.bloomEnabled = false;
    this.composer = null;
    this.bloomPass = null;
    this.fpsSamples = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality({ scale = 1, shadows = 2, bloom = false } = {}) {
    this.scale = scale;
    this.renderer.shadowMap.enabled = shadows > 0;
    this.renderer.shadowMap.needsUpdate = true;
    if (bloom !== this.bloomEnabled) {
      this.bloomEnabled = bloom;
      if (bloom && !this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.86);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new OutputPass());
      }
    }
    this.resize();
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
    if (this.bloomEnabled && this.composer) this.composer.render();
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
  }
}
