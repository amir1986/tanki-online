// Third person follow camera with orbit (mouse mode), zoom, sniper view and occlusion avoidance.
import * as THREE from 'three';

const tmpV = new THREE.Vector3();
const look = new THREE.Vector3();
const dirV = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.orbitYaw = 0;         // mouse-mode orbit yaw (absolute)
    this.pitch = 0.3;          // radians above horizon
    this.distance = 11;
    this.minDist = 5; this.maxDist = 22;
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.initialized = false;
    this.shake = 0;
    this.baseFov = 60;
    this.sniper = false;
    this.occluders = [];
    this.currentDist = 11;
  }

  setOccluders(list) { this.occluders = list || []; }
  addOrbit(dx, dy, sens = 0.0022) {
    this.orbitYaw -= dx * sens;
    this.pitch = Math.max(-0.12, Math.min(1.1, this.pitch + dy * sens));
  }
  zoom(delta) { this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance + delta)); }
  snapTo(yaw) { this.orbitYaw = yaw; }
  addShake(k) { this.shake = Math.min(1.5, this.shake + k); }

  /**
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
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      lookAt = look.set(tx, ty + 1.3, tz);
      dirV.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp).normalize();
      let dist = this.distance;
      // occlusion: pull the camera in front of anything between the tank and the desired position
      if (this.occluders.length) {
        raycaster.set(lookAt, dirV);
        raycaster.far = dist + 0.5;
        raycaster.near = 0.1;
        const hits = raycaster.intersectObjects(this.occluders, false);
        if (hits.length && hits[0].distance < dist) dist = Math.max(2.2, hits[0].distance - 0.45);
      }
      desired = tmpV.copy(lookAt).addScaledVector(dirV, dist);
      desired.y += 0.3;
      if (map) {
        const gy = map.surfaceAt(desired.x, desired.z) + 0.8;
        if (desired.y < gy) desired.y = gy;
      }
      fov = this.baseFov;
      // snap in quickly when pulled closer, ease out slowly when freed
      if (dist < this.currentDist - 0.05) this.currentDist = dist; else this.currentDist += (dist - this.currentDist) * Math.min(1, dt * 4);
    }
    if (!this.initialized || sniper !== this.sniper) {
      this.smoothPos.copy(desired);
      this.smoothLook.copy(lookAt);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * (opts.mouseAim ? 20 : 10));
      this.smoothPos.lerp(desired, k);
      this.smoothLook.lerp(lookAt, 1 - Math.exp(-dt * 14));
      // never let the smoothed camera lag behind an occluder
      if (!sniper && this.occluders.length) {
        const d = this.smoothPos.distanceTo(lookAt);
        if (d > this.currentDist + 0.2) this.smoothPos.copy(lookAt).addScaledVector(dirV, this.currentDist);
      }
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
}
