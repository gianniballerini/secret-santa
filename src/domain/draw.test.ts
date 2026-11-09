import { describe, expect, it } from 'vitest';
import { draw } from './draw';

describe('draw', () => {
  it('has no self-matches and is a permutation (n=3..10, 1000 runs each)', () => {
    for (let n = 3; n <= 10; n++) {
      const people = Array.from({ length: n }, (_, i) => `p${i}`);
      for (let run = 0; run < 1000; run++) {
        const pairs = draw(people);
        expect(pairs).toHaveLength(n);
        expect(pairs.every((p) => p.giver !== p.recipient)).toBe(true);
        expect(new Set(pairs.map((p) => p.giver)).size).toBe(n);
        expect(new Set(pairs.map((p) => p.recipient)).size).toBe(n);
        expect(pairs.map((p) => p.giver)).toEqual(people);
      }
    }
  });

  it('throws for fewer than 3 participants', () => {
    expect(() => draw([])).toThrow();
    expect(() => draw(['a'])).toThrow();
    expect(() => draw(['a', 'b'])).toThrow();
  });
});
