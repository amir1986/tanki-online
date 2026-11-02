// Tank rigid body with raycast suspension, arcade drive model and self righting.
import * as CANNON from 'cannon-es';
import { GROUP, MASK_STATIC } from './world.mjs';
import { qRotate, vdot, vcross, vlen, vnorm, vsub, vscale, vadd, clamp } from './math.mjs';

const GRAVITY = 22;
const tmpForce = new CANNON.Vec3();
const tmpPoint = new CANNON.Vec3();
const tmpVel = new CANNON.Vec3();
const tmpTorque = new CANNON.Vec3();

export class TankSim {
  /**
   * @param {import('./world.mjs').PhysWorld} pw
   * @param {{size:number[], mass:number, speed:number, accel:number, turn:number}} hull
   */
  constructor(pw, hull, pos, yaw, owner = null) {
    this.pw = pw;
    this.hull = hull;
    this.owner = owner;
    const [w, h, l] = hull.size;
    this.size = [w, h, l];
    const body = (this.body = new CANNON.Body({
      mass: hull.mass,
      collisionFilterGroup: GROUP.TANK,
      collisionFilterMask: GROUP.PROP | GROUP.TANK,
      linearDamping: 0.04,
      angularDamping: 0.55,
    }));
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, l / 2)));
    body.allowSleep = false;
    this.restLength = 0.75;
    this.maxLength = 1.35;
    this.k = hull.mass * 26;
    this.c = hull.mass * 2.4;
    const cx = (w / 2) * 0.8, cz = (l / 2) * 0.82, cy = -h / 2;
    this.corners = [[-cx, cy, cz], [cx, cy, cz], [-cx, cy, -cz], [cx, cy, -cz]];
    this.grounded = false;
    this.groundHits = 0;
    this.groundNormal = [0, 1, 0];
    this.upsideDownTime = 0;
    this.speed = 0;
    this.turretYaw = 0;
    this.lastControls = { f: 0, t: 0 };
    this.teleport(pos, yaw);
    pw.addTankBody(body, this);
  }

  teleport(pos, yaw) {
    const b = this.body;
    b.position.set(pos[0], pos[1] + this.size[1] / 2 + this.restLength - 0.1, pos[2]);
    b.quaternion.setFromEuler(0, yaw, 0);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.force.set(0, 0, 0);
    b.torque.set(0, 0, 0);
    this.upsideDownTime = 0;
  }

  /** Flip the tank upright in place (used for auto-flip / unstuck). */
  flipUpright() {
    const b = this.body;
    const yaw = this.yaw;
    b.quaternion.setFromEuler(0, yaw, 0);
    b.position.y = this.pw.heightAt(b.position.x, b.position.z) + this.size[1] / 2 + this.restLength + 0.4;
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    this.upsideDownTime = 0;
  }

  get pos() { const p = this.body.position; return [p.x, p.y, p.z]; }
  get quat() { const q = this.body.quaternion; return [q.x, q.y, q.z, q.w]; }
  get yaw() { const f = this.forward; return Math.atan2(f[0], f[2]); }
  get forward() { return qRotate(this.quat, [0, 0, 1]); }
  get up() { return qRotate(this.quat, [0, 1, 0]); }
  get right() { return qRotate(this.quat, [1, 0, 0]); }
  get velocity() { const v = this.body.velocity; return [v.x, v.y, v.z]; }

  /** World position of the turret pivot. */
  turretPivot() {
    return vadd(this.pos, vscale(this.up, this.size[1] / 2));
  }

  /** World direction the turret points (hull plane), and the absolute turret yaw. */
  turretDir() {
    const q = this.quat;
    const local = [Math.sin(this.turretYaw), 0, Math.cos(this.turretYaw)];
    return qRotate(q, local);
  }

  /**
   * @param {number} dt
   * @param {{f:number,t:number}} controls  f: throttle -1..1, t: turn -1..1
   * @param {{speedMult?:number, accelMult?:number, turnMult?:number}} mods
   */
  update(dt, controls, mods = {}) {
    const b = this.body;
    const m = b.mass;
    const speedMult = mods.speedMult ?? 1;
    const accelMult = mods.accelMult ?? 1;
    const turnMult = mods.turnMult ?? 1;
    const q = this.quat;
    const up = qRotate(q, [0, 1, 0]);
    const fwd = qRotate(q, [0, 0, 1]);
    const right = qRotate(q, [1, 0, 0]);
    const pos = this.pos;

    // ---- suspension -----------------------------------------------------
    let hits = 0;
    let nSum = [0, 0, 0];
    let totalN = 0;
    const startOff = 0.25;
    for (const c of this.corners) {
      const wp = vadd(pos, qRotate(q, c));
      const from = vadd(wp, vscale(up, startOff));
      const to = vsub(from, vscale(up, this.maxLength + startOff));
      const hit = this.pw.raycast(from, to, { mask: MASK_STATIC });
      if (!hit) continue;
      const dist = hit.distance - startOff;
      if (dist > this.maxLength) continue;
      const comp = this.restLength - dist;
      tmpPoint.set(wp[0], wp[1], wp[2]);
      b.getVelocityAtWorldPoint(tmpPoint, tmpVel);
      const relVel = tmpVel.x * up[0] + tmpVel.y * up[1] + tmpVel.z * up[2];
      let f = 0;
      if (comp > 0) f = this.k * comp - this.c * relVel;
      else f = -this.c * relVel * 0.35 * (1 - (dist - this.restLength) / (this.maxLength - this.restLength));
      if (f < 0) f = 0;
      const maxF = m * GRAVITY * 3;
      if (f > maxF) f = maxF;
      tmpForce.set(up[0] * f, up[1] * f, up[2] * f);
      tmpPoint.set(wp[0] - pos[0], wp[1] - pos[1], wp[2] - pos[2]);
      b.applyForce(tmpForce, tmpPoint);
      hits++;
      nSum = vadd(nSum, hit.normal);
      totalN += f;
    }
    this.groundHits = hits;
    this.grounded = hits >= 1;
    const n = hits > 0 ? vnorm(nSum) : up;
    this.groundNormal = n;

    const av = b.angularVelocity;
    const angVel = [av.x, av.y, av.z];
    const I = b.inertia;
    const Iy = I.y, Iavg = (I.x + I.y + I.z) / 3;
    let torque = [0, 0, 0];

    // ---- drive ----------------------------------------------------------
    const traction = hits >= 2 ? 1 : hits === 1 ? 0.5 : 0;
    const v = this.velocity;
    if (traction > 0) {
      const f = vnorm(vsub(fwd, vscale(n, vdot(fwd, n))));
      const r = vnorm(vsub(right, vscale(n, vdot(right, n))));
      const vf = vdot(v, f), vr = vdot(v, r);
      const maxSpeed = this.hull.speed * speedMult;
      const accel = this.hull.accel * accelMult;
      const throttle = clamp(controls.f || 0, -1, 1);
      let Ff;
      if (Math.abs(throttle) > 0.01) {
        const target = throttle * maxSpeed * (throttle < 0 ? 0.7 : 1);
        const dv = target - vf;
        Ff = clamp(dv / dt, -accel, accel) * m;
      } else {
        Ff = clamp(-vf / dt, -accel * 1.3, accel * 1.3) * m;
      }
      let Fr = clamp(-vr / dt, -accel * 3, accel * 3) * m;
      const N = Math.max(totalN, m * GRAVITY * 0.25);
      const Fmax = 1.05 * N;
      const mag = Math.hypot(Ff, Fr);
      if (mag > Fmax) { Ff *= Fmax / mag; Fr *= Fmax / mag; }
      Ff *= traction; Fr *= traction;
      tmpForce.set(f[0] * Ff + r[0] * Fr, f[1] * Ff + r[1] * Fr, f[2] * Ff + r[2] * Fr);
      tmpPoint.set(0, 0, 0);
      b.applyForce(tmpForce, tmpPoint);

      // turning (P-controller on yaw rate about hull up axis)
      const wUp = vdot(angVel, up);
      const turn = clamp(controls.t || 0, -1, 1);
      const targetW = turn * this.hull.turn * turnMult;
      const dw = clamp((targetW - wUp) / dt, -18, 18);
      torque = vadd(torque, vscale(up, Iy * dw * traction));
      // damp pitch/roll spin while grounded
      const wPR = vsub(angVel, vscale(up, wUp));
      torque = vsub(torque, vscale(wPR, Iavg * 5 * traction));
      this.speed = vf;
    } else {
      this.speed = vdot(v, fwd);
    }

    // ---- self righting --------------------------------------------------
    const tiltAxis = vcross(up, [0, 1, 0]);
    const sinTilt = clamp(vlen(tiltAxis), 0, 1);
    if (up[1] > -0.3 && sinTilt > 1e-4) {
      const strength = traction > 0 ? 22 : 9;
      torque = vadd(torque, vscale(vnorm(tiltAxis), Iavg * Math.asin(sinTilt) * strength));
    }
    tmpTorque.set(torque[0], torque[1], torque[2]);
    b.applyTorque(tmpTorque);

    if (up[1] < 0.15) this.upsideDownTime += dt; else this.upsideDownTime = 0;

    // ---- safety: never sink below terrain, never leave the map -----------
    const gy = this.pw.heightAt(b.position.x, b.position.z);
    const minY = gy + this.size[1] * 0.35;
    if (b.position.y < minY) {
      b.position.y = minY;
      if (b.velocity.y < 0) b.velocity.y = 0;
    }
    const map = this.pw.map;
    const margin = 0.5;
    if (b.position.x < -map.halfW + margin) { b.position.x = -map.halfW + margin; if (b.velocity.x < 0) b.velocity.x = 0; }
    if (b.position.x > map.halfW - margin) { b.position.x = map.halfW - margin; if (b.velocity.x > 0) b.velocity.x = 0; }
    if (b.position.z < -map.halfL + margin) { b.position.z = -map.halfL + margin; if (b.velocity.z < 0) b.velocity.z = 0; }
    if (b.position.z > map.halfL - margin) { b.position.z = map.halfL - margin; if (b.velocity.z > 0) b.velocity.z = 0; }
    this.lastControls = controls;
  }

  destroy() {
    this.pw.removeBody(this.body);
  }
}
