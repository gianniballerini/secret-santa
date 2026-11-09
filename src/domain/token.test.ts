import { describe, expect, it } from 'vitest';
import { decodeToken, encodeToken } from './token';
import { defaultAvatar, slugify } from './participant';

describe('token', () => {
  it('roundtrips unicode names', () => {
    const payload = { g: 'María José', r: 'Peña Ñandú 🎅', a: 'pena-nandu.jpg' };
    const token = encodeToken(payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeToken(token)).toEqual(payload);
  });

  it('returns null for invalid tokens', () => {
    expect(decodeToken('')).toBeNull();
    expect(decodeToken('!!!not-base64!!!')).toBeNull();
    expect(decodeToken(btoa('not json'))).toBeNull();
    expect(decodeToken(btoa('{"g":"a"}'))).toBeNull();
    expect(decodeToken(btoa('[1,2]'))).toBeNull();
  });
});

describe('participant', () => {
  it('slugifies and builds default avatar', () => {
    expect(slugify('  María  José ')).toBe('maria-jose');
    expect(slugify('Ñandú')).toBe('nandu');
    expect(defaultAvatar('María')).toBe('maria.jpg');
    expect(defaultAvatar('   ')).toBe('');
  });
});
