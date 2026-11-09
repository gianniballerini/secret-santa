import { describe, expect, it } from 'vitest';
import { clamp01, cubicBezier, easeInCubic, easeInOutCubic, easeOut, easePop, linear } from './tween';

describe('easings', () => {
  const all = { linear, easeInCubic, easeInOutCubic, easeOut, easePop };

  it('start at 0 and end at 1', () => {
    for (const [name, ease] of Object.entries(all)) {
      expect(ease(0), name).toBeCloseTo(0, 5);
      expect(ease(1), name).toBeCloseTo(1, 5);
    }
  });

  it('clamp input outside 0..1', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(easeInOutCubic(-3)).toBe(0);
    expect(easeInOutCubic(3)).toBe(1);
  });

  it('easeOut is monotonic and front-loaded', () => {
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = easeOut(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('easePop overshoots past 1 before settling', () => {
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => easePop((i + 1) / 50)));
    expect(peak).toBeGreaterThan(1);
  });

  it('cubicBezier(0,0,1,1) is linear', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.4, 0.75]) expect(lin(x)).toBeCloseTo(x, 3);
  });
});
