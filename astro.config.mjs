// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import searchIndex from './scripts/search-index-integration.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://aleclay10.dev',
  // searchIndex() runs on astro:build:done rather than as an npm script, so it
  // cannot be bypassed by invoking `astro build` directly the way the host docs
  // describe. See the header comment in scripts/search-index-integration.mjs.
  integrations: [
    // /gaming-assistant/thanks is a form-confirmation route reached only by a 303
    // from the waitlist Worker. It is a real page, but it should not rank for
    // anything — see the noindex prop on Base.astro.
    sitemap({ filter: (page) => !page.includes('/gaming-assistant/thanks') }),
    searchIndex()
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Never inline small scripts/assets into the HTML: the production CSP
      // (default-src 'self', no unsafe-inline for scripts) blocks inline scripts.
      assetsInlineLimit: 0,
      // Vite's modulepreload helper is ~1.4 KB and ships in every chunk that has a
      // dynamic import — here, on every page, to save one same-origin round trip on
      // the two search chunks that most visitors never fetch. Not worth it at this
      // site's JS budget.
      modulePreload: false
    }
  }
});
