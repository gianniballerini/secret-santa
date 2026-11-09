import { Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { JAR } from './jarGeometry';
import { createPaperPile } from './paper';
import { createJarPhysics, initPhysics, poseAt } from './physics';
import type { JarPhysics } from './physics';

const INNER = JAR.radius - JAR.wall;

describe('jar physics', () => {
  let physics: JarPhysics;
  let count = 0;

  beforeAll(async () => {
    await initPhysics();
    const pile = await createPaperPile();
    count = pile.slips.length;
    physics = createJarPhysics(pile.slips.map(({ geometry, position }) => ({ geometry, position })));
    physics.settle();
  }, 60_000);

  const centres = () => {
    const snap = physics.snapshot();
    return Array.from({ length: count }, (_, i) => poseAt(snap, i).position);
  };

  it('keeps every settled slip inside the glass and above the floor', () => {
    for (const p of centres()) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(INNER);
      expect(p.y).toBeGreaterThan(JAR.floorY);
      expect(p.y).toBeLessThan(JAR.lipY);
    }
  });

  it('restores the snapshot exactly after being shaken', () => {
    const before = physics.snapshot();
    const jar = new Matrix4();
    physics.kick(1);
    for (let i = 0; i < 20; i++) physics.step(1 / 60, jar.makeRotationZ(Math.sin(i) * 0.1));
    expect(physics.snapshot()).not.toEqual(before);
    physics.restore(before, new Matrix4());
    // Rapier re-normalises the quaternions, so equal to float precision rather than bit for bit.
    const after = physics.snapshot();
    expect(after).toHaveLength(before.length);
    before.forEach((v, i) => expect(after[i]).toBeCloseTo(v, 5));
  });

  it('keeps the slips in the jar through a hard shake', () => {
    physics.restore(physics.snapshot(), new Matrix4());
    const jar = new Matrix4();
    const tilt = new Quaternion();
    const one = new Vector3(1, 1, 1);
    for (let i = 0; i < 90; i++) {
      tilt.setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(i * 0.9) * 0.15);
      physics.step(1 / 60, jar.compose(new Vector3(Math.sin(i * 1.3) * 0.1, 0, 0), tilt, one));
      if (i % 10 === 0) physics.kick(1);
    }
    for (let i = 0; i < 120; i++) physics.step(1 / 60, jar.identity());
    for (const p of centres()) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(INNER);
      expect(p.y).toBeGreaterThan(JAR.floorY);
      expect(p.y).toBeLessThan(JAR.lipY);
    }
  });
});
