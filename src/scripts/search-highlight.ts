/**
 * Arrival highlighter for `?q=<literal>&i=<ordinal>` deep links.
 *
 * Loaded only when `q` is present (see the guard in `Base.astro`), so a normal
 * navigation pays about 120 bytes rather than this chunk.
 *
 * The ordinal is assigned at build time by `scripts/search-index-integration.mjs`
 * and recomputed here against the live DOM. Both sides call the same
 * `extractBlocks` / `blockTextMap` / `fold` / `findMatches` out of
 * `src/lib/search-core.js` — that shared walker is the only reason `&i=3` reliably
 * means the same occurrence in both places.
 *
 * Wrapping uses `Range` + `<mark>` rather than the CSS Custom Highlight API:
 * `::highlight()` cannot do `border-radius`, so it could not reproduce the existing
 * `mark` style and would need a second styling path plus feature detection. Mutating
 * the DOM is safe here — the site ships zero framework islands and zero `client:*`
 * directives, so nothing else owns these nodes.
 */

import {
	blockTextMap,
	extractBlocks,
	findMatches,
	fold,
	MAX_MATCHES_PER_PAGE,
	MIN_QUERY,
	parseQuery,
} from '../lib/search-core.js';

type Segment = { node: Text; start: number; end: number };

/**
 * A match may span several text nodes — `, including ` followed by
 * `<a>Kowalski</a>` is one phrase across two. A single `Range.surroundContents()`
 * over that would throw, and `extractContents()` would tear the `<a>` in half, so
 * each contiguous run inside one text node gets its own `<mark>` and they are tied
 * together by a shared `data-search-hit` ordinal.
 */
function segmentsFor(
	map: ReturnType<typeof blockTextMap>['map'],
	start: number,
	end: number
): Segment[] {
	const out: Segment[] = [];
	for (let i = start; i < end; i++) {
		const origin = map[i];
		if (!origin) continue; // synthetic <br> space — nothing to wrap
		const last = out[out.length - 1];
		if (last && last.node === origin.node) {
			// Offsets are strictly increasing within a text node, so anything else is
			// a map invariant violation — drop it rather than wrap a range twice.
			if (origin.offset < last.end) continue;
			if (origin.offset === last.end) {
				last.end = origin.offset + 1;
				continue;
			}
		}
		out.push({ node: origin.node, start: origin.offset, end: origin.offset + 1 });
	}
	return out;
}

function wrap(seg: Segment, ordinal: number): HTMLElement | null {
	try {
		const range = document.createRange();
		range.setStart(seg.node, seg.start);
		range.setEnd(seg.node, seg.end);
		const mark = document.createElement('mark');
		mark.dataset.searchHit = String(ordinal);
		range.surroundContents(mark);
		return mark;
	} catch {
		// A boundary we cannot wrap is a missing highlight, not a broken page.
		return null;
	}
}

function run() {
	const params = new URLSearchParams(location.search);
	const raw = params.get('q');
	if (raw === null) return;

	const { phrase } = parseQuery(raw);
	const main = document.querySelector('main');
	if (phrase.length < MIN_QUERY || !main) return;

	/** First `<mark>` of each occurrence, in document order. */
	const firstMarks: HTMLElement[] = [];
	let ordinal = 0;
	let remaining = MAX_MATCHES_PER_PAGE;

	for (const block of extractBlocks(main)) {
		if (remaining <= 0) break;
		const { text, map } = blockTextMap(block.el);
		const at = findMatches(fold(text), phrase, remaining);
		if (!at.length) continue;
		remaining -= at.length;

		const base = ordinal;
		ordinal += at.length;

		// Wrap back to front: `splitText` leaves everything before the split point in
		// the original node at unchanged offsets, so earlier matches keep the offsets
		// this block's map recorded. Front to back would invalidate them all.
		for (let n = at.length - 1; n >= 0; n--) {
			const segs = segmentsFor(map, at[n], at[n] + phrase.length);
			let first: HTMLElement | null = null;
			for (let s = segs.length - 1; s >= 0; s--) {
				const mark = wrap(segs[s], base + n);
				if (mark) first = mark;
			}
			if (first) firstMarks[base + n] = first;
		}
	}

	if (!ordinal) return;

	// A stale link (content moved, `&i=` beyond the end) falls back to the first
	// match. Highlighting the wrong occurrence beats highlighting nothing and
	// leaving the visitor to wonder whether search is broken again.
	const asked = Number(params.get('i'));
	const i = Number.isInteger(asked) && asked >= 0 && asked < ordinal ? asked : 0;

	const chosen = document.querySelectorAll<HTMLElement>(`mark[data-search-hit="${i}"]`);
	const target = chosen[0] ?? firstMarks.find(Boolean);
	if (target) {
		for (const mark of chosen) mark.dataset.searchHit = 'current';
		const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
		// `block: 'center'` makes scroll-margin a non-issue and scrolls horizontal
		// ancestors too, so a match inside #tl-rail or the /investing table comes
		// into view laterally for free.
		target.scrollIntoView({ block: 'center', behavior });
	}

	// Keep the highlight but drop the parameters: shareable ?q= URLs would otherwise
	// be crawlable duplicates of the clean path.
	params.delete('q');
	params.delete('i');
	const qs = params.toString();
	history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', run);
} else {
	// The dynamic import that pulls this chunk in can resolve after DOMContentLoaded
	// has already fired, in which case the listener above would never run.
	run();
}
