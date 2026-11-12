import { describe, expect, it } from 'vitest';
import { draw, DrawImpossibleError } from './draw';

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

  it('never pairs a forbidden giver and recipient', () => {
    const group: Record<string, string> = { ana: 'perez', juan: 'perez', sofi: 'fazio', leo: 'fazio', mia: '' };
    const people = Object.keys(group);
    const forbidden = (a: string, b: string) => group[a] !== '' && group[a] === group[b];
    const seen = new Set<string>();
    for (let run = 0; run < 1000; run++) {
      const pairs = draw(people, forbidden);
      expect(new Set(pairs.map((p) => p.recipient)).size).toBe(people.length);
      for (const { giver, recipient } of pairs) {
        expect(giver).not.toBe(recipient);
        expect(forbidden(giver, recipient)).toBe(false);
      }
      seen.add(pairs.map((p) => p.recipient).join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('throws DrawImpossibleError when the rules leave no valid draw', () => {
    const same = () => true;
    expect(() => draw(['a', 'b', 'c'], (g, r) => g !== 'c' && r !== 'c')).toThrow(DrawImpossibleError);
    expect(() => draw(['a', 'b', 'c'], same)).toThrow(DrawImpossibleError);
  });

  it('gives up quickly on a large impossible input', () => {
    // 12 of 20 people in one group: they need 12 recipients outside it, only 8 exist.
    const people = Array.from({ length: 20 }, (_, i) => i);
    const start = Date.now();
    expect(() => draw(people, (a, b) => a < 12 && b < 12)).toThrow(DrawImpossibleError);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
