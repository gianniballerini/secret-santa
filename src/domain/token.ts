export interface TokenPayload {
  /** Giver name. */
  g: string;
  /** Recipient name. */
  r: string;
  /** Recipient avatar file name. */
  a: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Obfuscation only (base64url of UTF-8 JSON), not encryption. */
export function encodeToken(payload: TokenPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    if (!token) return null;
    const json = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(token));
    const data: unknown = JSON.parse(json);
    if (typeof data !== 'object' || data === null) return null;
    const { g, r, a } = data as Record<string, unknown>;
    if (typeof g !== 'string' || typeof r !== 'string' || typeof a !== 'string') return null;
    if (!g || !r) return null;
    return { g, r, a };
  } catch {
    return null;
  }
}
