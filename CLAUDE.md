# CLAUDE.md

Personal portfolio for Alec Layton (`aleclay10.dev`). Astro static site, self-hosted on a Mac mini behind a Cloudflare Tunnel. The bar is design-engineer polish (minimal, fast, ships ~0 JS) with substance — projects and writing.

## Commands

- `npm run dev` — local dev server (`astro dev`)
- `npm run build` — production build to `dist/` (`astro build`, static output)
- `npm run preview` — serve the built `dist/` locally
- `npx astro check` — TypeScript + Astro diagnostics; run this before committing UI changes
- `npm run resume:pdf` — regenerate `public/resume.pdf` from the `/resume` page via headless Chrome. Run after any résumé or print-style change, then commit the PDF. Deliberately **not** part of `npm run build` — the unattended deploy must not depend on Chrome.

Use `npm ci` (not `npm install`) when installing — the deploy pipeline does, and the lockfile is committed.

## Tech stack

- **Astro 7**, static output, **no SSR adapter** — keep it that way; this is a static site.
  - Requires **Node ≥ 22.12**. `deploy.sh` picks the highest installed nvm version; if that ever resolves below 22.12 the deploy breaks.
  - Astro 7 ships **Vite 8** and the Rust compiler is now mandatory, so unclosed or semantically invalid HTML is a build **error** rather than being silently auto-corrected.
  - `compressHTML` now defaults to `'jsx'` rather than `true` (JSX whitespace rules, not HTML).
    - **This eats the space around inline links.** Under JSX rules a whitespace-only run containing a newline is dropped entirely, so a paragraph that ends a line on a word and starts the next line with `<a>` renders as `includingKowalski`. Write an explicit `{' '}` at the line break, or keep the link on the same line as the text. It does **not** reproduce under `astro dev` (no compression) — only in a production build, so after touching prose, scan `dist/` for `text<a` and `</a>text` rather than trusting the dev server.
  - `vite.build.assetsInlineLimit: 0` still works under Vite 8 and is still load-bearing — it is what keeps scripts external so the production CSP does not kill them. Verify `0 inline <script> bodies` in `dist/` after any upgrade.
- **TypeScript**, `strict` (extends `astro/tsconfigs/strict`). Prefer `import type` for type-only imports.
- **Tailwind CSS v4**, wired as a Vite plugin. See the Tailwind rules below — they are the easiest thing to get wrong.

## Tailwind v4 — read this before touching styles

This project uses Tailwind **v4** with the CSS-first config. It does **not** use the old integration or a JS config.

- **DO** keep Tailwind wired as `tailwindcss()` in `vite.plugins` inside `astro.config.mjs`.
- **DON'T** add `@astrojs/tailwind` — that integration is v3-only and breaks v4.
- **DON'T** create `tailwind.config.js`/`.mjs`. There is no JS config.
- Config lives in `src/styles/global.css`, which starts with `@import "tailwindcss";`. Add design tokens via `@theme { }` (CSS custom properties), plugins via `@plugin`, custom utilities via `@utility`.
- `global.css` is imported once, from `src/layouts/Base.astro`. Don't re-import it in individual pages.

## Repository layout

- `src/pages/` — routes (`.astro`). Eight today: `index`, `kowalski`, `stack`, `investing`, `resume`, `now`, `uses`, `gaming-assistant`.
- `src/layouts/Base.astro` — the shared shell every page renders through (head, nav, footer, theme init, `global.css` import).
- `src/components/` — reusable UI (`AllocationDonut.astro`, `UptimeChip.astro`).
- `src/data/portfolio.ts` — holdings/watchlist data behind `/investing`.
- `src/styles/global.css` — Tailwind entry + theme config, plus the `@media print` block.
- `public/` — static assets served as-is (e.g. `favicon.svg`, `theme-init.js`). Note `/status.json` is **not** here and **not** a build artifact — `health-check.sh` writes it on the host, so it 404s in dev and `UptimeChip` degrades quietly. That 404 is expected, not a bug.
- `scripts/` — repo tooling not part of the build (e.g. `build-resume-pdf.sh`).
- `astro.config.mjs`, `tsconfig.json` — config.

### Résumé

`src/pages/resume.astro` is the single source of truth; `public/resume.pdf` is **generated from it** by `npm run resume:pdf`, so never hand-edit the PDF. Two deliberate differences from the master résumé in Drive: no phone number (the page is crawlable, and the site has kept contact details off since the Timeline shipped), and an employer-neutral summary/tagline. The `@media print` block in `global.css` is what shapes the PDF — changing it changes the PDF, so regenerate and eyeball the page count (target: 2).

When adding structure, follow Astro conventions: shared markup → `src/layouts/`, reusable UI → `src/components/`.

## Conventions for new work

- **Components:** `.astro` by default — static, zero JS. Only reach for a `client:*` directive (`client:load` / `client:idle` / `client:visible`) when a piece genuinely needs interactivity, and pick the laziest one that works.
- **Content collections (Projects, blog):** when added, use the Content Layer API — define schemas in `src/content.config.ts` (not the legacy `src/content/config.ts`) with a `glob()` loader and Zod schemas (`z.coerce.date()` for frontmatter dates). Query via `getCollection()` / `getEntry()`. Match the existing config file's `z` import path if one already exists.
- **Styling:** use Tailwind utilities and `@theme` tokens rather than raw hex values or one-off inline `<style>`. Keep class lists readable.
- **Self-host assets** (fonts included) rather than adding third-party `<link>` tags — it's better for the performance bar and the "fully self-hosted" goal.

## Design bar

"Engineered, with a signature" — a true 50/50 of *competent systems engineer* and *creative*. The brand promise is "I have my shit together, but I also am creative," so keep the discipline (restraint, performance, tight grid) but always carry one expressive signal.

- **Dual theme:** ship **both light and dark**, toggled via a `.dark` class on `<html>` (anti-FOUC inline script in `<head>`; persisted to `localStorage`). Light is warm *paper* off-white, not pure white; dark is warm near-black `#0c0c0d`.
- **Type system:** **Fraunces** (variable serif) for headlines — the creative tell; **Inter** for body; **JetBrains Mono** for metadata/labels/code/⌘K. Pairing the editorial serif against mono is what keeps it off the cloned-template path.
- **Accent — Ember:** `#e8590c` (light) / `#ff8a5b` (dark). One accent, used surgically.
- **Tokens:** semantic palette lives as CSS vars in `src/styles/global.css` (`--bg`, `--ink`, `--muted`, `--line`, `--accent`…) flipped by `.dark`, exposed to Tailwind via `@theme` (`bg-canvas`, `text-ink`, `text-accent`, `border-line`, …). Prefer these tokens over raw hex.
- **Motion:** restrained — fade-up reveals, page transitions, subtle hover. Always gate on `prefers-reduced-motion`. No heavy animation libs until earned.
- **Layout:** asymmetric editorial grids over the predictable centered column; oversized serif type does the work. References: Paco Coursey, Rauno Freiberg, Brittany Chiang (craft bar) + thesephist, Simon Willison (substance bar). Favor whitespace and typography over chrome.

## Deploy

**Merging to `main` does NOT deploy.** Since 2026-08-16 the host deploys only a **signed git tag** whose signature verifies against an allow-list on the machine (audit finding F-1: the old "whatever lands on `main` runs within 60s" model meant GitHub account compromise equalled code execution inside Alec's home network).

The release step is **Alec's alone** — the signing key is passphrase-protected and the agent does not hold the passphrase. Kowalski opens PRs; Alec merges and tags.

```bash
# Alec, to publish:
cd ~/portfolio/dev && git checkout main && git pull
git -c user.name="Alec Layton" -c user.email="alec.layton100@gmail.com" \
    tag -s vX.Y.Z -m "what changed"
git push origin vX.Y.Z          # poller picks it up within 60s
```

What the host does on a verified tag: detached-checkout of the tagged commit → `npm ci` → `astro build` → `rsync` into the web root → reload Caddy → purge the edge cache.

- **Fails closed.** No verified tag, or a missing allow-list, means nothing deploys and the live site is left exactly as it is. A stale site beats a compromised one.
- Unsigned tags and tags signed by unknown keys are **ignored**, not merely warned about — verified by attack simulation.
- Rolling back to an *older* tag requires `ALLOW_ROLLBACK=1` (downgrade guard).
- `main` is branch-protected: PR required, force-push and deletion blocked, admins included.

Keep the build green and the output static — a broken build or an accidental SSR adapter takes the live site down at the next release. Run `npm run build` and `npx astro check` before pushing.

**Do not verify a deploy by diffing page hashes fetched from `https://aleclay10.dev`.** Cloudflare injects a bot-challenge script with a unique ray ID per request, so any two edge fetches differ and everything looks changed. Diff against the origin (`http://127.0.0.1:8080`) or a local build.
