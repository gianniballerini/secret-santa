import { describe, expect, it } from 'vitest';
import { buildLinksMarkdown } from './linksFile';

describe('buildLinksMarkdown', () => {
  it('lists one row per giver, in order', () => {
    const markdown = buildLinksMarkdown([
      { name: 'María José', link: 'https://example.com/#abc_1' },
      { name: 'Peña 🎅', link: 'https://example.com/#def-2' },
    ]);
    const rows = markdown.split('\n').filter((line) => line.startsWith('- '));
    expect(rows).toEqual([
      '- **María José**: <https://example.com/#abc_1>',
      '- **Peña 🎅**: <https://example.com/#def-2>',
    ]);
  });

  it('escapes markdown characters in names', () => {
    const markdown = buildLinksMarkdown([{ name: '*Ana* [x]_<b>', link: 'https://example.com/#a' }]);
    expect(markdown).toContain('- **\\*Ana\\* \\[x\\]\\_\\<b\\>**: <https://example.com/#a>');
  });
});
