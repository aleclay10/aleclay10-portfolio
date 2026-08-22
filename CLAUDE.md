# CLAUDE.md

Personal portfolio for Alec Layton (`aleclay10.dev`). Astro static site, self-hosted on a Mac mini behind a Cloudflare Tunnel. The bar is design-engineer polish (minimal, fast, ships ~0 JS) with substance — projects and writing.

> **Merging a PR does not put anything on the live site.** A release is a **signed tag**, pushed by Alec — nobody else can cut one. If a merged change isn't showing up at `aleclay10.dev`, the tag is the first thing to check: compare `git describe --tags origin/main` against the newest tag. See [Deploy](#deploy) for the release command and why it works this way.

## Commands

- `npm run dev` — local dev server (`astro dev`)
- `npm run build` — production build to `dist/` (`astro build`, static output). Also writes `dist/search-index.json`; see [Search](#search).
- `npm run preview` — serve the built `dist/` locally
- `npm run preview:csp` — serve the built `dist/` on `:4321` **with the production CSP**. Run this, with the console open, before shipping anything that adds or moves a script. `astro dev` and `astro preview` set no CSP and the Caddyfile lives outside the repo, so this is the only thing in the toolchain that would have caught the search outage described under [Search](#search).
- `npx astro check` — TypeScript + Astro diagnostics; run this before committing UI changes
- `npm run resume:pdf` — regenerate `public/resume.pdf` from the `/resume` page via headless Chrome. Run after any résumé or print-style change, then commit the PDF. Deliberately **not** part of `npm run build` — the unattended deploy must not depend on Chrome.
- `npm run og` — regenerate the per-page social cards in `public/og/`, then commit them. Run after adding a page or changing any page's `title`/`description`. Same reasoning as `resume:pdf`: it rasterises through `@resvg/resvg-js`, a native module, and the unattended deploy must not depend on one. See [Social cards](#social-cards).
- `npm run ship-log` — refresh the committed ship-log snapshot at `src/data/ship-log.json`, then commit it. That file is only a useful fallback if it doesn't rot; run it when prepping a release. See [Ship log](#ship-log).

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

- `src/pages/` — routes (`.astro`). Nine today: `index`, `kowalski`, `stack`, `investing`, `resume`, `now`, `uses`, `gaming-assistant`, and `gaming-assistant/thanks` (the no-JS confirmation for the waitlist form — `noindex`, and excluded from the sitemap and the ⌘K index).
- `src/layouts/Base.astro` — the shared shell every page renders through (head, nav, footer, theme init, `global.css` import).
- `src/components/` — reusable UI (`AllocationDonut.astro`, `UptimeChip.astro`).
- `src/data/portfolio.ts` — holdings/watchlist data behind `/investing`.
- `src/styles/global.css` — Tailwind entry + theme config, plus the `@media print` block.
- `public/` — static assets served as-is (e.g. `favicon.svg`, `theme-init.js`). Note `/status.json` is **not** here and **not** a build artifact — `health-check.sh` writes it on the host, so it 404s in dev and `UptimeChip` degrades quietly. That 404 is expected, not a bug.
- `scripts/` — repo tooling not part of the build (e.g. `build-resume-pdf.sh`).
- `waitlist-worker/` — the `/api/waitlist` Cloudflare Worker + D1 schema behind the early-access form. A **separate npm package with its own deploy pipeline**; see [Waitlist API](#waitlist-api). Excluded from the root `tsconfig.json`, because Workers globals (`D1Database`) do not type-check against the site's browser lib.
- `astro.config.mjs`, `tsconfig.json` — config.

### Résumé

`src/pages/resume.astro` is the single source of truth; `public/resume.pdf` is **generated from it** by `npm run resume:pdf`, so never hand-edit the PDF. Two deliberate differences from the master résumé in Drive: no phone number (the page is crawlable, and the site has kept contact details off since the Timeline shipped), and an employer-neutral summary/tagline. The `@media print` block in `global.css` is what shapes the PDF — changing it changes the PDF, so regenerate and eyeball the page count (target: 2).

When adding structure, follow Astro conventions: shared markup → `src/layouts/`, reusable UI → `src/components/`.

## Conventions for new work

- **Components:** `.astro` by default — static, zero JS. Only reach for a `client:*` directive (`client:load` / `client:idle` / `client:visible`) when a piece genuinely needs interactivity, and pick the laziest one that works.
- **Content collections (Projects, blog):** when added, use the Content Layer API — define schemas in `src/content.config.ts` (not the legacy `src/content/config.ts`) with a `glob()` loader and Zod schemas (`z.coerce.date()` for frontmatter dates). Query via `getCollection()` / `getEntry()`. Match the existing config file's `z` import path if one already exists.
- **Styling:** use Tailwind utilities and `@theme` tokens rather than raw hex values or one-off inline `<style>`. Keep class lists readable.
- **No em dashes in visitor-facing copy.** Reword, or use a colon, a full stop, or a comma. Page titles use a middle dot as the separator (`'/stack · how this site works'`), and `build-og-images.mjs` parses that separator, so a title using ` — ` also breaks its OG card. This applies to anything that reaches the page: prose, labels, placeholders, `aria-label`s, tooltips, and UI strings in bundled scripts **and in the waitlist Worker's error responses**, which render in the form. **Source comments are exempt** — nothing they say reaches the page.
- **Self-host assets** (fonts included) rather than adding third-party `<link>` tags — it's better for the performance bar and the "fully self-hosted" goal.

## Search

Find-in-files across the whole site: every occurrence of the query, with context, grouped by page — not one ranked excerpt per page. Four files:

| File | Role |
|---|---|
| `src/lib/search-core.js` | **The correctness hinge.** One DOM walker, shared by all three consumers below. |
| `scripts/search-index-integration.mjs` | `astro:build:done` integration → `dist/search-index.json` (~9 KB gzipped). |
| `src/scripts/search-boot.ts` | The only piece that loads on every page (~1 KB). Lazily imports the other two. |
| `src/scripts/search-palette.ts` / `search-highlight.ts` | The ⌘K palette; the `?q=&i=` arrival highlighter. |

Rules that are load-bearing rather than stylistic:

- **`search-core.js` is plain ESM with `// @ts-check`, not TypeScript**, because the indexer is a `.mjs` file that must import it under whatever Node the host's nvm resolves highest. `npx astro check` type-checks it through JSDoc.
- **The indexer and the highlighter must agree on block order and block text**, because the indexer assigns each occurrence an ordinal and the highlighter recomputes it from the live DOM. That is why there is one walker, why `linkedom` (real `matches()`/`closest()`) parses the built HTML, and why block dropping, dedupe and synthetic word-boundary spaces all live inside `extractBlocks`/`blockTextMap` rather than in either caller. A rule applied on one side only silently turns every deep link into a coin flip.
- **Scope is `<main>`**, so chrome exclusion is structural and a new page needs no opt-in attribute. `[data-search-section]` labels a section with no eyebrow; `[data-search-skip]` excludes content.
- **The build warns and does not fail** on an unlabelled section or a lost word boundary. `SEARCH_STRICT=1` turns warnings into an error — use it locally, never on the host: a build abort on a prose nit would freeze the live site at the next tag.
- **Ceiling: roughly 50k words / 150 KB raw.** The whole index is one download. Past that, switch to per-page shards or an inverted index. The corpus is ~2.9k words today.

The search this replaced was Pagefind, and it was dead in production for weeks while looking perfectly healthy: indexing succeeded, the assets served 200, the browser downloaded the WASM — and then `default-src 'self'` with no `wasm-unsafe-eval` blocked *compiling* it. A bare `catch` reported that as "Search index unavailable — production builds only." Hence two standing rules here: failure states are never merged into one message, and `npm run preview:csp` exists.

## Social cards

Every page gets its own 1200×630 Open Graph card, generated by `scripts/build-og-images.mjs` (satori → SVG → `@resvg/resvg-js` → PNG) into `public/og/<slug>.png` and **committed**.

- **Generation is not part of the build.** `@resvg/resvg-js` is a native module with a platform-specific prebuilt binary; a load failure on the host would abort `npm run build`, and a failed build at tag time freezes the live site. Same line already drawn for `resume:pdf`. The release path only copies static files out of `public/`.
- **Content comes from the built HTML** (`head > title`, `head > meta[name=description]`), so the cards cannot drift from what the pages actually say. Scope the title selector to `<head>` — `/investing` renders an inline SVG donut whose `<title>` elements are chart segment names.
- **Slug derivation is duplicated** in `Base.astro` and `slugOf()` in the script. `/` → `home`, `/gaming-assistant/` → `gaming-assistant`. Keep them in step.
- **A missing card warns and falls back** to the generic `/og.png`, per page, at build time. It never fails the build — a forgotten `npm run og` should not freeze a release — but it is loud in the build log rather than silent.
- Fonts are read as `.woff` from the **static** `@fontsource/*` packages, not the `@fontsource-variable/*` ones the site itself uses: satori cannot read woff2, and the variable packages ship woff2 only.

## Ship log

The `Ship log` section on `/stack` (`src/components/ShipLog.astro`) shows release velocity on this repo — merged PRs, signed releases, and the four most recent PR titles.

- **This replaced the roadmap's "GitHub activity strip",** which was scoped as a contribution calendar. That was measured before building and rejected on the data: the account shows **70 contributions across 20 active days in 365**, because the professional work isn't on this account and Kowalski isn't on GitHub. As green squares that reads "barely writes code" — the opposite of the intent. The unauthenticated events API is also thinner than it looks: 99 events, one page, ~24 days, one repo, and pagination past page 1 is refused outright.
- **Fetched at build time, unauthenticated**, with `src/data/ship-log.json` as the fallback. The host builds with no GitHub credential and should stay that way.
- **It can never fail the build.** GitHub unreachable, or the 60/hr per-IP limit exhausted by a run of local builds, logs a *named* reason and falls back to the snapshot. A bare catch is what kept the Pagefind outage invisible; don't reintroduce one.
- **This makes the build non-deterministic in one page.** `/stack` can differ between two builds if a PR merges in between. Figures are deliberately coarse (month, not "9 weeks ago") to keep that to a minimum, but a byte-exact local-vs-host diff is no longer guaranteed for that page.
- **Ceiling: one page of PRs.** `per_page` caps at 100; past ~100 closed PRs the count silently under-reports and `fetchShipLog()` needs paging.
- The `{' '}` separators between the PR number, title and date in the row markup are **load-bearing** — without them those collapse into one token for the search indexer and for screen readers. The build warns if they go missing.

## Design bar

"Engineered, with a signature" — a true 50/50 of *competent systems engineer* and *creative*. The brand promise is "I have my shit together, but I also am creative," so keep the discipline (restraint, performance, tight grid) but always carry one expressive signal.

- **Dual theme:** ship **both light and dark**, toggled via a `.dark` class on `<html>` (anti-FOUC inline script in `<head>`; persisted to `localStorage`). Light is warm *paper* off-white, not pure white; dark is warm near-black `#0c0c0d`.
- **Type system:** **Fraunces** (variable serif) for headlines — the creative tell; **Inter** for body; **JetBrains Mono** for metadata/labels/code/⌘K. Pairing the editorial serif against mono is what keeps it off the cloned-template path.
- **Accent — Ember:** `#e8590c` (light) / `#ff8a5b` (dark). One accent, used surgically.
- **Tokens:** semantic palette lives as CSS vars in `src/styles/global.css` (`--bg`, `--ink`, `--muted`, `--line`, `--accent`…) flipped by `.dark`, exposed to Tailwind via `@theme` (`bg-canvas`, `text-ink`, `text-accent`, `border-line`, …). Prefer these tokens over raw hex.
- **Motion:** restrained — fade-up reveals, page transitions, subtle hover. Always gate on `prefers-reduced-motion`. No heavy animation libs until earned.
- **Layout:** asymmetric editorial grids over the predictable centered column; oversized serif type does the work. References: Paco Coursey, Rauno Freiberg, Brittany Chiang (craft bar) + thesephist, Simon Willison (substance bar). Favor whitespace and typography over chrome.

## Waitlist API

The early-access form on `/gaming-assistant` POSTs to `/api/waitlist`, which is **not part
of this build**. It is a Cloudflare Worker backed by D1, living in `waitlist-worker/` and
deployed with `wrangler` — see that directory's README.

Three things worth knowing before touching either half:

- **There are now two deploy pipelines.** The site ships only on a signed tag (below); the
  Worker ships instantly via `npx wrangler deploy`. They are independent. **Deploy the
  Worker before the frontend reaches production**, or the form is live against a 404.
- **The form must keep working with JavaScript disabled.** It is a native `<form>` POST;
  the Worker answers a no-JS submission with a 303 to `/gaming-assistant/thanks`. The page
  script only upgrades that to an inline result.
- **Same-origin is load-bearing.** `/api/waitlist` on the site's own hostnames is what lets
  the `fetch` satisfy `default-src 'self'` with no `connect-src` amendment. A dedicated
  subdomain would require loosening the CSP; don't.

Note that `www.aleclay10.dev` serves the site rather than redirecting to the apex, so the
Worker is routed and origin-allow-listed for **both** hostnames.

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

What the host does on a verified tag: detached-checkout of the tagged commit → `npm ci` → **`npm run build`** → `rsync` into the web root → reload Caddy → purge the edge cache.

> The host runs `npm run build`, not `astro build` directly (`deploy-signed.sh:143`). This file said otherwise until 2026-08-18. It matters: anything that has to happen at build time must not depend on which of the two you invoke. That is why the search indexer is an Astro **integration** rather than a step appended to the `build` script.

- **Fails closed.** No verified tag, or a missing allow-list, means nothing deploys and the live site is left exactly as it is. A stale site beats a compromised one.
- Unsigned tags and tags signed by unknown keys are **ignored**, not merely warned about — verified by attack simulation.
- Rolling back to an *older* tag requires `ALLOW_ROLLBACK=1` (downgrade guard).
- `main` is branch-protected: PR required, force-push and deletion blocked, admins included.

Keep the build green and the output static — a broken build or an accidental SSR adapter takes the live site down at the next release. Run `npm run build` and `npx astro check` before pushing.

**Do not verify a deploy by diffing page hashes fetched from `https://aleclay10.dev`.** Cloudflare injects a bot-challenge script with a unique ray ID per request, so any two edge fetches differ and everything looks changed. Diff against the origin (`http://127.0.0.1:8080`) or a local build.
