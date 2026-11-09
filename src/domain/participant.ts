export interface Participant {
  name: string;
  /** Avatar file name inside public/avatars, e.g. "maria.jpg". */
  avatar: string;
}

/** Strip accents, lowercase, collapse non-alphanumerics into hyphens. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function defaultAvatar(name: string): string {
  const slug = slugify(name);
  return slug ? `${slug}.jpg` : '';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return (Array.from(first)[0]! + (last ? Array.from(last)[0]! : '')).toUpperCase();
}
