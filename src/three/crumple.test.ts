import { describe, expect, it } from 'vitest';
import { applyFold, crumpleSheet, foldAmount, gridEdges, mulberry32, neatFoldSheet, noise3, planFolds, planNeatFolds } from './crumple';

const W = 1;
const H = 1.3;
const SX = 16;
const SY = 20;

// Same layout as three's PlaneGeometry: row-major, top row first.
function sheet(): Float32Array {
  const p = new Float32Array((SX + 1) * (SY + 1) * 3);
  for (let iy = 0; iy <= SY; iy++) {
    for (let ix = 0; ix <= SX; ix++) {
      const i = (iy * (SX + 1) + ix) * 3;
      p[i] = (ix / SX - 0.5) * W;
      p[i + 1] = (0.5 - iy / SY) * H;
    }
  }
  return p;
}

const GRID: [number, number] = [SX, SY];

const dist = (p: ArrayLike<number>, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('noise3', () => {
  it('is deterministic and bounded', () => {
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = [i * 0.37, i * 0.11 - 5, i * 0.73];
      const v = noise3(x, y, z, 3);
      expect(v).toBe(noise3(x, y, z, 3));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('planFolds', () => {
  it('makes 8-14 unit, perpendicular creases with angles in 100-170 degrees', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { folds } = planFolds(sheet(), seed, { grid: GRID });
      expect(folds.length).toBeGreaterThanOrEqual(8);
      expect(folds.length).toBeLessThanOrEqual(14);
      for (const f of folds) {
        expect(Math.hypot(...f.axis)).toBeCloseTo(1, 5);
        expect(Math.hypot(...f.normal)).toBeCloseTo(1, 5);
        expect(Math.abs(f.axis[0] * f.normal[0] + f.axis[1] * f.normal[1] + f.axis[2] * f.normal[2])).toBeLessThan(1e-6);
        expect(Math.abs(f.angle)).toBeGreaterThanOrEqual((100 * Math.PI) / 180 - 1e-9);
        expect(Math.abs(f.angle)).toBeLessThanOrEqual((170 * Math.PI) / 180 + 1e-9);
      }
    }
  });
});

describe('foldAmount', () => {
  it('opens the last fold first and closes it last', () => {
    expect(foldAmount(9, 10, 1)).toBe(1);
    expect(foldAmount(0, 10, 1)).toBe(1);
    // Unfolding from t = 1: the last fold is the one moving, every earlier fold stays closed.
    expect(foldAmount(9, 10, 0.95)).toBeCloseTo(0.5);
    expect(foldAmount(8, 10, 0.95)).toBe(1);
    // Nearly flat: only the first fold is still partly closed.
    expect(foldAmount(0, 10, 0.05)).toBeCloseTo(0.5);
    expect(foldAmount(1, 10, 0.05)).toBe(0);
    expect(foldAmount(5, 10, 0)).toBe(0);
  });
});

describe('crumpleSheet', () => {
  it('returns the original flat positions at t = 0', () => {
    const flat = sheet();
    expect(Array.from(crumpleSheet(flat, 7, 0, { grid: GRID }))).toEqual(Array.from(flat));
    expect(Array.from(crumpleSheet(flat, 7, 0, { squash: false, grid: GRID }))).toEqual(Array.from(flat));
  });

  it('gives the same output for the same seed, and a different one for another seed', () => {
    const flat = sheet();
    expect(Array.from(crumpleSheet(flat, 7, 0.6, { grid: GRID }))).toEqual(Array.from(crumpleSheet(flat, 7, 0.6, { grid: GRID })));
    expect(Array.from(crumpleSheet(flat, 7, 1, { grid: GRID }))).not.toEqual(Array.from(crumpleSheet(flat, 8, 1, { grid: GRID })));
  });

  it('does not mutate its input', () => {
    const flat = sheet();
    const copy = Array.from(flat);
    crumpleSheet(flat, 3, 1, { grid: GRID });
    expect(Array.from(flat)).toEqual(copy);
  });

  it('preserves grid edge lengths under the folds alone (squash disabled)', () => {
    const es = gridEdges(SX, SY);
    for (const seed of [1, 2, 3, 99]) {
      const flat = sheet();
      const { folds } = planFolds(flat, seed, { grid: GRID });
      // Replay the folds. An edge whose ends are not both in (or both out of) a flap at some
      // fold is one the crease passes through; every other edge moves rigidly.
      const cur = Float32Array.from(flat);
      const creased = new Set<number>();
      for (const f of folds) {
        es.forEach(([a, b], k) => f.mask![a] !== f.mask![b] && creased.add(k));
        applyFold(cur, f, 1);
      }
      expect(Array.from(crumpleSheet(flat, seed, 1, { squash: false, grid: GRID }))).toEqual(Array.from(cur));
      let checked = 0;
      es.forEach(([a, b], k) => {
        const ratio = dist(cur, a, b) / dist(flat, a, b);
        if (creased.has(k)) {
          // Creased edges may pinch, but never stretch into a spike.
          expect(ratio).toBeLessThan(2);
          return;
        }
        checked++;
        expect(Math.abs(dist(cur, a, b) - dist(flat, a, b))).toBeLessThan(1e-5);
      });
      expect(checked).toBeGreaterThan(es.length * 0.5);
    }
  });

  it('squashes the folded sheet into a ball of about the requested radius', () => {
    const R = 0.25;
    const p = crumpleSheet(sheet(), 5, 1, { radius: R, grid: GRID });
    let max = 0;
    for (let i = 0; i < p.length; i += 3) max = Math.max(max, Math.hypot(p[i], p[i + 1], p[i + 2]));
    expect(max).toBeLessThan(R * 1.2);
    expect(max).toBeGreaterThan(R * 0.5);
  });
});

describe('planNeatFolds', () => {
  const NX = 16;
  const NY = 24;
  const NGRID: [number, number] = [NX, NY];
  const flatSheet = (): Float32Array => {
    const p = new Float32Array((NX + 1) * (NY + 1) * 3);
    for (let iy = 0; iy <= NY; iy++) {
      for (let ix = 0; ix <= NX; ix++) {
        const i = (iy * (NX + 1) + ix) * 3;
        p[i] = (ix / NX - 0.5) * W;
        p[i + 1] = (0.5 - iy / NY) * H;
      }
    }
    return p;
  };

  it('plans 2-3 unit, perpendicular creases just under 180 degrees', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const { folds } = planNeatFolds(W, H, seed, { grid: NGRID });
      counts.add(folds.length);
      expect(folds.length).toBeGreaterThanOrEqual(2);
      expect(folds.length).toBeLessThanOrEqual(3);
      for (const f of folds) {
        expect(Math.hypot(...f.axis)).toBeCloseTo(1, 5);
        expect(Math.abs(f.axis[0] * f.normal[0] + f.axis[1] * f.normal[1] + f.axis[2] * f.normal[2])).toBeLessThan(1e-6);
        expect(Math.abs(f.angle)).toBeLessThan(Math.PI);
        expect(Math.abs(f.angle)).toBeGreaterThan((179 * Math.PI) / 180);
      }
    }
    expect(counts.size).toBe(2);
  });

  it('rejects grids whose creases would miss the vertex rows', () => {
    expect(() => planNeatFolds(W, H, 1, { grid: [16, 20] })).toThrow();
  });

  it('is exactly flat at t = 0, is deterministic, and does not mutate its input', () => {
    const flat = flatSheet();
    const copy = Array.from(flat);
    const plan = planNeatFolds(W, H, 5, { grid: NGRID });
    expect(Array.from(neatFoldSheet(flat, plan, 0, { relax: 0.01 }))).toEqual(copy);
    const a = neatFoldSheet(flat, plan, 1, { relax: 0.01, seed: 3 });
    expect(Array.from(a)).toEqual(Array.from(neatFoldSheet(flat, planNeatFolds(W, H, 5, { grid: NGRID }), 1, { relax: 0.01, seed: 3 })));
    expect(Array.from(flat)).toEqual(copy);
    expect(Array.from(a)).not.toEqual(Array.from(neatFoldSheet(flat, planNeatFolds(W, H, 6, { grid: NGRID }), 1, { relax: 0.01, seed: 3 })));
  });

  it('never pulls the folded parts apart while unfolding', () => {
    const es = gridEdges(NX, NY);
    const maxStretch = (out: Float32Array, flat: Float32Array) =>
      Math.max(...es.map(([a, b]) => dist(out, a, b) / dist(flat, a, b)));
    for (const seed of [1, 2, 3, 99]) {
      const flat = flatSheet();
      const plan = planNeatFolds(W, H, seed, { grid: NGRID });
      // Folded, edges where two creases cross shear a little (layers bend with different radii),
      // as real paper does. Wrapping is otherwise isometric, so unfolding must never stretch any
      // edge beyond that: a torn sheet (folds opening in the wrong order) stretched edges ~10x.
      const folded = maxStretch(neatFoldSheet(flat, plan, 1), flat);
      expect(folded).toBeLessThan(2.5);
      for (let t = 0; t < 1; t += 0.05) expect(maxStretch(neatFoldSheet(flat, plan, t), flat)).toBeLessThan(folded + 0.05);
    }
  });

  it('folds the sheet down to about (w / 2^a) x (h / 2^b), stacked above the sheet plane', () => {
    for (const seed of [1, 2, 3, 4]) {
      const plan = planNeatFolds(W, H, seed, { grid: NGRID, count: 3 });
      const out = neatFoldSheet(flatSheet(), plan, 1);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < out.length; i++) {
        min[i % 3] = Math.min(min[i % 3], out[i]);
        max[i % 3] = Math.max(max[i % 3], out[i]);
      }
      // 1 x 1.3 folds to 1 x 0.65, then 0.5 x 0.65, then 0.5 x 0.325.
      expect(max[0] - min[0]).toBeCloseTo(0.5, 1);
      expect(max[1] - min[1]).toBeCloseTo(0.325, 1);
      expect(max[2] - min[2]).toBeGreaterThan(0.004 * 3);
      expect(max[2] - min[2]).toBeLessThan(0.1);
    }
  });
});
