import { Mesh, Quaternion, Vector3 } from 'three';
import { JAR } from './jarGeometry';
import { clamp01, lerp } from './tween';

const TAU = Math.PI * 2;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Pose of the note in jar space. */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

/** Tuning knobs for the scripted note. */
export const STIR = {
  noteClearance: 0.18, // gap between the note and the glass while it rides the stir
  noteTumble: 0.6, // radians of extra tumble on the note
};

const tumbleAxis = new Vector3(1, 0.4, 0.2).normalize();
const tumble = new Quaternion();

/**
 * The picked note: orbits like the swirling pile while rising from its place in the pile, then leaves
 * through the neck along the same arc. Ends exactly on `to`. s in 0..1.
 */
export function stirNote(mesh: Mesh, s: number, from: Pose, to: Pose): void {
  if (s <= 0) {
    mesh.position.copy(from.position);
    mesh.quaternion.copy(from.quaternion);
    return;
  }
  if (s >= 1) {
    mesh.position.copy(to.position);
    mesh.quaternion.copy(to.quaternion);
    return;
  }
  const e = smooth(s);
  const a0 = Math.atan2(from.position.z, from.position.x);
  const aEnd = Math.atan2(to.position.z, to.position.x);
  // At least one full turn, ending exactly on the exit angle.
  const sweep = ((((aEnd - a0) % TAU) + TAU) % TAU) + TAU;
  const a = a0 + sweep * e;
  const r0 = Math.hypot(from.position.x, from.position.z);
  const r1 = Math.hypot(to.position.x, to.position.z);
  const y = lerp(from.position.y, to.position.y, e) + 0.08 * Math.sin(Math.PI * s) * Math.sin(TAU * 2 * s);
  // Inside the glass: wall radius on the body, neck radius above the shoulder, free above the lip.
  const neck = smooth(clamp01((y - (JAR.shoulderY - 0.3)) / (JAR.neckY + 0.1 - (JAR.shoulderY - 0.3))));
  const free = smooth(clamp01((y - JAR.lipY) / 0.3));
  const limit = lerp(lerp(JAR.radius, JAR.neckRadius, neck) - JAR.wall - STIR.noteClearance, 10, free);
  const r = Math.min(lerp(r0, r1, e), limit);
  mesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
  tumble.setFromAxisAngle(tumbleAxis, STIR.noteTumble * Math.sin(Math.PI * s) * Math.sin(TAU * 1.5 * s));
  mesh.quaternion.copy(from.quaternion).slerp(to.quaternion, e).premultiply(tumble);
}
