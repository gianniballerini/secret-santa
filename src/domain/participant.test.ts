import { describe, expect, it } from 'vitest';
import { matchAvatar, sameGroup } from './participant';

describe('matchAvatar', () => {
  const files = ['sofi.jpg', 'fazio.jpg', 'maria-jose.jpg'];

  it('prefers the whole name', () => {
    expect(matchAvatar('María José', files)).toBe('maria-jose.jpg');
  });

  it('falls back to each word in order', () => {
    expect(matchAvatar('Sofi Fazio', files)).toBe('sofi.jpg');
    expect(matchAvatar('Ana Fazio', files)).toBe('fazio.jpg');
  });

  it('uses the default file name when nothing matches', () => {
    expect(matchAvatar('Juan Pérez', files)).toBe('juan-perez.jpg');
    expect(matchAvatar('   ', files)).toBe('');
  });
});

describe('sameGroup', () => {
  it('matches ignoring case and accents', () => {
    expect(sameGroup({ group: 'Pérez' }, { group: ' perez ' })).toBe(true);
  });

  it('never matches an empty or missing group', () => {
    expect(sameGroup({}, {})).toBe(false);
    expect(sameGroup({ group: '' }, { group: '' })).toBe(false);
    expect(sameGroup({ group: 'Pérez' }, {})).toBe(false);
  });

  it('does not match different groups', () => {
    expect(sameGroup({ group: 'Pérez' }, { group: 'Fazio' })).toBe(false);
  });
});
