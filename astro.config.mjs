// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://aleclay10.dev',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Never inline small scripts/assets into the HTML: the production CSP
      // (default-src 'self', no unsafe-inline for scripts) blocks inline scripts.
      assetsInlineLimit: 0
    }
  }
});
