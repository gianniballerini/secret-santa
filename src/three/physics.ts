import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { mulberry32 } from './crumple';
import { createJarInnerProfile, JAR } from './jarGeometry';

/**
 * A tiny position-based solver for the paper slips. Each slip is a flat disc (footprint radius and
 * half-thickness from its geometry) living in jar space: gravity and the jar's motion arrive as
 * inertial effects, discs push each other apart mostly vertically so they stack, and the round
 * inner wall, floor and lid keep them in. Orientation is cosmetic: slips tumble when thrown and ease
 * back to their resting tilt once they touch something.
 *
 * Lengths are scene units; the jar is ~1 unit wide.
 */
export const PHYSICS = {
  gravity: -9.81 * 3.5, // scaled so the ~1-unit jar feels hand-sized
  step: 1 / 120, // fixed timestep, in seconds
  maxSubsteps: 4, // per frame; the rest of a long frame is dropped
  iterations: 4, // constraint passes per step
  footprint: 0.45, // share of a slip's half-width that collides with other slips: paper overlaps
  thickness: 0.3, // share of a slip's half-height that collides: crumpled sheets nest into each other
  wallReach: 0.65, // share of a slip's horizontal reach kept off the glass
  spread: 0.15, // how much of a slip-on-slip overlap is also resolved sideways
  friction: 0.8, // Coulomb-like: tangential slide cancelled per unit of contact depth
  linearDamping: 0.6, // paper is light and draggy
  angularDamping: 0.8,
  restTilt: 0.08, // per step, how fast a touching slip eases back to its resting tilt
  contactSpinDamping: 0.85, // per step, angular velocity kept while touching something
  spinDrag: 0.15, // share of the jar's turn a touching slip does NOT follow
  sleep: { speed: 0.02, steps: 60 }, // below this speed (units/s) for this many steps, a slip rests
  settleSteps: 240, // headless steps to bring a fresh scatter to rest
  kick: { up: 4, spread: 1.5, spin: 8 }, // velocity change per shake jolt (units/s, units/s, rad/s)
  swirl: { accel: 90, lift: 0.25 }, // tangential acceleration (units/s^2) and the share of gravity it cancels
};

export interface BodyInit {
  /** Centred at its own origin. */
  geometry: BufferGeometry;
  position: Vector3;
  quaternion?: Quaternion;
}

/** Flat pose list in jar space: per body, position (3) then quaternion (4). */
export type Snapshot = Float32Array;

const STRIDE = 7;

export function poseAt(snap: Snapshot, i: number): { position: Vector3; quaternion: Quaternion } {
  const o = i * STRIDE;
  return {
    position: new Vector3(snap[o], snap[o + 1], snap[o + 2]),
    quaternion: new Quaternion(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]),
  };
}

export interface JarPhysics {
  /** Advances by `dt` seconds with the jar at the pose of `jarWorld`. */
  step(dt: number, jarWorld: Matrix4): void;
  /** Writes jar-local poses into `meshes`, index-aligned with the bodies. */
  sync(meshes: Object3D[]): void;
  snapshot(): Snapshot;
  /** Puts every body back on the snapshot's poses, at rest. The jar is teleported to `jarWorld` (default: where it is). */
  restore(snap: Snapshot, jarWorld?: Matrix4): void;
  /** Throws the slips up with some spread and spin. */
  kick(strength?: number): void;
  /** Tangential push around the jar axis; call every frame with the frame's `dt` and an envelope 0..1. */
  swirl(amount: number, dt: number): void;
  setLid(on: boolean): void;
  /** Adds or removes a body from the simulation (e.g. the note once it is picked). */
  setActive(index: number, on: boolean): void;
  /** Runs fixed steps with the jar standing still. */
  settle(steps?: number): void;
  dispose(): void;
}

interface Body {
  pos: Vector3;
  prev: Vector3; // position one step ago: velocity is (pos - prev) / step
  quat: Quaternion;
  angVel: Vector3;
  restSwing: Quaternion; // resting tilt, without the yaw
  home: Float32Array; // creation pose, for the escape safety net
  radius: number; // footprint against other slips
  half: number; // half-thickness against slips, floor and lid
  reach: number; // horizontal reach against the glass
  active: boolean;
  touching: boolean;
  still: number; // consecutive slow steps
}

// The collision proxy of a geometry at its initial orientation.
function proxy(geo: BufferGeometry, q: Quaternion): { radius: number; half: number; reach: number } {
  const pos = geo.attributes.position;
  const v = new Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  let maxZ = 0;
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyQuaternion(q);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    maxX = Math.max(maxX, Math.abs(v.x));
    maxZ = Math.max(maxZ, Math.abs(v.z));
    reach = Math.max(reach, Math.hypot(v.x, v.z));
  }
  return {
    radius: Math.max(maxX, maxZ) * PHYSICS.footprint,
    half: Math.max(((maxY - minY) / 2) * PHYSICS.thickness, 0.01),
    reach: reach * PHYSICS.wallReach,
  };
}

// Inner glass radius at height y, from the same profile the jar is turned from (round, not faceted).
function createInnerRadius(): (y: number) => number {
  const profile = createJarInnerProfile().filter((p) => p.x > 0); // top to bottom
  const top = profile[0];
  const bottom = profile[profile.length - 1];
  return (y) => {
    if (y >= top.y) return top.x;
    if (y <= bottom.y) return bottom.x;
    for (let k = 0; k < profile.length - 1; k++) {
      const a = profile[k];
      const b = profile[k + 1];
      if (y <= a.y && y >= b.y) return a.y === b.y ? Math.min(a.x, b.x) : b.x + ((y - b.y) / (a.y - b.y)) * (a.x - b.x);
    }
    return bottom.x;
  };
}

// Twist (rotation about +Y) of a quaternion; swing is q * twist^-1.
function twistY(q: Quaternion, out: Quaternion): Quaternion {
  const len = Math.hypot(q.y, q.w);
  return len < 1e-9 ? out.identity() : out.set(0, q.y / len, 0, q.w / len);
}

/** The jar stands at the origin until the first `step`. */
export function createJarPhysics(inits: BodyInit[]): JarPhysics {
  const innerRadius = createInnerRadius();
  const swing = new Quaternion();
  const twist = new Quaternion();

  const bodies: Body[] = inits.map(({ geometry, position, quaternion }) => {
    const q = quaternion?.clone() ?? new Quaternion();
    return {
      pos: position.clone(),
      prev: position.clone(),
      quat: q,
      angVel: new Vector3(),
      restSwing: q.clone().multiply(twistY(q, twist).invert()),
      home: Float32Array.of(position.x, position.y, position.z, q.x, q.y, q.z, q.w),
      ...proxy(geometry, q),
      active: true,
      touching: false,
      still: 0,
    };
  });

  const rand = mulberry32(31337);
  let lidOn = true;
  let primed = false;
  let acc = 0;
  // Jar pose: where it was at the last substep, and where it is now.
  const fromPos = new Vector3();
  const fromQuat = new Quaternion();
  const toPos = new Vector3();
  const toQuat = new Quaternion();
  const scale = new Vector3();
  // The jar's last substep displacement in jar space, to turn its acceleration into inertia.
  const lastShift = new Vector3();

  const gravity = new Vector3();
  const v = new Vector3();
  const n = new Vector3();
  const tmp = new Vector3();
  const subPos = new Vector3();
  const subQuat = new Quaternion();
  const prevSubPos = new Vector3();
  const prevSubQuat = new Quaternion();
  const turn = new Quaternion();
  const partialTurn = new Quaternion();
  const invQuat = new Quaternion();
  const dq = new Quaternion();

  const asleep = (b: Body) => b.still > PHYSICS.sleep.steps;
  const wake = (b: Body) => {
    b.still = 0;
  };

  // Moves a body by `d` (pushing out of a contact with normal `nx,ny,nz` and depth `depth`), with friction.
  const push = (b: Body, dx: number, dy: number, dz: number, depth: number, nx: number, ny: number, nz: number) => {
    if (asleep(b) && dx * dx + dy * dy + dz * dz > 1e-10) wake(b);
    b.pos.x += dx;
    b.pos.y += dy;
    b.pos.z += dz;
    b.touching = true;
    // Friction: cancel (some of) the slide along the contact.
    v.subVectors(b.pos, b.prev);
    n.set(nx, ny, nz);
    tmp.copy(n).multiplyScalar(v.dot(n));
    v.sub(tmp); // tangential part
    const slide = v.length();
    if (slide < 1e-12) return;
    const cancel = Math.min(1, (PHYSICS.friction * depth) / slide);
    b.pos.addScaledVector(v, -cancel);
  };

  const collideGlass = (b: Body) => {
    // Floor and lid.
    const floor = JAR.floorY + b.half;
    if (b.pos.y < floor) push(b, 0, floor - b.pos.y, 0, floor - b.pos.y, 0, 1, 0);
    const ceiling = JAR.lipY - b.half;
    if (lidOn && b.pos.y > ceiling) push(b, 0, ceiling - b.pos.y, 0, b.pos.y - ceiling, 0, -1, 0);
    // Wall: the narrowest glass over the slip's height.
    const inner = Math.min(innerRadius(b.pos.y - b.half), innerRadius(b.pos.y), innerRadius(b.pos.y + b.half));
    const limit = Math.max(inner - b.reach, 0);
    const r = Math.hypot(b.pos.x, b.pos.z);
    if (r > limit) {
      const depth = r - limit;
      const nx = -b.pos.x / r;
      const nz = -b.pos.z / r;
      push(b, nx * depth, 0, nz * depth, depth, nx, 0, nz);
    }
  };

  const collidePair = (a: Body, b: Body) => {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const reach = a.radius + b.radius;
    const dh2 = dx * dx + dz * dz;
    if (dh2 >= reach * reach) return;
    const dy = b.pos.y - a.pos.y;
    const gap = a.half + b.half;
    if (Math.abs(dy) >= gap) return;
    if (asleep(a) && asleep(b)) return; // a resting pile stays put
    const depth = gap - Math.abs(dy);
    const up = dy >= 0 ? 1 : -1; // b is the upper one when up = 1
    const dh = Math.sqrt(dh2) || 1e-6;
    const side = Math.min(reach - dh, depth) * PHYSICS.spread * 0.5;
    const sx = dh2 > 1e-12 ? (dx / dh) * side : 0;
    const sz = dh2 > 1e-12 ? (dz / dh) * side : 0;
    push(b, sx, (up * depth) / 2, sz, depth / 2, 0, up, 0);
    push(a, -sx, (-up * depth) / 2, -sz, depth / 2, 0, -up, 0);
  };

  // A slip that got out of the glass goes back where it started.
  const rescue = (b: Body) => {
    const limit = JAR.radius - JAR.wall;
    const { x, y, z } = b.pos;
    if (Math.hypot(x, z) > limit || y < JAR.floorY - 0.1 || y > JAR.lipY + 2 || !Number.isFinite(x + y + z)) {
      place(b, b.home);
    }
  };

  // Puts a body at a jar-space pose, at rest.
  const place = (b: Body, p: ArrayLike<number>) => {
    b.pos.set(p[0], p[1], p[2]);
    b.prev.copy(b.pos);
    b.quat.set(p[3], p[4], p[5], p[6]);
    b.angVel.set(0, 0, 0);
    b.still = PHYSICS.sleep.steps + 1;
  };

  // One fixed step. `shift` is the jar's displacement and `rot` its turn this step, both in jar space.
  const substep = (shift: Vector3 | null, rot: Quaternion | null) => {
    const h = PHYSICS.step;
    gravity.set(0, PHYSICS.gravity, 0).applyQuaternion(invQuat.copy(toQuat).invert());
    const linKeep = 1 / (1 + PHYSICS.linearDamping * h);
    const angKeep = 1 / (1 + PHYSICS.angularDamping * h);

    for (const b of bodies) {
      if (!b.active || asleep(b)) continue;
      // The jar moved under the slip: the slip keeps its world position, so in jar space it moves back.
      // Only the change of the jar's displacement counts (constant motion is no force).
      if (shift) b.pos.addScaledVector(shift, -1).add(lastShift);
      // The jar turned: a loose slip keeps its world pose, a touching one mostly turns with the glass.
      if (rot) {
        partialTurn.identity().slerp(rot, b.touching ? PHYSICS.spinDrag : 1).invert();
        b.pos.applyQuaternion(partialTurn);
        b.prev.applyQuaternion(partialTurn);
        b.quat.premultiply(partialTurn);
      }
      // Verlet with damping.
      v.subVectors(b.pos, b.prev).multiplyScalar(linKeep);
      b.prev.copy(b.pos);
      b.pos.add(v).addScaledVector(gravity, h * h);
      b.touching = false;
    }

    for (let it = 0; it < PHYSICS.iterations; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (!a.active) continue;
        for (let j = i + 1; j < bodies.length; j++) if (bodies[j].active) collidePair(a, bodies[j]);
      }
      for (const b of bodies) if (b.active) collideGlass(b);
    }

    const sleepStep = (PHYSICS.sleep.speed * h) ** 2;
    for (const b of bodies) {
      if (!b.active) continue;
      if (asleep(b)) {
        b.prev.copy(b.pos);
        continue;
      }
      // Tumble; touching slips lose their spin and ease back to their resting tilt (yaw is free).
      b.angVel.multiplyScalar(b.touching ? PHYSICS.contactSpinDamping : angKeep);
      const w = b.angVel.length();
      if (w > 1e-6) b.quat.premultiply(dq.setFromAxisAngle(tmp.copy(b.angVel).divideScalar(w), w * h));
      if (b.touching) {
        twistY(b.quat, twist);
        b.quat.slerp(swing.copy(b.restSwing).multiply(twist), PHYSICS.restTilt);
      }
      b.quat.normalize();
      b.still = b.pos.distanceToSquared(b.prev) < sleepStep && w < 0.1 ? b.still + 1 : 0;
      rescue(b);
    }
  };

  return {
    step(dt, jarWorld) {
      jarWorld.decompose(toPos, toQuat, scale);
      if (!primed) {
        fromPos.copy(toPos);
        fromQuat.copy(toQuat);
        primed = true;
      }
      acc = Math.min(acc + dt, PHYSICS.maxSubsteps * PHYSICS.step);
      const count = Math.floor(acc / PHYSICS.step);
      if (!count) return;
      acc -= count * PHYSICS.step;
      // A still jar is left alone, so a resting pile stays asleep.
      const moving = fromPos.distanceToSquared(toPos) > 1e-12 || 1 - Math.abs(fromQuat.dot(toQuat)) > 1e-10;
      if (moving) for (const b of bodies) wake(b);
      const shift = new Vector3();
      for (let k = 1; k <= count; k++) {
        if (moving) {
          // Spread the frame's jar motion over the substeps.
          const t = k / count;
          prevSubPos.lerpVectors(fromPos, toPos, (k - 1) / count);
          prevSubQuat.copy(fromQuat).slerp(toQuat, (k - 1) / count);
          subPos.lerpVectors(fromPos, toPos, t);
          subQuat.copy(fromQuat).slerp(toQuat, t);
          shift.subVectors(subPos, prevSubPos).applyQuaternion(invQuat.copy(subQuat).invert());
          turn.copy(prevSubQuat).invert().multiply(subQuat);
          substep(shift, turn);
          lastShift.copy(shift);
        } else {
          substep(lastShift.lengthSq() ? shift.set(0, 0, 0) : null, null);
          lastShift.set(0, 0, 0);
        }
      }
      fromPos.copy(toPos);
      fromQuat.copy(toQuat);
    },

    sync(meshes) {
      bodies.forEach((b, i) => {
        const mesh = meshes[i];
        if (!b.active || !mesh) return;
        mesh.position.copy(b.pos);
        mesh.quaternion.copy(b.quat);
      });
    },

    snapshot() {
      const snap = new Float32Array(bodies.length * STRIDE);
      bodies.forEach(({ pos, quat }, i) => snap.set([pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w], i * STRIDE));
      return snap;
    },

    restore(snap, jarWorld) {
      if (jarWorld) {
        jarWorld.decompose(toPos, toQuat, scale);
        fromPos.copy(toPos);
        fromQuat.copy(toQuat);
        primed = true;
        acc = 0;
        lastShift.set(0, 0, 0);
      }
      bodies.forEach((b, i) => place(b, snap.subarray(i * STRIDE, (i + 1) * STRIDE)));
    },

    kick(strength = 1) {
      const { up, spread, spin } = PHYSICS.kick;
      const h = PHYSICS.step;
      for (const b of bodies) {
        if (!b.active) continue;
        wake(b);
        // A velocity change is a change of the step's displacement.
        b.prev.x -= (rand() - 0.5) * 2 * spread * strength * h;
        b.prev.y -= up * strength * (0.5 + rand() * 0.5) * h;
        b.prev.z -= (rand() - 0.5) * 2 * spread * strength * h;
        b.angVel.x += (rand() - 0.5) * 2 * spin * strength;
        b.angVel.y += (rand() - 0.5) * 2 * spin * strength;
        b.angVel.z += (rand() - 0.5) * 2 * spin * strength;
      }
    },

    swirl(amount, dt) {
      const { accel, lift } = PHYSICS.swirl;
      const h = PHYSICS.step;
      for (const b of bodies) {
        if (!b.active) continue;
        wake(b);
        const r = Math.hypot(b.pos.x, b.pos.z) || 1;
        const dv = accel * amount * dt;
        b.prev.x += (b.pos.z / r) * dv * h;
        b.prev.y += PHYSICS.gravity * lift * amount * dt * h;
        b.prev.z -= (b.pos.x / r) * dv * h;
      }
    },

    setLid(on) {
      lidOn = on;
      if (!on) for (const b of bodies) wake(b);
    },

    setActive(index, on) {
      const b = bodies[index];
      b.active = on;
      if (on) {
        b.prev.copy(b.pos);
        b.angVel.set(0, 0, 0);
        wake(b);
      }
    },

    settle(steps = PHYSICS.settleSteps) {
      for (let i = 0; i < steps; i++) substep(null, null);
    },

    dispose() {},
  };
}
