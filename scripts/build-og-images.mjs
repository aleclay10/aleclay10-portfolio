import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseHTML } from 'linkedom';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

/**
 * Build-time generator for per-page Open Graph cards.
 *
 * Deliberately NOT an Astro integration, unlike `search-index-integration.mjs`.
 * `@resvg/resvg-js` is a native module with a platform-specific prebuilt binary,
 * and CLAUDE.md already draws this line for `resume:pdf`: "the unattended deploy
 * must not depend on Chrome." Same principle. A native rasteriser that fails to
 * load on the host would abort `npm run build`, and a failed build at tag time
 * freezes the live site. So this runs on Alec's machine, the PNGs are committed,
 * and the release path only ever copies static files out of `public/`.
 *
 * Reads titles and descriptions out of the built HTML rather than re-deriving
 * them from page source: `dist/` is the only place the real, rendered values
 * exist in one shape for every route.
 *
 *   npm run og      # astro build && node scripts/build-og-images.mjs
 *
 * Writes `public/og/<slug>.png`. Commit the result. `Base.astro` falls back to
 * the generic `/og.png` for any route without a card and warns at build time,
 * so a forgotten run degrades loudly rather than silently.
 */

const WIDTH = 1200;
const HEIGHT = 630;

// The dark half of the semantic palette in src/styles/global.css. Cards are
// always dark: it is the signature side of the brand, and a social card has no
// visitor preference to honour.
const C = {
	bg: '#0c0c0d',
	ink: '#edeae4',
	muted: '#8a847c',
	line: '#20201d',
	accent: '#ff8a5b',
};

const FONTS = [
	['node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff', 'Fraunces', 700],
	['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff', 'JetBrains Mono', 400],
	['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff', 'JetBrains Mono', 500],
];

/** Minimal createElement - satori wants React-shaped nodes and this file is not JSX. */
const h = (type, style, children) => ({ type, props: { style, children } });

/** @param {string} dir */
async function htmlFiles(dir) {
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
 * Mirrors routeOf() in search-index-integration.mjs.
 */
function routeOf(distDir, file) {
	const rel = path.relative(distDir, file).split(path.sep).join('/');
	if (rel === 'index.html') return '/';
	if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
	return `/${rel}`;
}

/**
 * `/` → `home`, `/gaming-assistant/` → `gaming-assistant`.
 * Base.astro derives the same slug from Astro.url.pathname - keep them in step.
 */
export function slugOf(route) {
	const trimmed = route.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? 'home' : trimmed.replace(/\//g, '-');
}

/**
 * Site titles read `<short name> · <rest>`.
 * @returns {{ head: string, tail: string }}
 */
function splitTitle(title) {
	const at = title.indexOf(' · ');
	if (at === -1) return { head: title.trim(), tail: '' };
	return { head: title.slice(0, at).trim(), tail: title.slice(at + 3).trim() };
}

/**
 * The small label in the bottom-right corner.
 *
 * Normally the route. But four of the eight pages are titled after their own
 * route ("/investing · how and why I invest"), so the headline and the route
 * label would print the same string twice; those get the title's back half
 * instead. `/kowalski` and `/resume` cannot use the back half - theirs is the
 * site suffix "Alec Layton", which only restates the wordmark - and they do not
 * need to, because their headline is a name rather than a path.
 */
function labelOf(headline, tail, route) {
	const bare = (s) => s.replace(/^\/+|\/+$/g, '');
	// Root is the other case the route cannot carry: a lone "/" in the corner
	// reads as a stray mark rather than a label.
	const routeIsUseless = bare(route) === '' || bare(headline) === bare(route);
	return routeIsUseless && tail ? tail : route;
}

/**
 * Descriptions written for search results often open by restating the page name
 * ("Alec Layton: I build autonomous agent systems…"). On a card the headline is
 * already six inches tall directly above, so the prefix is dead weight.
 */
function trimRestatedHeadline(description, headline) {
	const prefix = [`${headline}: `, `${headline}, `].find((p) => description.startsWith(p));
	if (!prefix) return description;
	const rest = description.slice(prefix.length);
	return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// Truncating mid-clause can strand a conjunction or article on the ellipsis
// ("Discord without alt-tabbing, and…"), which reads like the generator broke.
const DANGLING = /\s+(?:and|or|but|the|a|an|of|to|in|on|at|by|for|from|with|as|is|are|that|its)$/i;

/** Truncate on a word boundary so descriptions do not overflow the card. */
function clamp(text, max) {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(' ');
	let out = cut.slice(0, lastSpace > 0 ? lastSpace : max);
	// Once, not looped: dropping two words in a row starts changing the meaning.
	out = out.replace(DANGLING, '');
	return `${out.replace(/[,;:.\s]+$/, '')}…`;
}

function card({ headline, description, label }) {
	return h(
		'div',
		{
			width: '100%',
			height: '100%',
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			backgroundColor: C.bg,
			padding: '64px 72px',
			fontFamily: 'JetBrains Mono',
		},
		[
			// Wordmark / domain rail
			h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 24 }, [
				h('div', { display: 'flex', color: C.ink, fontWeight: 500 }, [
					h('span', {}, 'AL'),
					h('span', { color: C.accent }, '.'),
				]),
				h('div', { color: C.muted }, 'aleclay10.dev'),
			]),

			// Headline + rule + description
			h('div', { display: 'flex', flexDirection: 'column' }, [
				h(
					'div',
					{
						fontFamily: 'Fraunces',
						fontWeight: 700,
						fontSize: headline.length > 22 ? 76 : 96,
						color: C.ink,
						lineHeight: 1.05,
						letterSpacing: '-0.02em',
					},
					headline
				),
				h('div', { width: 96, height: 4, backgroundColor: C.accent, margin: '28px 0 26px 0' }),
				h(
					'div',
					{ fontSize: 25, color: C.muted, lineHeight: 1.55, maxWidth: 900 },
					clamp(description, 155)
				),
			]),

			// Route, or the tagline where the headline is already the route
			h('div', { display: 'flex', justifyContent: 'flex-end', fontSize: 22, color: C.accent }, label),
		]
	);
}

async function main() {
	const distDir = path.resolve('dist');
	const outDir = path.resolve('public/og');

	let files;
	try {
		files = await htmlFiles(distDir);
	} catch (err) {
		// Only a missing dist/ means "you forgot to build". Anything else (EACCES,
		// a file where a directory should be) gets reported as itself - telling
		// someone to rebuild when the problem is permissions sends them in circles.
		if (err?.code === 'ENOENT') {
			console.error('[og] no dist/ - run `npm run build` first (or use `npm run og`, which does both).');
		} else {
			console.error(`[og] cannot read dist/: ${err?.message ?? err}`);
		}
		process.exit(1);
	}

	const fonts = await Promise.all(
		FONTS.map(async ([file, name, weight]) => {
			try {
				return { name, weight, style: 'normal', data: await readFile(path.resolve(file)) };
			} catch (err) {
				// A bare ENOENT stack does not say which package is missing or why the
				// path is a static @fontsource/* one (satori cannot read the variable
				// packages' woff2 - see FONTS above).
				console.error(`[og] cannot read font ${file} (${err?.code ?? err?.message ?? err}) - run \`npm ci\`?`);
				process.exit(1);
			}
		})
	);

	await mkdir(outDir, { recursive: true });

	let count = 0;
	/** @type {string[]} */
	const failed = [];
	for (const file of files) {
		const route = routeOf(distDir, file);

		try {
			const { document } = parseHTML(await readFile(file, 'utf8'));

			// Scoped to <head>: /investing renders an inline SVG donut whose <title>
			// elements are accessible names for the chart segments, not the page title.
			const title = document.querySelector('head > title')?.textContent?.trim();
			const description = document
				.querySelector('head > meta[name="description"]')
				?.getAttribute('content')
				?.trim();

			if (!title || !description) {
				console.warn(`[og] ${route} - missing title or description, skipped`);
				continue;
			}

			const { head, tail } = splitTitle(title);
			const svg = await satori(
				card({
					headline: head,
					description: trimRestatedHeadline(description, head),
					label: labelOf(head, tail, route),
				}),
				{ width: WIDTH, height: HEIGHT, fonts }
			);
			const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();

			await writeFile(path.join(outDir, `${slugOf(route)}.png`), png);
			count += 1;
		} catch (err) {
			// One page's card failing (a satori layout edge case, a corrupt HTML file)
			// should not abort the run mid-loop: that leaves public/og/ half-updated
			// with no summary of which cards are current. Finish the sweep, then fail
			// with the full list so one run shows every problem.
			failed.push(route);
			console.error(`[og] ${route} - card generation failed: ${err?.message ?? err}`);
		}
	}

	console.log(`[og] wrote ${count} card(s) to public/og/ - commit them`);
	if (failed.length) {
		console.error(`[og] FAILED for ${failed.length} route(s): ${failed.join(', ')} - fix before committing`);
		process.exit(1);
	}
	if (count === 0) {
		// dist/ existed but produced nothing - every page skipped or dist/ empty.
		// "wrote 0 cards" exiting 0 would read as success in a chained command.
		console.error('[og] wrote nothing - dist/ has no usable pages, which is not a state to commit');
		process.exit(1);
	}
}

await main();
