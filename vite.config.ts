import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import pug from 'pug';

/**
 * Tiny Pug plugin: replaces the `<!-- pug:path -->` placeholder in index.html
 * with the rendered output of the referenced Pug file, and keeps the dev
 * server watching the template.
 */
function pugInclude(): Plugin {
  const re = /<!--\s*pug:([^\s]+)\s*-->/g;
  return {
    name: 'pug-include',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(re, (_m, file: string) =>
          pug.renderFile(resolve(import.meta.dirname, file), { pretty: false }),
        );
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.pug')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

/** The avatar files the site ships, so the organizer can match names to pictures (restart dev to pick up new ones). */
const avatars = readdirSync(resolve(import.meta.dirname, 'public/avatars')).filter((f) => f.endsWith('.jpg'));

export default defineConfig({
  base: './',
  define: { __AVATARS__: JSON.stringify(avatars) },
  server: { host: true, port: 1234 },
  plugins: [pugInclude()],
  test: { include: ['src/**/*.test.ts'] },
});
