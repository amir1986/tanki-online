// Physics world wrapper around cannon-es. Builds terrain + props from a built map.
import * as CANNON from 'cannon-es';

export const GROUP = { GROUND: 1, PROP: 2, TANK: 4 };
export const MASK_ALL = GROUP.GROUND | GROUP.PROP | GROUP.TANK;
export const MASK_STATIC = GROUP.GROUND | GROUP.PROP;

const tmpFrom = new CANNON.Vec3();
const tmpTo = new CANNON.Vec3();
const tmpRay = new CANNON.Ray();

export class PhysWorld {
  constructor(map) {
    this.map = map;
    const w = (this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) }));
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = false;
    w.solver.iterations = 10;
    w.defaultContactMaterial.friction = 0.35;
    w.defaultContactMaterial.restitution = 0.0;
    w.defaultContactMaterial.contactEquationStiffness = 5e7;
    w.defaultContactMaterial.contactEquationRelaxation = 4;

    // terrain
    const hf = new CANNON.Heightfield(map.heights, { elementSize: map.cell });
    const ground = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.GROUND, collisionFilterMask: GROUP.PROP | GROUP.TANK });
    ground.addShape(hf);
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.set(-map.halfW, 0, map.halfL);
    ground.tankiKind = 'ground';
    ground.tankiRef = null;
    w.addBody(ground);
    this.ground = ground;

    // props
    this.propBodies = [];
    for (const p of map.props) {
      const b = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.PROP, collisionFilterMask: GROUP.TANK });
      let [hx, hy, hz] = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
      if (p.kind === 'tree') { hx = 0.35 * (p.tint || 1); hz = hx; }
      b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      b.position.set(p.pos[0], p.pos[1], p.pos[2]);
      b.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
      b.tankiKind = 'prop';
      b.tankiRef = p;
      w.addBody(b);
      this.propBodies.push(b);
    }
  }

  addTankBody(body, tank) {
    body.tankiKind = 'tank';
    body.tankiRef = tank;
    this.world.addBody(body);
  }

  removeBody(body) {
    this.world.removeBody(body);
  }

  step(dt) {
    this.world.step(dt);
  }

  heightAt(x, z) {
    return this.map.heightAt(x, z);
  }

  /**
   * Closest hit along segment from->to.
   * @returns {null | { point:[x,y,z], normal:[x,y,z], distance:number, body:CANNON.Body, kind:string, ref:any }}
   */
  raycast(from, to, { mask = MASK_ALL, ignore = null, ignoreBodies = null, filter = null } = {}) {
    tmpFrom.set(from[0], from[1], from[2]);
    tmpTo.set(to[0], to[1], to[2]);
    let best = null;
    tmpRay.intersectWorld(this.world, {
      mode: CANNON.Ray.ALL,
      from: tmpFrom,
      to: tmpTo,
      skipBackfaces: true,
      collisionFilterMask: mask,
      callback: (r) => {
        const body = r.body;
        if (ignore && body === ignore) return;
        if (ignoreBodies && ignoreBodies.includes(body)) return;
        if (filter && !filter(body)) return;
        if (!best || r.distance < best.distance) {
          best = {
            point: [r.hitPointWorld.x, r.hitPointWorld.y, r.hitPointWorld.z],
            normal: [r.hitNormalWorld.x, r.hitNormalWorld.y, r.hitNormalWorld.z],
            distance: r.distance,
            body,
            kind: body.tankiKind,
            ref: body.tankiRef,
          };
        }
      },
    });
    return best;
  }

  /** All hits along the segment, sorted by distance (one per body: the closest point on that body). */
  raycastAll(from, to, { mask = MASK_ALL, ignore = null } = {}) {
    tmpFrom.set(from[0], from[1], from[2]);
    tmpTo.set(to[0], to[1], to[2]);
    const byBody = new Map();
    tmpRay.intersectWorld(this.world, {
      mode: CANNON.Ray.ALL,
      from: tmpFrom,
      to: tmpTo,
      skipBackfaces: true,
      collisionFilterMask: mask,
      callback: (r) => {
        const body = r.body;
        if (ignore && body === ignore) return;
        const prev = byBody.get(body.id);
        if (!prev || r.distance < prev.distance) {
          byBody.set(body.id, {
            point: [r.hitPointWorld.x, r.hitPointWorld.y, r.hitPointWorld.z],
            normal: [r.hitNormalWorld.x, r.hitNormalWorld.y, r.hitNormalWorld.z],
            distance: r.distance,
            body,
            kind: body.tankiKind,
            ref: body.tankiRef,
          });
        }
      },
    });
    return [...byBody.values()].sort((a, b) => a.distance - b.distance);
  }

  /** Line of sight between two points considering only static geometry. */
  hasLineOfSight(from, to) {
    return !this.raycast(from, to, { mask: MASK_STATIC });
  }
}
