// Visual effects: particle systems, beams, flashes, explosions, floating damage numbers.
import * as THREE from 'three';
import { Textures } from './textures.mjs';

const particleVert = /* glsl */`
  attribute float size; attribute float alpha; attribute vec3 pcolor;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vAlpha = alpha; vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const particleFrag = /* glsl */`
  uniform sampler2D map; varying float vAlpha; varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

class ParticleSystem {
  constructor(scene, texture, blending, max = 3000, depthWrite = false) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: texture } }, vertexShader: particleVert, fragmentShader: particleFrag, transparent: true, depthWrite, blending, depthTest: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 10 : 9;
    scene.add(this.points);
    geo.setDrawRange(0, 0);
  }

  emit({ pos, vel = [0, 0, 0], color = 0xffffff, size = 1, life = 1, gravity = 0, drag = 0, grow = 0, alpha = 1 }) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = pos[0]; this.pos[i * 3 + 1] = pos[1]; this.pos[i * 3 + 2] = pos[2];
    this.vel[i * 3] = vel[0]; this.vel[i * 3 + 1] = vel[1]; this.vel[i * 3 + 2] = vel[2];
    const c = typeof color === 'number' ? [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255] : color;
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.size[i] = size; this.baseSize[i] = size;
    this.alpha[i] = alpha; this.baseAlpha[i] = alpha;
    this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = grow; this.grav[i] = gravity; this.drag[i] = drag;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap with last
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[n * 3 + k]; this.vel[i * 3 + k] = this.vel[n * 3 + k]; this.col[i * 3 + k] = this.col[n * 3 + k]; }
          this.size[i] = this.size[n]; this.baseSize[i] = this.baseSize[n]; this.alpha[i] = this.alpha[n]; this.baseAlpha[i] = this.baseAlpha[n];
          this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n]; this.grow[i] = this.grow[n]; this.grav[i] = this.grav[n]; this.drag[i] = this.drag[n];
        }
        i--;
        continue;
      }
      const f = this.life[i] / this.maxLife[i];
      const d = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - f));
      this.alpha[i] = this.baseAlpha[i] * (f < 0.5 ? f * 2 : 1);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const TURRET_COLORS = { smoky: 0xffd27a, firebird: 0xff7a1a, twins: 0x4fc3f7, isida: 0x7ee57e, railgun: 0x9fb8ff, freeze: 0x9be7ff, thunder: 0xffb066, hammer: 0xffd27a, ricochet: 0x4dd0e1, striker: 0xff7a52, vulcan: 0xffe08a, shaft: 0xb0c4ff, mine: 0xffa040, self: 0xffa040 };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticleSystem(scene, Textures.get('spark'), THREE.AdditiveBlending, 2500);
    this.fire = new ParticleSystem(scene, Textures.get('particle'), THREE.AdditiveBlending, 2500);
    this.smoke = new ParticleSystem(scene, Textures.get('smoke'), THREE.NormalBlending, 2000);
    this.beams = [];        // { mesh, life, maxLife }
    this.lights = [];       // { light, life, maxLife, intensity }
    this.sprites = [];      // damage numbers { sprite, life, vel }
    this.lightPool = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 30, 2); l.visible = false; scene.add(l); this.lightPool.push(l); }
    this.beamMat = new Map();
    this.time = 0;
    this.groundY = () => 0;
  }

  setGround(fn) { this.groundY = fn; }

  // ---- helpers ---------------------------------------------------------------
  light(pos, color, intensity, life, dist = 30) {
    const l = this.lightPool.find((x) => !x.visible);
    if (!l) return;
    l.position.set(pos[0], pos[1], pos[2]);
    l.color.setHex(color); l.intensity = intensity; l.distance = dist; l.visible = true;
    this.lights.push({ light: l, life, maxLife: life, intensity });
  }

  beamMaterial(color, opacity = 0.9) {
    const key = color + ':' + opacity;
    if (!this.beamMat.has(key)) this.beamMat.set(key, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    return this.beamMat.get(key);
  }

  /** Cylinder between two points. */
  beam(from, to, radius, color, life, opacity = 0.9, fade = true) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 0.05) return null;
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
    geo.translate(0, len / 2, 0);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.beamMaterial(color, opacity).clone());
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.renderOrder = 11;
    this.scene.add(mesh);
    const entry = { mesh, life, maxLife: life, fade, from: a, to: b };
    this.beams.push(entry);
    return entry;
  }

  // ---- one shots --------------------------------------------------------------
  muzzleFlash(pos, dir, kind) {
    const color = TURRET_COLORS[kind] || 0xffd27a;
    const n = kind === 'vulcan' ? 4 : 10;
    for (let i = 0; i < n; i++) {
      this.fire.emit({ pos, vel: [dir[0] * rnd(4, 14) + rnd(-2, 2), dir[1] * rnd(4, 14) + rnd(-1, 2), dir[2] * rnd(4, 14) + rnd(-2, 2)], color, size: rnd(0.5, 1.4), life: rnd(0.08, 0.2), drag: 6, grow: 1.5 });
    }
    for (let i = 0; i < (kind === 'vulcan' ? 1 : 4); i++) {
      this.smoke.emit({ pos, vel: [dir[0] * rnd(1, 4) + rnd(-1, 1), rnd(0.5, 2), dir[2] * rnd(1, 4) + rnd(-1, 1)], color: 0x777777, size: rnd(0.8, 1.6), life: rnd(0.5, 1.2), drag: 2, grow: 2, alpha: 0.5 });
    }
    this.light(pos, color, kind === 'vulcan' ? 10 : 40, 0.08, 14);
  }

  tracer(from, to, kind) {
    const color = TURRET_COLORS[kind] || 0xffd27a;
    const r = kind === 'vulcan' ? 0.04 : kind === 'hammer' ? 0.035 : kind === 'shaft' ? 0.07 : 0.06;
    this.beam(from, to, r, color, kind === 'shaft' ? 0.35 : 0.09, 0.8);
  }

  railBeam(from, to) {
    this.beam(from, to, 0.09, 0xdfe8ff, 0.5, 1);
    this.beam(from, to, 0.3, 0x6f8cff, 0.45, 0.35);
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const n = Math.min(60, Math.floor(len / 1.5));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const p = [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t];
      this.sparks.emit({ pos: p, vel: [rnd(-1, 1), rnd(-0.5, 1.5), rnd(-1, 1)], color: 0xb0c8ff, size: rnd(0.2, 0.5), life: rnd(0.3, 0.7), drag: 1 });
    }
    this.light(from, 0x9fb8ff, 60, 0.25, 20);
  }

  chargeGlow(pos, frac, kind) {
    const color = kind === 'shaft' ? 0xb0c4ff : 0x9fb8ff;
    for (let i = 0; i < 2 + frac * 4; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.4 - frac * 1.0;
      const p = [pos[0] + Math.cos(a) * r, pos[1] + rnd(-0.3, 0.3), pos[2] + Math.sin(a) * r];
      const v = [(pos[0] - p[0]) * 3, (pos[1] - p[1]) * 3, (pos[2] - p[2]) * 3];
      this.sparks.emit({ pos: p, vel: v, color, size: 0.25 + frac * 0.3, life: 0.3, drag: 0 });
    }
  }

  impact(pos, normal, kind, tankHit) {
    const color = TURRET_COLORS[kind] || 0xffd27a;
    const n = normal || [0, 1, 0];
    for (let i = 0; i < (tankHit ? 14 : 8); i++) {
      this.sparks.emit({ pos, vel: [n[0] * rnd(2, 9) + rnd(-4, 4), n[1] * rnd(2, 9) + rnd(0, 4), n[2] * rnd(2, 9) + rnd(-4, 4)], color: tankHit ? 0xffe0a0 : color, size: rnd(0.15, 0.4), life: rnd(0.25, 0.6), gravity: 18, drag: 1 });
    }
    for (let i = 0; i < 3; i++) this.smoke.emit({ pos, vel: [n[0] * 2 + rnd(-1, 1), rnd(1, 2.5), n[2] * 2 + rnd(-1, 1)], color: 0x666666, size: rnd(0.6, 1.2), life: rnd(0.6, 1.1), drag: 2, grow: 2, alpha: 0.5 });
    this.light(pos, color, 15, 0.1, 10);
  }

  explosion(pos, radius, kind) {
    const color = TURRET_COLORS[kind] || 0xffa040;
    const k = Math.max(1, radius / 4);
    for (let i = 0; i < 18 * k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI / 2;
      const s = rnd(3, 12) * k;
      this.fire.emit({ pos, vel: [Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s], color: i % 4 === 0 ? 0xffe0b0 : color, size: rnd(0.9, 2.0) * k, life: rnd(0.2, 0.5), drag: 4, grow: 2.2, alpha: 0.55 });
    }
    for (let i = 0; i < 25 * k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI / 2;
      const s = rnd(6, 20) * k;
      this.sparks.emit({ pos, vel: [Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s], color: 0xffd080, size: rnd(0.2, 0.5), life: rnd(0.4, 1.1), gravity: 20, drag: 0.8 });
    }
    for (let i = 0; i < 18 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ pos: [pos[0] + Math.cos(a) * 0.5, pos[1] + 0.3, pos[2] + Math.sin(a) * 0.5], vel: [Math.cos(a) * rnd(1, 4) * k, rnd(2, 5), Math.sin(a) * rnd(1, 4) * k], color: 0x333333, size: rnd(1.5, 3) * k, life: rnd(1.2, 2.6), drag: 1.5, grow: 2.5, alpha: 0.7 });
    }
    this.light(pos, color, 120 * k, 0.35, 30 * k);
  }

  tankExplosion(pos) {
    this.explosion(pos, 5, 'self');
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ pos: [pos[0], pos[1] + 0.5, pos[2]], vel: [Math.cos(a) * rnd(0.5, 3), rnd(3, 8), Math.sin(a) * rnd(0.5, 3)], color: 0x222222, size: rnd(2, 4), life: rnd(2, 4), drag: 1.2, grow: 2.5, alpha: 0.8 });
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.emit({ pos, vel: [Math.cos(a) * rnd(4, 14), rnd(8, 20), Math.sin(a) * rnd(4, 14)], color: 0xffb060, size: rnd(0.4, 0.9), life: rnd(0.8, 1.8), gravity: 22, drag: 0.5 });
    }
  }

  spawnFlash(pos) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.5, 2.5);
      this.sparks.emit({ pos: [pos[0] + Math.cos(a) * r, pos[1] - 0.5, pos[2] + Math.sin(a) * r], vel: [0, rnd(3, 8), 0], color: 0x9bd33a, size: rnd(0.2, 0.5), life: rnd(0.5, 1), drag: 1 });
    }
    this.light(pos, 0x9bd33a, 30, 0.5, 14);
  }

  pickupBurst(pos, color) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.emit({ pos, vel: [Math.cos(a) * rnd(2, 6), rnd(2, 8), Math.sin(a) * rnd(2, 6)], color, size: rnd(0.25, 0.5), life: rnd(0.5, 1.0), gravity: 6, drag: 1 });
    }
    this.light(pos, color, 25, 0.3, 12);
  }

  healSparks(pos) {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.8, 1.8);
      this.sparks.emit({ pos: [pos[0] + Math.cos(a) * r, pos[1] - 0.4, pos[2] + Math.sin(a) * r], vel: [0, rnd(1.5, 3), 0], color: 0x7ee57e, size: rnd(0.2, 0.35), life: rnd(0.6, 1), drag: 0.5 });
    }
  }

  bounce(pos, normal) {
    for (let i = 0; i < 8; i++) this.sparks.emit({ pos, vel: [normal[0] * 4 + rnd(-3, 3), normal[1] * 4 + rnd(0, 3), normal[2] * 4 + rnd(-3, 3)], color: 0x4dd0e1, size: rnd(0.15, 0.35), life: rnd(0.2, 0.5), gravity: 10 });
    this.light(pos, 0x4dd0e1, 12, 0.1, 8);
  }

  /** Continuous emitters -------------------------------------------------------- */
  streamEmit(kind, from, dir, dt, range = 13) {
    const n = Math.max(1, Math.round(dt * 220));
    const fireCols = [0xff3b00, 0xff7a1a, 0xffc24a, 0xffffff];
    const iceCols = [0x9be7ff, 0xe3f7ff, 0x4fc3f7, 0xffffff];
    const cols = kind === 'firebird' ? fireCols : iceCols;
    const speed = range * 2.2;
    for (let i = 0; i < n; i++) {
      const spread = 0.16;
      const v = [dir[0] * speed + rnd(-spread, spread) * speed, dir[1] * speed + rnd(-spread, spread) * speed * 0.6 + 0.5, dir[2] * speed + rnd(-spread, spread) * speed];
      this.fire.emit({ pos: [from[0] + rnd(-0.1, 0.1), from[1] + rnd(-0.1, 0.1), from[2] + rnd(-0.1, 0.1)], vel: v, color: cols[Math.floor(Math.random() * cols.length)], size: rnd(0.7, 1.4), life: range / speed * rnd(0.7, 1.1), drag: 1.2, grow: kind === 'firebird' ? 3 : 2 });
    }
    if (kind === 'firebird' && Math.random() < dt * 40) {
      this.smoke.emit({ pos: [from[0] + dir[0] * 3, from[1] + dir[1] * 3 + 0.3, from[2] + dir[2] * 3], vel: [dir[0] * 6, 2, dir[2] * 6], color: 0x222222, size: rnd(1, 2), life: rnd(0.8, 1.5), drag: 1.5, grow: 2.5, alpha: 0.45 });
    }
    this.light(from, kind === 'firebird' ? 0xff7a1a : 0x9be7ff, 25, 0.05, 12);
  }

  /** Isida beam between muzzle and target; call every frame while active. */
  isidaBeam(key, from, to, enemy) {
    const color = enemy ? 0xff4d4d : 0x7ee57e;
    const b = this.beam(from, to, 0.12, color, 0.06, 0.75, false);
    const b2 = this.beam(from, to, 0.3, color, 0.06, 0.18, false);
    if (Math.random() < 0.5) {
      const t = Math.random();
      const p = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      this.sparks.emit({ pos: p, vel: [rnd(-1, 1), rnd(0, 2), rnd(-1, 1)], color, size: 0.25, life: 0.4 });
    }
    return b && b2;
  }

  burnEmit(pos, dt) {
    if (Math.random() < dt * 60) {
      this.fire.emit({ pos: [pos[0] + rnd(-0.8, 0.8), pos[1] + rnd(0, 0.8), pos[2] + rnd(-0.8, 0.8)], vel: [0, rnd(2, 4), 0], color: Math.random() < 0.5 ? 0xff7a1a : 0xffc24a, size: rnd(0.6, 1.2), life: rnd(0.3, 0.6), grow: 1.5 });
      this.smoke.emit({ pos: [pos[0], pos[1] + 0.8, pos[2]], vel: [rnd(-0.5, 0.5), rnd(2, 3), rnd(-0.5, 0.5)], color: 0x333333, size: 1, life: 1, grow: 2, alpha: 0.4 });
    }
  }

  frostEmit(pos, dt) {
    if (Math.random() < dt * 30) this.sparks.emit({ pos: [pos[0] + rnd(-1, 1), pos[1] + rnd(-0.3, 0.8), pos[2] + rnd(-1, 1)], vel: [0, rnd(-0.5, 0.5), 0], color: 0xbfefff, size: rnd(0.2, 0.4), life: rnd(0.5, 1) });
  }

  nitroEmit(pos, back, dt) {
    if (Math.random() < dt * 90) this.fire.emit({ pos: [pos[0] + back[0] + rnd(-0.3, 0.3), pos[1] + 0.2, pos[2] + back[2] + rnd(-0.3, 0.3)], vel: [back[0] * 6, 1, back[2] * 6], color: 0x7dff7d, size: rnd(0.5, 1), life: 0.35, grow: 2 });
  }

  exhaust(pos, back, dt, speed) {
    if (Math.random() < dt * (8 + Math.abs(speed) * 3)) this.smoke.emit({ pos: [pos[0] + back[0], pos[1], pos[2] + back[2]], vel: [back[0] * 1.5, rnd(0.8, 1.6), back[2] * 1.5], color: 0x555555, size: rnd(0.4, 0.8), life: rnd(0.8, 1.4), drag: 1.5, grow: 2, alpha: 0.35 });
  }

  dust(pos, dt, speed, groundColor = 0xa08a60) {
    if (Math.random() < dt * Math.abs(speed) * 1.5) this.smoke.emit({ pos: [pos[0] + rnd(-1, 1), pos[1] - 0.3, pos[2] + rnd(-1, 1)], vel: [rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1)], color: groundColor, size: rnd(0.8, 1.6), life: rnd(0.8, 1.5), drag: 1.5, grow: 2, alpha: 0.3 });
  }

  /** Floating damage / heal numbers. */
  number(pos, text, color = '#ffd27a', size = 1) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color; ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.2 * size, 1.1 * size, 1);
    sp.position.set(pos[0] + rnd(-0.4, 0.4), pos[1] + 1.4, pos[2] + rnd(-0.4, 0.4));
    sp.renderOrder = 20;
    this.scene.add(sp);
    this.sprites.push({ sprite: sp, life: 1.1, maxLife: 1.1, vel: 1.8 });
  }

  // ---- frame update -----------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.sparks.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); this.beams.splice(i, 1); continue; }
      if (b.fade) b.mesh.material.opacity = (b.life / b.maxLife) * (b.mesh.material.userData.base ??= b.mesh.material.opacity);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      if (l.life <= 0) { l.light.visible = false; l.light.intensity = 0; this.lights.splice(i, 1); continue; }
      l.light.intensity = l.intensity * (l.life / l.maxLife);
    }
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      if (s.life <= 0) { this.scene.remove(s.sprite); s.sprite.material.map.dispose(); s.sprite.material.dispose(); this.sprites.splice(i, 1); continue; }
      s.sprite.position.y += s.vel * dt;
      s.sprite.material.opacity = Math.min(1, s.life / s.maxLife * 2);
    }
  }

  clear() {
    this.sparks.clear(); this.fire.clear(); this.smoke.clear();
    for (const b of this.beams) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.beams.length = 0;
    for (const l of this.lights) { l.light.visible = false; }
    this.lights.length = 0;
    for (const s of this.sprites) this.scene.remove(s.sprite);
    this.sprites.length = 0;
  }
}

export { TURRET_COLORS };
