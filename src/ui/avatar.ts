import { matchAvatar } from '../domain/participant';

/** File names in `public/avatars`, injected at build time by `vite.config.ts`. */
declare const __AVATARS__: readonly string[];

/** The avatar file for a name among the pictures the site ships. */
export function avatarFor(name: string): string {
  return matchAvatar(name, __AVATARS__);
}

/**
 * A participant's picture in `public/avatars`, or '' when the file name is not a plain one. Tokens
 * are user-controlled, so only a plain file name gets through (no paths, no URLs).
 */
export function avatarUrl(file: string): string {
  return /^[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png|webp)$/.test(file) ? `avatars/${file}` : '';
}
