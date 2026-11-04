// Third person follow camera: spring-arm style. The camera sits on an orbit behind the tank, rises gently over
// obstacles, pulls in quickly when something blocks the view and recovers slowly. Every quantity is smoothed and
// nothing ever snaps, so the view stays calm while driving.
import * as THREE from 'three';

const tmpV = new THREE.Vector3();
const look = new THREE.Vector3();
const dirV = new THREE.Vector3();
const probe = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const PITCH_STEPS = [0, 0.16, 0.34, 0.52];

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.orbitYaw = 0;         // camera yaw (mouse mode: from the mouse; keyboard mode: follows the hull smoothly)
    this.pitch = 0.3;          // radians above horizon (user controlled)
    this.autoPitch = 0;        // extra pitch added to clear obstacles (smoothed)
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
    this.sensitivity = 0.0011; // rad per pixel at sensitivity 1
    this.bounds = null;        // { x, z }: the camera never leaves the arena walls
  }

  setBounds(x, z) { this.bounds = x && z ? { x, z } : null; }

  /** Meshes that can block the view (terrain is handled analytically through the map). */
  setOccluders(list) { this.occluders = (list || []).filter((o) => o.name !== 'terrain' && o.name !== 'skirt'); }
  addOrbit(dx, dy, sens = this.sensitivity) {
    this.orbitYaw = wrapAngle(this.orbitYaw - dx * sens);
    this.pitch = Math.max(-0.1, Math.min(1.05, this.pitch + dy * sens));
  }
  zoom(delta) { this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance + delta)); }
  snapTo(yaw) { this.orbitYaw = yaw; }
  addShake(k) { this.shake = Math.min(1.2, this.shake + k); }

  /** Free distance from `from` along `dir`, limited by props (raycast) and the terrain (marched through the map). */
  freeDistance(from, dir, want, map, useBounds = true) {
    let free = want;
    if (this.occluders.length) {
      raycaster.set(from, dir);
      raycaster.far = want + 0.4;
      raycaster.near = 0.05;
      const hits = raycaster.intersectObjects(this.occluders, false);
      if (hits.length && hits[0].distance < free) free = Math.max(1.2, hits[0].distance - 0.45);
    }
    if (this.bounds && useBounds) {
      // arena walls as analytic planes: the arm stops short of them, which also makes the camera rise when cornered
      for (const [axis, bound] of [['x', this.bounds.x], ['z', this.bounds.z]]) {
        const v = dir[axis];
        if (Math.abs(v) < 1e-4) continue;
        const t = ((v > 0 ? bound : -bound) - from[axis]) / v;
        if (t > 0 && t - 0.3 < free) free = Math.max(1.2, t - 0.3);
      }
    }
    if (map && dir.y < 0.9) {
      for (let d = 1.5; d < free; d += 1.0) {
        probe.copy(from).addScaledVector(dir, d);
        if (probe.y < map.surfaceAt(probe.x, probe.z) + 0.7) { free = Math.max(1.2, d - 0.8); break; }
      }
    }
    return free;
  }

  update(dt, target, map, opts = {}) {
    const cam = this.camera;
    if (!target) return this.orbitYaw;
    const [tx, ty, tz] = target.pos;
    if (!opts.mouseAim) {
      // keyboard mode: ease the camera yaw toward the hull heading instead of locking to it
      const diff = wrapAngle(target.yaw - this.orbitYaw);
      this.orbitYaw = wrapAngle(this.orbitYaw + diff * Math.min(1, dt * 5));
    }
    const yaw = this.orbitYaw;
    const sniper = !!opts.sniper;
    let desired, lookAt, fov;
    if (sniper && opts.muzzle) {
      const d = opts.muzzleDir;
      desired = tmpV.set(opts.muzzle.x - d.x * 1.2, opts.muzzle.y + 0.55, opts.muzzle.z - d.z * 1.2);
      lookAt = look.set(opts.muzzle.x + d.x * 60, opts.muzzle.y + d.y * 60 + 0.55, opts.muzzle.z + d.z * 60);
      fov = 18;
    } else {
      lookAt = look.set(tx, ty + 1.3, tz);
      const want = this.distance;
      // the lowest pitch that keeps most of the arm free wins; otherwise the best of the probes
      let bestExtra = 0, bestFree = 0, chosen = null;
      for (const extra of PITCH_STEPS) {
        const p = Math.min(1.25, this.pitch + extra);
        const cp = Math.cos(p), sp = Math.sin(p);
        dirV.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp).normalize();
        // walls do not count here: rising never clears a wall, so cornered views pull in instead of going top-down
        const free = this.freeDistance(lookAt, dirV, want, map, false);
        if (free >= want * 0.8) { chosen = extra; break; }
        if (free > bestFree + 0.5) { bestFree = free; bestExtra = extra; }
      }
      const targetAuto = chosen == null ? bestExtra : chosen;
      // rise promptly, settle back slowly
      this.autoPitch += (targetAuto - this.autoPitch) * Math.min(1, dt * (targetAuto > this.autoPitch ? 3.5 : 1.2));
      const p = Math.min(1.25, this.pitch + this.autoPitch);
      const cp = Math.cos(p), sp = Math.sin(p);
      dirV.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp).normalize();
      const dist = this.freeDistance(lookAt, dirV, want, map);
      // pull in fast, recover slowly
      this.currentDist += (dist - this.currentDist) * Math.min(1, dt * (dist < this.currentDist ? 14 : 2.5));
      desired = tmpV.copy(lookAt).addScaledVector(dirV, this.currentDist);
      desired.y += 0.3;
      if (map) {
        const gy = map.surfaceAt(desired.x, desired.z) + 0.9;
        if (desired.y < gy) desired.y = gy;
      }
      fov = this.baseFov;
    }
    if (!this.initialized || sniper !== this.sniper) {
      this.smoothPos.copy(desired);
      this.smoothLook.copy(lookAt);
      this.initialized = true;
    } else {
      this.smoothPos.lerp(desired, 1 - Math.exp(-dt * (sniper || opts.mouseAim ? 22 : 12)));
      this.smoothLook.lerp(lookAt, 1 - Math.exp(-dt * 16));
      if (!sniper) {
        // keep the smoothed position out of geometry along its own line of sight
        dirV.subVectors(this.smoothPos, lookAt);
        const d = dirV.length();
        if (d > 0.5) {
          dirV.multiplyScalar(1 / d);
          const free = this.freeDistance(lookAt, dirV, d, map);
          if (free < d) this.smoothPos.copy(lookAt).addScaledVector(dirV, free);
        }
      }
    }
    this.sniper = sniper;
    cam.position.copy(this.smoothPos);
    if (this.shake > 0) {
      const s = this.shake * 0.07;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3.5);
    }
    cam.lookAt(this.smoothLook);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
    return yaw;
  }
}
