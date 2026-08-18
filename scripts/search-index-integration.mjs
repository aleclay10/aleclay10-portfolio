import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseHTML } from 'linkedom';

import { extractBlocks, isHeading } from '../src/lib/search-core.js';

/**
 * Build-time indexer for the find-in-files search.
 *
 * An Astro **integration** rather than a `package.json` script chain, on purpose.
 * `deploy-signed.sh` runs `npm run build`, but CLAUDE.md documents the host as
 * running `astro build` — anyone reconciling that discrepancy by "fixing" the
 * script would silently stop the index being generated, which is the exact failure
 * class as the CSP bug this replaces: the search looks built, ships, and does
 * nothing. An integration survives every invocation of the build.
 *
 * Parsing uses linkedom because it is the only lightweight candidate with real
 * `matches()` / `closest()` / `children`, which is what lets `src/lib/search-core.js`
 * run unmodified here and in the browser. A DOM-*like* parser would force a second
 * walker implementation and reintroduce exactly the index/highlighter drift that
 * would make every deep link a coin flip.
 *
 * Emits `dist/search-index.json`. Deliberately carries no build timestamp: the Astro
 * build is otherwise byte-deterministic and that is a property worth keeping — it is
 * how a deploy gets verified against a local build.
 */

const STRICT = process.env.SEARCH_STRICT === '1';

/**
 * Word boundaries lost between two *inline* elements — either from Astro's JSX
 * whitespace compression eating the newline before an `<a>` (see CLAUDE.md), or from
 * two adjacent spans separated only by a margin class. The walker can synthesise a
 * boundary at any non-inline element, but between inline elements there is no
 * structural signal, so these have to be caught and fixed in the source.
 *
 * They matter beyond search: `<span>NVDA</span><span>NVIDIA</span>` is announced as
 * one word by a screen reader too.
 */
const INLINE = 'a|span|em|strong|b|i|code|abbr|time|small|sub|sup|mark|q|cite|var|samp|kbd';
// A word character is required on *both* sides of every boundary, which is what
// keeps the site's empty decorative spans (`<span class="h-2 w-2 …"></span>Text`)
// out of the results — nothing is glued to nothing.
const GLUED = [
	new RegExp(`\\w<(?:${INLINE})\\b[^>]*>\\w`, 'g'),
	new RegExp(`\\w</(?:${INLINE})>\\w`, 'g'),
	new RegExp(`\\w</(?:${INLINE})><(?:${INLINE})\\b[^>]*>\\w`, 'g'),
];
const MAX_GLUE_WARNINGS = 4;

/** @param {string} dir */
async function htmlFiles(dir) {
	/** @type {string[]} */
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && entry.name.endsWith('.html')) {
			out.push(path.join(entry.parentPath ?? entry.path, entry.name));
		}
	}
	return out.sort();
}

/**
 * `dist/index.html` → `/`, `dist/stack/index.html` → `/stack/`.
 * @param {string} distDir
 * @param {string} file
 */
function routeOf(distDir, file) {
	const rel = path.relative(distDir, file).split(path.sep).join('/');
	if (rel === 'index.html') return '/';
	if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
	return `/${rel}`;
}

/**
 * The site's titles read `<short name> — <description>`. Split them so the palette
 * can show the route-ish half in mono and the prose half in serif.
 * @param {string} title
 * @param {string} route
 */
function splitTitle(title, route) {
	const at = title.indexOf(' — ');
	if (at === -1) return { n: route, t: title };
	return { n: title.slice(0, at).trim(), t: title.slice(at + 3).trim() };
}

export default function searchIndex() {
	return {
		name: 'search-index',
		hooks: {
			/** @type {(ctx: { dir: URL, logger: { info: (m: string) => void, warn: (m: string) => void } }) => Promise<void>} */
			'astro:build:done': async ({ dir, logger }) => {
				const distDir = fileURLToPath(dir);
				const files = await htmlFiles(distDir);

				/** @type {string[]} */
				const warnings = [];
				const pages = [];
				let totalBlocks = 0;
				let totalWords = 0;

				for (const file of files) {
					const route = routeOf(distDir, file);
					const html = await readFile(file, 'utf8');
					const { document } = parseHTML(html);

					const main = document.querySelector('main');
					if (!main) {
						warnings.push(`${route} has no <main> — not indexed`);
						continue;
					}

					const inner = main.innerHTML;
					const glued = new Set(GLUED.flatMap((p) => [...inner.matchAll(p)].map((m) => m[0])));
					for (const hit of [...glued].slice(0, MAX_GLUE_WARNINGS)) {
						warnings.push(
							`${route} has two words glued across an inline element boundary: ` +
								`"…${hit}…". Add an explicit {' '} there.`
						);
					}

					const title = (document.querySelector('title')?.textContent ?? route).trim();
					const { n, t } = splitTitle(title, route);

					/** @type {string[]} */
					const sections = [];
					const blocks = [];

					for (const block of extractBlocks(main)) {
						if (!block.section) {
							warnings.push(
								`${route} — block has no resolvable section label: "${block.text.slice(0, 60)}". ` +
									`Add data-search-section to the enclosing <section>.`
							);
						}
						let s = sections.indexOf(block.section);
						if (s === -1) s = sections.push(block.section) - 1;

						const record = { s, x: block.text };
						if (isHeading(block.el)) record.k = 'h';
						blocks.push(record);
						totalWords += block.text.split(' ').length;
					}

					totalBlocks += blocks.length;
					pages.push({ u: route, t, n, s: sections, b: blocks });
				}

				const index = {
					v: 1,
					stats: { pages: pages.length, blocks: totalBlocks, words: totalWords },
					pages,
				};

				await writeFile(path.join(distDir, 'search-index.json'), JSON.stringify(index), 'utf8');

				for (const w of warnings) logger.warn(w);
				logger.info(
					`indexed ${pages.length} pages · ${totalBlocks} blocks · ${totalWords} words` +
						(warnings.length ? ` · ${warnings.length} warning(s)` : '')
				);

				// Non-fatal by default. A build abort on a prose nit would leave the live
				// site frozen at the next signed tag, which is a far worse outcome than a
				// slightly wrong section label. `SEARCH_STRICT=1` opts into the hard fail
				// locally and in review.
				if (STRICT && warnings.length) {
					throw new Error(`[search-index] ${warnings.length} warning(s) with SEARCH_STRICT=1`);
				}
			},
		},
	};
}
