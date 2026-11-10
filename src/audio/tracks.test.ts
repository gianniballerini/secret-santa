import { describe, expect, it } from 'vitest';
import { nextTrack, pickSource } from './tracks';

describe('nextTrack', () => {
  it('cycles through the tracks and wraps to the first', () => {
    expect(nextTrack(0, 3)).toBe(1);
    expect(nextTrack(1, 3)).toBe(2);
    expect(nextTrack(2, 3)).toBe(0);
  });

  it('stays on the only track', () => {
    expect(nextTrack(0, 1)).toBe(0);
  });

  it('stays at 0 without tracks', () => {
    expect(nextTrack(0, 0)).toBe(0);
  });
});

describe('pickSource', () => {
  const track = { id: 't', label: 'T', webm: 'a.webm', m4a: 'a.m4a' };
  it('prefers webm when it can play, else m4a', () => {
    expect(pickSource(track, true)).toBe('a.webm');
    expect(pickSource(track, false)).toBe('a.m4a');
  });
});
