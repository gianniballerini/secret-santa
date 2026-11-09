import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { mulberry32 } from './crumple';
import { createJarInnerProfile, JAR } from './jarGeometry';

/** Tuning knobs for the paper physics. Lengths are scene units, the jar is ~1 unit wide. */
export const PHYSICS = {
  gravity: -9.81 * 3.5, // scaled so the ~1-unit jar feels hand-sized
  step: 1 / 120, // fixed timestep, in seconds
  maxSubsteps: 4, // per frame; the rest of a long frame is dropped
  solverIterations: 8, // stiffer stacking: thin slips on a pile jitter at the default 4
  hullRadius: 0.008, // rounding of each slip's convex hull: gives near-flat folds thickness
  restitution: 0.1,
  friction: 0.8,
  linearDamping: 0.6, // paper is light and draggy
  angularDamping: 0.8,
  density: 1,
  jarSegments: 32, // around the axis, for the inner-wall trimesh
  lidThickness: 0.05, // half-height of the cap that closes the neck
  settleSteps: 240, // headless steps to bring a fresh scatter to rest
  kick: { up: 4, spread: 1.5, spin: 8 }, // velocity change per shake jolt (units/s, units/s, rad/s)
  swirl: { accel: 90, lift: 0.25 }, // tangential acceleration (units/s^2) and the share of gravity it cancels
};

let ready: Promise<void> | null = null;
/** Loads the Rapier WASM once. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

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

// Unique vertex positions of a (usually non-indexed) geometry.
function hullPoints(geo: BufferGeometry): Float32Array {
  const pos = geo.attributes.position;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x, y, z);
  }
  return Float32Array.from(out);
}

function slipCollider(geo: BufferGeometry): RAPIER.ColliderDesc {
  const hull = RAPIER.ColliderDesc.roundConvexHull(hullPoints(geo), PHYSICS.hullRadius);
  if (hull) return hull;
  // Degenerate (flat) point cloud: fall back to its bounding box.
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new Vector3());
  return RAPIER.ColliderDesc.cuboid(size.x / 2, Math.max(size.y, 0.02) / 2, size.z / 2);
}

// The inner glass as a lathe of the inner profile, swept `jarSegments` times around the axis.
function innerWall(): { vertices: Float32Array; indices: Uint32Array } {
  const profile = createJarInnerProfile();
  const seg = PHYSICS.jarSegments;
  const n = profile.length;
  const vertices = new Float32Array(seg * n * 3);
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    profile.forEach((p, k) => vertices.set([p.x * Math.cos(a), p.y, p.x * Math.sin(a)], (s * n + k) * 3));
  }
  const indices: number[] = [];
  for (let s = 0; s < seg; s++) {
    for (let k = 0; k < n - 1; k++) {
      const a = s * n + k;
      const b = ((s + 1) % seg) * n + k;
      if (profile[k + 1].x === 0) indices.push(a, a + 1, b); // the ring collapses onto the axis
      else indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  return { vertices, indices: Uint32Array.from(indices) };
}

interface Entry {
  body: RAPIER.RigidBody;
  home: Float32Array; // creation pose, for the escape safety net
  active: boolean;
}

/** Call `initPhysics()` first. The jar stands at the origin until the first `step`. */
export function createJarPhysics(inits: BodyInit[]): JarPhysics {
  const world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
  world.timestep = PHYSICS.step;
  world.integrationParameters.numSolverIterations = PHYSICS.solverIterations;

  const jar = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const { vertices, indices } = innerWall();
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(PHYSICS.friction).setRestitution(PHYSICS.restitution),
    jar,
  );
  const lid = world.createCollider(
    RAPIER.ColliderDesc.cuboid(JAR.neckRadius, PHYSICS.lidThickness, JAR.neckRadius)
      .setTranslation(0, JAR.lipY + PHYSICS.lidThickness, 0)
      .setFriction(PHYSICS.friction)
      .setRestitution(PHYSICS.restitution),
    jar,
  );

  const entries: Entry[] = inits.map(({ geometry, position, quaternion }) => {
    const q = quaternion ?? new Quaternion();
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true)
      .setLinearDamping(PHYSICS.linearDamping)
      .setAngularDamping(PHYSICS.angularDamping)
      .setCanSleep(true);
    const body = world.createRigidBody(desc);
    world.createCollider(
      slipCollider(geometry).setRestitution(PHYSICS.restitution).setFriction(PHYSICS.friction).setDensity(PHYSICS.density),
      body,
    );
    return { body, home: Float32Array.of(position.x, position.y, position.z, q.x, q.y, q.z, q.w), active: true };
  });

  const rand = mulberry32(31337);
  // Jar pose: where it was at the last substep, and where it is now.
  const fromPos = new Vector3();
  const fromQuat = new Quaternion();
  const toPos = new Vector3();
  const toQuat = new Quaternion();
  const scale = new Vector3();
  const pos = new Vector3();
  const quat = new Quaternion();
  const inv = new Quaternion();
  const tmp = new Quaternion();
  let primed = false;
  let acc = 0;

  // Puts a body at a jar-space pose, at rest.
  const place = (e: Entry, p: ArrayLike<number>) => {
    pos.set(p[0], p[1], p[2]).applyQuaternion(toQuat).add(toPos);
    quat.copy(toQuat).multiply(tmp.set(p[3], p[4], p[5], p[6]));
    e.body.setTranslation(pos, true);
    e.body.setRotation(quat, true);
    e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };

  // A slip that got out of the glass (tunnelling at a hard fling) goes back where it started.
  const rescue = () => {
    const limit = JAR.radius - JAR.wall;
    for (const e of entries) {
      if (!e.active) continue;
      const t = e.body.translation();
      pos.set(t.x, t.y, t.z).sub(toPos).applyQuaternion(inv.copy(toQuat).invert());
      if (Math.hypot(pos.x, pos.z) > limit || pos.y < JAR.floorY - 0.1 || !Number.isFinite(pos.y)) place(e, e.home);
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
      const n = Math.floor(acc / PHYSICS.step);
      if (!n) return;
      acc -= n * PHYSICS.step;
      // A still jar is left alone: setting its pose, even unchanged, wakes the pile and keeps it twitching.
      const moving = fromPos.distanceToSquared(toPos) > 1e-12 || 1 - Math.abs(fromQuat.dot(toQuat)) > 1e-10;
      // Spread the frame's jar motion over the substeps so the kinematic velocity stays right.
      for (let k = 1; k <= n; k++) {
        if (moving) {
          const t = k / n;
          pos.lerpVectors(fromPos, toPos, t);
          quat.copy(fromQuat).slerp(toQuat, t);
          jar.setNextKinematicTranslation(pos);
          jar.setNextKinematicRotation(quat);
        }
        world.step();
      }
      fromPos.copy(toPos);
      fromQuat.copy(toQuat);
      rescue();
    },

    sync(meshes) {
      inv.copy(toQuat).invert();
      entries.forEach((e, i) => {
        const mesh = meshes[i];
        if (!e.active || !mesh) return;
        const t = e.body.translation();
        const r = e.body.rotation();
        mesh.position.set(t.x, t.y, t.z).sub(toPos).applyQuaternion(inv);
        mesh.quaternion.copy(inv).multiply(tmp.set(r.x, r.y, r.z, r.w));
      });
    },

    snapshot() {
      const snap = new Float32Array(entries.length * STRIDE);
      inv.copy(toQuat).invert();
      entries.forEach(({ body }, i) => {
        const t = body.translation();
        const r = body.rotation();
        pos.set(t.x, t.y, t.z).sub(toPos).applyQuaternion(inv);
        quat.copy(inv).multiply(tmp.set(r.x, r.y, r.z, r.w));
        snap.set([pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w], i * STRIDE);
      });
      return snap;
    },

    restore(snap, jarWorld) {
      if (jarWorld) {
        jarWorld.decompose(toPos, toQuat, scale);
        fromPos.copy(toPos);
        fromQuat.copy(toQuat);
        primed = true;
        acc = 0;
        jar.setTranslation(toPos, true);
        jar.setRotation(toQuat, true);
      }
      entries.forEach((e, i) => place(e, snap.subarray(i * STRIDE, (i + 1) * STRIDE)));
    },

    kick(strength = 1) {
      const { up, spread, spin } = PHYSICS.kick;
      for (const { body, active } of entries) {
        if (!active) continue;
        const v = body.linvel();
        const w = body.angvel();
        body.setLinvel(
          { x: v.x + (rand() - 0.5) * 2 * spread * strength, y: v.y + up * strength * (0.5 + rand() * 0.5), z: v.z + (rand() - 0.5) * 2 * spread * strength },
          true,
        );
        body.setAngvel(
          { x: w.x + (rand() - 0.5) * 2 * spin * strength, y: w.y + (rand() - 0.5) * 2 * spin * strength, z: w.z + (rand() - 0.5) * 2 * spin * strength },
          true,
        );
      }
    },

    swirl(amount, dt) {
      const { accel, lift } = PHYSICS.swirl;
      for (const { body, active } of entries) {
        if (!active) continue;
        const t = body.translation();
        const r = Math.hypot(t.x, t.z) || 1;
        const v = body.linvel();
        const dv = accel * amount * dt;
        body.setLinvel(
          { x: v.x - (t.z / r) * dv, y: v.y - PHYSICS.gravity * lift * amount * dt, z: v.z + (t.x / r) * dv },
          true,
        );
      }
    },

    setLid(on) {
      lid.setEnabled(on);
    },

    setActive(index, on) {
      const e = entries[index];
      e.active = on;
      e.body.setEnabled(on);
    },

    settle(steps = PHYSICS.settleSteps) {
      for (let i = 0; i < steps; i++) world.step();
    },

    dispose() {
      world.free();
    },
  };
}
