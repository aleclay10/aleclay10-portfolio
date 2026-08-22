/**
 * The ⌘K find-in-files palette engine.
 *
 * Loaded on demand by `search-boot.ts`, never eagerly: at ~10 KB it would otherwise
 * be the largest thing this site ships, on every page view, for a feature most
 * visitors never open.
 *
 * Reads `dist/search-index.json` (built by `scripts/search-index-integration.mjs`)
 * and reports *every* occurrence of the query across the site, with surrounding
 * context, grouped by page - JetBrains "Find in Files", not a ranked one-excerpt-
 * per-page result list.
 *
 * The previous implementation loaded Pagefind, whose WASM the production CSP blocks
 * (`default-src 'self'` with no `wasm-unsafe-eval`). Nothing here compiles WASM, so
 * the CSP needs no change. Two rules follow from how that bug stayed hidden for
 * weeks, and both are load-bearing:
 *
 *   1. **Failure states are never merged.** A missing index and a broken index say
 *      different things. The old code reported every failure as "production builds
 *      only", which was false in the one place it mattered.
 *   2. **No `innerHTML` on anything derived from the query.** Rows are assembled from
 *      `createTextNode` and one real `<mark>`. The CSP does nothing about DOM XSS.
 */

import {
	buildContext,
	findMatches,
	fold,
	MAX_MATCHES_PER_PAGE,
	MIN_QUERY,
	parseQuery,
	rankPages,
} from '../lib/search-core.js';

type IndexBlock = { s: number; x: string; k?: 'h' };
type IndexPage = { u: string; t: string; n: string; s: string[]; b: IndexBlock[] };
type SearchIndex = {
	v: number;
	stats: { pages: number; blocks: number; words: number };
	pages: IndexPage[];
};

/** A single occurrence, already resolved to what the row will show. */
type Row = {
	href: string;
	section: string;
	pre: string;
	hit: string;
	post: string;
	/** Document position within the page, so merged AND-fallback rows can be put
	 *  back into reading order. Rows are never sorted by relevance - shuffling them
	 *  destroys the map-of-the-page meaning that makes find-in-files useful. */
	order: number;
};

type Group = {
	page: IndexPage;
	rows: Row[];
	hits: number;
	headingHits: number;
	titleHit: boolean;
	u: string;
};

const MAX_GROUPS = 8;
const MAX_ROWS_PER_GROUP = 12;
const MAX_ROWS_TOTAL = 60;
const DEBOUNCE_MS = 60;
const PAGE_STEP = 8;

const palette = document.getElementById('palette');
const input = document.getElementById('palette-input') as HTMLInputElement | null;
const results = document.getElementById('palette-results');
const status = document.getElementById('palette-status');

/** Folded block text, memoised per index load - folding 250 blocks per keystroke is
 *  cheap but pointless when the corpus never changes. */
const foldedText = new WeakMap<IndexBlock, string>();

let index: SearchIndex | null = null;
let loading: Promise<void> | null = null;
type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
let loadState: LoadState = 'idle';

let options: HTMLAnchorElement[] = [];
let groupStarts: number[] = [];
let active = -1;
let lastFocus: Element | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;

const nf = new Intl.NumberFormat();

/* ------------------------------------------------------------------ loading */

function loadIndex(): Promise<void> {
	if (loading) return loading;
	loadState = 'loading';
	loading = fetch('/search-index.json')
		.then(async (res) => {
			if (res.status === 404) {
				loadState = 'missing';
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			index = (await res.json()) as SearchIndex;
			for (const page of index.pages) {
				for (const block of page.b) foldedText.set(block, fold(block.x));
			}
			loadState = 'ready';
		})
		.catch((err) => {
			loadState = 'error';
			// The whole point of this file: say what actually broke, out loud.
			console.error('[search] index failed to load', err);
		})
		.finally(() => {
			loading = null;
			if (palette && !palette.hidden) update();
		});
	return loading;
}

/* ----------------------------------------------------------------- matching */

function foldedOf(block: IndexBlock): string {
	const cached = foldedText.get(block);
	if (cached !== undefined) return cached;
	const f = fold(block.x);
	foldedText.set(block, f);
	return f;
}

/**
 * Every occurrence of `needle` on one page, in strict document order.
 *
 * Ordinals are assigned by this walk and handed to the highlighter as `&i=`; the
 * per-page cap is applied here rather than per block so both sides count the same
 * way (see `MAX_MATCHES_PER_PAGE` in `search-core.js`).
 */
function searchPage(page: IndexPage, needle: string, raw: string): Group | null {
	const rows: Row[] = [];
	let ordinal = 0;
	let headingHits = 0;
	let remaining = MAX_MATCHES_PER_PAGE;

	page.b.forEach((block, bi) => {
		if (remaining <= 0) return;
		const hay = foldedOf(block);
		const at = findMatches(hay, needle, remaining);
		if (!at.length) return;
		remaining -= at.length;
		if (block.k === 'h') headingHits += at.length;

		for (const start of at) {
			const i = ordinal++;
			if (rows.length >= MAX_ROWS_PER_GROUP) continue;
			const ctx = buildContext(block.x, start, needle.length);
			rows.push({
				href: `${page.u}?q=${encodeURIComponent(raw)}&i=${i}`,
				section: page.s[block.s] ?? '',
				order: bi * 100000 + start,
				...ctx,
			});
		}
	});

	if (!ordinal) return null;
	return {
		page,
		rows,
		hits: ordinal,
		headingHits,
		titleHit: fold(`${page.n} ${page.t}`).includes(needle),
		u: page.u,
	};
}

function searchAll(needle: string, raw: string): Group[] {
	if (!index) return [];
	const groups: Group[] = [];
	for (const page of index.pages) {
		const g = searchPage(page, needle, raw);
		if (g) groups.push(g);
	}
	return rankPages(groups).slice(0, MAX_GROUPS);
}

/* ---------------------------------------------------------------- rendering */

function clear(el: HTMLElement) {
	while (el.firstChild) el.removeChild(el.firstChild);
}

function setStatus(text: string, retry = false) {
	if (!status) return;
	clear(status);
	status.append(document.createTextNode(text));
	if (retry) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = 'Retry';
		btn.className =
			'ml-3 rounded border border-line px-2 py-0.5 text-ink transition hover:border-accent hover:text-accent';
		btn.addEventListener('click', () => {
			loadState = 'idle';
			setStatus('Loading search index…');
			void loadIndex();
		});
		status.append(btn);
	}
}

function renderGroups(groups: Group[]) {
	if (!results) return;
	clear(results);
	options = [];
	groupStarts = [];

	let total = 0;
	groups.forEach((g, gi) => {
		if (total >= MAX_ROWS_TOTAL) return;

		const section = document.createElement('div');
		section.setAttribute('role', 'group');
		const headId = `palette-group-${gi}`;
		section.setAttribute('aria-labelledby', headId);

		const head = document.createElement('p');
		head.id = headId;
		head.className =
			'sticky top-0 z-10 flex items-baseline gap-x-3 border-b border-line bg-canvas px-4 py-2';

		const name = document.createElement('span');
		name.className = 'shrink-0 font-mono text-[12px] font-medium text-ink';
		name.textContent = g.page.n;

		const title = document.createElement('span');
		title.className = 'truncate font-serif text-[13px] text-muted';
		title.textContent = g.page.t;

		const count = document.createElement('span');
		count.className = 'ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted';
		count.textContent = g.hits > g.rows.length ? `${g.rows.length} of ${g.hits}` : String(g.hits);

		head.append(name, title, count);
		section.append(head);

		groupStarts.push(options.length);

		for (const row of g.rows) {
			if (total >= MAX_ROWS_TOTAL) break;
			total++;

			// A real <a href> so ⌘-click and middle-click open a new tab for free.
			const a = document.createElement('a');
			a.href = row.href;
			a.setAttribute('role', 'option');
			a.setAttribute('aria-selected', 'false');
			a.id = `palette-option-${options.length}`;
			a.className =
				'flex scroll-mt-9 items-baseline gap-x-3 px-4 py-2 transition hover:bg-surface ' +
				// aria-selected drives the background, so the visual and the announced
				// state cannot drift apart the way a hand-maintained class pair can.
				'aria-selected:bg-surface';

			if (row.section) {
				const label = document.createElement('span');
				label.className = 'hidden w-28 shrink-0 truncate font-mono text-[11px] text-muted sm:block';
				label.textContent = row.section;
				a.append(label);
			}

			const text = document.createElement('span');
			text.className = 'line-clamp-2 min-w-0 flex-1 text-[13px] leading-relaxed text-muted';
			const mark = document.createElement('mark');
			mark.textContent = row.hit;
			text.append(document.createTextNode(row.pre), mark, document.createTextNode(row.post));
			a.append(text);

			const i = options.length;
			a.addEventListener('mousemove', () => setActive(i, false));
			options.push(a);
			section.append(a);
		}

		results.append(section);
	});

	setActive(options.length ? 0 : -1, false);
}

function setActive(i: number, scroll = true) {
	active = i;
	options.forEach((a, n) => a.setAttribute('aria-selected', n === i ? 'true' : 'false'));
	const el = options[i];
	if (el) {
		if (scroll) el.scrollIntoView({ block: 'nearest' });
		input?.setAttribute('aria-activedescendant', el.id);
	} else {
		input?.removeAttribute('aria-activedescendant');
	}
}

/* ------------------------------------------------------------------- update */

function update() {
	if (!input || !results) return;
	const raw = input.value.trim();

	if (loadState === 'loading' || loadState === 'idle') {
		clear(results);
		options = [];
		active = -1;
		setStatus('Loading search index…');
		return;
	}
	if (loadState === 'missing') {
		clear(results);
		options = [];
		active = -1;
		setStatus('Search index not built. Run npm run build, then npm run preview.');
		return;
	}
	if (loadState === 'error' || !index) {
		clear(results);
		options = [];
		active = -1;
		setStatus('Search index failed to load.', true);
		return;
	}

	const stats = index.stats;
	const idleHint = `Search ${nf.format(stats.pages)} pages · ${nf.format(stats.words)} words`;

	if (raw.length < MIN_QUERY) {
		clear(results);
		options = [];
		active = -1;
		setStatus(idleHint);
		return;
	}

	const q = parseQuery(raw);
	let groups = searchAll(q.phrase, raw);
	let notice = '';

	// Phrase first - that is the find-in-files contract. Only when it finds nothing
	// do we relax to AND-of-terms, and then we say so rather than quietly changing
	// what the results mean.
	if (!groups.length && q.canFallback) {
		const perTerm = q.terms.map((t) => ({ term: t, groups: searchAll(t, t) }));
		const common = perTerm
			.map((p) => new Set(p.groups.map((g) => g.u)))
			.reduce((a, b) => new Set([...a].filter((u) => b.has(u))));
		const merged = perTerm
			.flatMap((p) => p.groups)
			.filter((g) => common.has(g.u))
			.reduce<Group[]>((acc, g) => {
				const at = acc.findIndex((x) => x.u === g.u);
				if (at === -1) acc.push({ ...g, rows: [...g.rows] });
				else {
					acc[at].rows.push(...g.rows);
					acc[at].hits += g.hits;
					acc[at].headingHits += g.headingHits;
					acc[at].titleHit ||= g.titleHit;
				}
				return acc;
			}, [])
			.map((g) => {
				g.rows.sort((a, b) => a.order - b.order);
				g.rows.length = Math.min(g.rows.length, MAX_ROWS_PER_GROUP);
				return g;
			});
		groups = rankPages(merged).slice(0, MAX_GROUPS);
		if (groups.length) notice = `No page contains that phrase; showing pages with all ${q.terms.length} words.`;
	}

	if (!groups.length) {
		clear(results);
		options = [];
		active = -1;
		setStatus(`No matches for “${raw}”.`);
		return;
	}

	renderGroups(groups);
	const hits = groups.reduce((n, g) => n + g.hits, 0);
	const shown = options.length;
	const counted =
		shown < hits
			? `${nf.format(shown)} of ${nf.format(hits)} matches on ${groups.length} page${groups.length === 1 ? '' : 's'}`
			: `${nf.format(hits)} match${hits === 1 ? '' : 'es'} on ${groups.length} page${groups.length === 1 ? '' : 's'}`;
	setStatus(notice ? `${counted} · ${notice}` : `${counted} · ↑↓ move · ↵ open · ⌘↵ new tab`);
}

/* --------------------------------------------------------------- open/close */

/**
 * Opening is owned by `search-boot.ts`, which is what dynamically imports this
 * module - by the time this runs, the keystroke or click that asked for it is long
 * since handled. Everything *while* the palette is open is owned here.
 */
export function open() {
	if (!palette || !input) return;
	lastFocus = document.activeElement;
	palette.hidden = false;
	document.body.style.overflow = 'hidden';
	input.value = '';
	update();
	input.focus();
	void loadIndex();
}

function close() {
	if (!palette || palette.hidden) return;
	palette.hidden = true;
	document.body.style.overflow = '';
	input?.removeAttribute('aria-activedescendant');
	if (lastFocus instanceof HTMLElement) {
		lastFocus.focus();
		// Opening from the mobile nav closes that panel, so the element we came from
		// can be display:none by now and silently refuse focus - which would drop the
		// user at the top of the document. Fall back to whichever trigger is visible.
		if (document.activeElement !== lastFocus) {
			[...document.querySelectorAll<HTMLElement>('#cmdk, #nav-toggle')]
				.find((el) => el.offsetParent !== null)
				?.focus();
		}
	}
	lastFocus = null;
}

/* ------------------------------------------------------------------ wiring */

input?.addEventListener('input', () => {
	clearTimeout(debounce);
	debounce = setTimeout(update, DEBOUNCE_MS);
});

palette?.addEventListener('click', (e) => {
	if (e.target === palette) close();
});

document.addEventListener('keydown', (e) => {
	// Only ever handles an *open* palette. Opening - ⌘K, `/`, the trigger button -
	// belongs to search-boot.ts, because until it happens this module is not loaded.
	if (!palette || palette.hidden) return;

	// Bare `e.key === 'k'` misses with Caps Lock on - the old palette's quietest bug.
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
		e.preventDefault();
		close();
		return;
	}

	if (e.key === 'Escape') {
		e.preventDefault();
		close();
		return;
	}

	// Focus stays in the input and `aria-activedescendant` points at the selected
	// option - the standard combobox/listbox pattern, and its own focus trap.
	if (e.key === 'Tab') {
		e.preventDefault();
		input?.focus();
		return;
	}

	if (!options.length) return;
	const last = options.length - 1;

	switch (e.key) {
		case 'ArrowDown':
			e.preventDefault();
			// ⌥ jumps to the next page group. Option rewrites `e.key` for letters on
			// macOS (⌥j arrives as '∆') but leaves the arrows alone, which is why the
			// group jump is bound here and not to a letter.
			if (e.altKey) setActive(nextGroup(true));
			else setActive(active >= last ? 0 : active + 1);
			return;
		case 'ArrowUp':
			e.preventDefault();
			if (e.altKey) setActive(nextGroup(false));
			else setActive(active <= 0 ? last : active - 1);
			return;
		case 'PageDown':
			e.preventDefault();
			setActive(Math.min(last, active + PAGE_STEP));
			return;
		case 'PageUp':
			e.preventDefault();
			setActive(Math.max(0, active - PAGE_STEP));
			return;
		case 'Home':
			e.preventDefault();
			setActive(0);
			return;
		case 'End':
			e.preventDefault();
			setActive(last);
			return;
		case 'Enter': {
			const el = options[active];
			if (!el) return;
			e.preventDefault();
			if (e.metaKey || e.ctrlKey) window.open(el.href, '_blank', 'noopener');
			else window.location.href = el.href;
			return;
		}
	}
});

/** Index of the next (or previous) group's first row, wrapping at either end. */
function nextGroup(forward: boolean): number {
	if (!groupStarts.length) return active;
	const found = forward
		? groupStarts.find((s) => s > active)
		: [...groupStarts].reverse().find((s) => s < active);
	return found ?? (forward ? groupStarts[0] : groupStarts[groupStarts.length - 1]);
}
