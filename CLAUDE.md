# CLAUDE.md

Personal portfolio for Alec Layton (`aleclay10.dev`). Astro static site, self-hosted on a Mac mini behind a Cloudflare Tunnel. The bar is design-engineer polish (minimal, fast, ships ~0 JS) with substance — projects and writing.

## Commands

- `npm run dev` — local dev server (`astro dev`)
- `npm run build` — production build to `dist/` (`astro build`, static output)
- `npm run preview` — serve the built `dist/` locally
- `npx astro check` — TypeScript + Astro diagnostics; run this before committing UI changes

Use `npm ci` (not `npm install`) when installing — the deploy pipeline does, and the lockfile is committed.

## Tech stack

- **Astro 6**, static output, **no SSR adapter** — keep it that way; this is a static site.
- **TypeScript**, `strict` (extends `astro/tsconfigs/strict`). Prefer `import type` for type-only imports.
- **Tailwind CSS v4**, wired as a Vite plugin. See the Tailwind rules below — they are the easiest thing to get wrong.

## Tailwind v4 — read this before touching styles

This project uses Tailwind **v4** with the CSS-first config. It does **not** use the old integration or a JS config.

- **DO** keep Tailwind wired as `tailwindcss()` in `vite.plugins` inside `astro.config.mjs`.
- **DON'T** add `@astrojs/tailwind` — that integration is v3-only and breaks v4.
- **DON'T** create `tailwind.config.js`/`.mjs`. There is no JS config.
- Config lives in `src/styles/global.css`, which starts with `@import "tailwindcss";`. Add design tokens via `@theme { }` (CSS custom properties), plugins via `@plugin`, custom utilities via `@utility`.
- `global.css` is imported once (currently from `src/pages/index.astro`); when a shared layout exists, import it there instead.

## Repository layout

Currently minimal — a single page. Respect these locations as the site grows:

- `src/pages/` — routes (`.astro`). One page today: `index.astro`.
- `src/styles/global.css` — Tailwind entry + theme config.
- `public/` — static assets served as-is (e.g. `favicon.svg`).
- `astro.config.mjs`, `tsconfig.json` — config.

When adding structure, follow Astro conventions: shared markup → `src/layouts/`, reusable UI → `src/components/`.

## Conventions for new work

- **Components:** `.astro` by default — static, zero JS. Only reach for a `client:*` directive (`client:load` / `client:idle` / `client:visible`) when a piece genuinely needs interactivity, and pick the laziest one that works.
- **Content collections (Projects, blog):** when added, use the Content Layer API — define schemas in `src/content.config.ts` (not the legacy `src/content/config.ts`) with a `glob()` loader and Zod schemas (`z.coerce.date()` for frontmatter dates). Query via `getCollection()` / `getEntry()`. Match the existing config file's `z` import path if one already exists.
- **Styling:** use Tailwind utilities and `@theme` tokens rather than raw hex values or one-off inline `<style>`. Keep class lists readable.
- **Self-host assets** (fonts included) rather than adding third-party `<link>` tags — it's better for the performance bar and the "fully self-hosted" goal.

## Design bar

Dark, monospace, restrained — see the current `index.astro` for the established palette (`neutral-950` background, `neutral-50`→`neutral-600` text ramp, `font-mono`, tight tracking). It's a single dark theme; there is no light/dark toggle. References: Paco Coursey, Rauno Freiberg, Brittany Chiang. Favor whitespace and typography over chrome.

## Deploy

Pushing to `main` is a deploy: the host pulls, runs `npm ci` → `astro build`, and serves the static `dist/`. Keep the build green and the output static — a broken build or an accidental SSR adapter takes the live site down. Run `npm run build` (and `npx astro check`) before pushing.
