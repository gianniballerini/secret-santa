export interface Participant {
  name: string;
  /** Avatar file name inside public/avatars, e.g. "maria.jpg". */
  avatar: string;
  /** Optional exclusion group (a couple, a family): people in the same group never draw each other. */
  group?: string;
}

/** True when both have a group and it is the same one, ignoring case and accents. */
export function sameGroup(a: Pick<Participant, 'group'>, b: Pick<Participant, 'group'>): boolean {
  const ga = slugify(a.group ?? '');
  return ga !== '' && ga === slugify(b.group ?? '');
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

/**
 * The avatar for a name, picked from the files that exist: the whole name first ("sofi-fazio.jpg"),
 * then each word in order ("sofi.jpg", "fazio.jpg"). With no match it is the default file name, which
 * the reveal replaces with the mystery silhouette.
 */
export function matchAvatar(name: string, available: readonly string[]): string {
  const files = new Set(available);
  const words = name.trim().split(/\s+/).map(slugify).filter(Boolean);
  for (const slug of [slugify(name), ...words]) {
    if (slug && files.has(`${slug}.jpg`)) return `${slug}.jpg`;
  }
  return defaultAvatar(name);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return (Array.from(first)[0]! + (last ? Array.from(last)[0]! : '')).toUpperCase();
}
