export const LINKS_FILE_NAME = 'Navidad_2026_amigos_invisibles.md';

export interface GiverLink {
  name: string;
  link: string;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>~]/g, '\\$&');
}

export function buildLinksMarkdown(links: GiverLink[]): string {
  const rows = links.map(({ name, link }) => `- **${escapeMarkdown(name)}**: <${link}>`);
  return [
    '# Amigo invisible: enlaces privados',
    '',
    'Guardá este archivo por si alguien pierde su enlace. Abrí solo el que necesites reenviar, ¡o arruinás la sorpresa!',
    '',
    ...rows,
    '',
  ].join('\n');
}
