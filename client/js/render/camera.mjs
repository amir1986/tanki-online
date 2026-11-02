// Third person follow camera with orbit (mouse mode), zoom and sniper view.
import * as THREE from 'three';

const tmpV = new THREE.Vector3();
const look = new THREE.Vector3();

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.orbitYaw = 0;         // mouse-mode orbit yaw (absolute)
    this.pitch = 0.32;         // radians above horizon
    this.distance = 11;
    this.minDist = 5; this.maxDist = 22;
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.initialized = false;
    this.shake = 0;
    this.baseFov = 62;
    this.sniper = false;
  }

  addOrbit(dx, dy, sens = 0.0022) {
    this.orbitYaw -= dx * sens;
    this.pitch = Math.max(-0.15, Math.min(1.1, this.pitch + dy * sens));
  }

  zoom(delta) {
    this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance + delta));
  }

  /** Snap orbit to the hull heading (used when switching modes / on spawn). */
  snapTo(yaw) { this.orbitYaw = yaw; }

  addShake(k) { this.shake = Math.min(1.5, this.shake + k); }

  /**
   * @param {number} dt
   * @param {{pos:number[], yaw:number, turretYaw:number, up:number[]}} target
   * @param {object} map built map (for surfaceAt)
   * @param {{mouseAim:boolean, sniper:boolean, muzzle?:THREE.Vector3, muzzleDir?:THREE.Vector3}} opts
   * @returns {number} camera yaw (world) for mouse aiming
   */
  update(dt, target, map, opts = {}) {
    const cam = this.camera;
    if (!target) return this.orbitYaw;
    const [tx, ty, tz] = target.pos;
    const yaw = opts.mouseAim ? this.orbitYaw : target.yaw;
    if (!opts.mouseAim) this.orbitYaw = target.yaw;
    const sniper = !!opts.sniper;
    let desired, lookAt, fov;
    if (sniper && opts.muzzle) {
      const d = opts.muzzleDir;
      desired = tmpV.set(opts.muzzle.x - d.x * 1.2, opts.muzzle.y + 0.55, opts.muzzle.z - d.z * 1.2);
      lookAt = look.set(opts.muzzle.x + d.x * 60, opts.muzzle.y + d.y * 60 + 0.55, opts.muzzle.z + d.z * 60);
      fov = 18;
    } else {
      const dist = this.distance;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      desired = tmpV.set(tx - Math.sin(yaw) * dist * cp, ty + dist * sp + 1.2, tz - Math.cos(yaw) * dist * cp);
      lookAt = look.set(tx, ty + 1.3, tz);
      fov = this.baseFov;
    }
    // keep the camera above the ground / platforms
    if (map) {
      const gy = map.surfaceAt(desired.x, desired.z) + 0.9;
      if (desired.y < gy) desired.y = gy;
    }
    if (!this.initialized || sniper !== this.sniper) {
      this.smoothPos.copy(desired);
      this.smoothLook.copy(lookAt);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * (opts.mouseAim ? 18 : 9));
      this.smoothPos.lerp(desired, k);
      this.smoothLook.lerp(lookAt, 1 - Math.exp(-dt * 14));
    }
    this.sniper = sniper;
    cam.position.copy(this.smoothPos);
    if (this.shake > 0) {
      const s = this.shake * 0.12;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(this.smoothLook);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
    return yaw;
  }

  /** Free orbit for menus: orbit around a point. */
  orbit(dt, center, radius, height, speed = 0.15, t = 0) {
    const a = t * speed;
    this.camera.position.set(center[0] + Math.sin(a) * radius, center[1] + height, center[2] + Math.cos(a) * radius);
    this.camera.lookAt(center[0], center[1] + 0.6, center[2]);
    if (Math.abs(this.camera.fov - this.baseFov) > 0.01) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
    this.initialized = false;
  }
}
