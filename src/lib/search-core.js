// @ts-check
/**
 * Shared extraction + matching contract for the site's find-in-files search.
 *
 * THE CORRECTNESS HINGE. Three consumers share this module:
 *
 *   1. scripts/search-index-integration.mjs - walks the built HTML in `dist/` under
 *      Node (via linkedom) at build time and writes `dist/search-index.json`.
 *   2. src/scripts/search-palette.ts - matches against that JSON in the ⌘K palette.
 *   3. src/scripts/search-highlight.ts - re-walks the *live* DOM on `?q=` arrival
 *      and highlights the requested occurrence.
 *
 * (1) assigns each occurrence an ordinal; (3) recomputes that ordinal from scratch.
 * If the two walkers can ever disagree about which blocks exist, in what order, or
 * what text they hold, every deep link becomes a coin flip. So there is exactly one
 * walker - this one - and it must run unmodified in both environments. That is why
 * it only uses DOM APIs linkedom actually implements (`matches`, `closest`,
 * `children`, `childNodes`, `classList`, `previousElementSibling`, `parentElement`)
 * and why the block-dropping and dedupe rules live *here* rather than in the
 * indexer: a rule applied on one side only is drift by another name.
 *
 * Plain ESM with JSDoc rather than TypeScript, deliberately: the indexer is a `.mjs`
 * Astro integration and cannot import a `.ts` file without Node type-stripping flags,
 * and `deploy-signed.sh` runs whatever Node the host's nvm resolves highest. `npx
 * astro check` type-checks this file through `// @ts-check`.
 *
 * ## Extraction contract
 *
 * - **Scope is the page's `<main>`.** Nav, header, footer and `#palette` all live
 *   outside it in `Base.astro`, so chrome exclusion is structural - no opt-in
 *   attribute, nothing to forget on a new page.
 * - **SKIP_SELECTOR** removes non-content and the `/investing` live-price cells.
 *   Those hold a literal `–` at build time and are rewritten by that page's own
 *   script after load: indexing them would pollute the index with em-dashes, and
 *   highlighting them would race a script that overwrites `textContent` wholesale.
 * - **ATOMIC_SELECTOR** (`tr`, `dl > div`) emits as a single record without
 *   descending. A lone `<td>` reading `2.71%` is a useless result row; the whole
 *   row is the meaningful unit.
 * - **BLOCK_SELECTOR** emits only when the element holds no block/atomic
 *   descendant, which splits a timeline `<li>` (an `h3` plus two `<p>`) into three
 *   tight rows instead of one paragraph-sized blob.
 * - **Text** is the concatenation of descendant text nodes in order, whitespace
 *   collapsed and trimmed, with a synthetic space at every `<br>` and at the edge of
 *   every non-inline element. Synthesising those spaces is only safe because it
 *   happens *here*, in the walker both consumers share - the two sides insert the
 *   same characters at the same offsets, so ordinals still agree, and the synthetic
 *   characters carry a null origin so the highlighter skips over them. Word
 *   boundaries lost between two *inline* elements are not recoverable structurally
 *   and are reported as a build warning instead.
 */

/**
 * Non-content, plus the `/investing` cells that a client script rewrites after load.
 * @type {string}
 */
export const SKIP_SELECTOR = [
	'script',
	'style',
	'noscript',
	'template',
	'svg',
	'[hidden]',
	'[aria-hidden="true"]',
	'[data-search-skip]',
	'[data-price]',
	'[data-change]',
	'[data-weight]',
	'[data-watch-price]',
	'[data-watch-change]',
	'[data-thesis-weight]',
	'[data-seg-value]',
	'#day-change',
	'#day-change-label',
	'#price-asof',
].join(', ');

/** Emitted whole, never descended into. @type {string} */
export const ATOMIC_SELECTOR = 'tr, dl > div';

/** Emitted only when it contains no block/atomic descendant. @type {string} */
export const BLOCK_SELECTOR =
	'p, li, h1, h2, h3, h4, h5, h6, dt, dd, blockquote, figcaption, summary, td, th';

/**
 * Elements that are inline by default, i.e. the ones whose boundaries are *not* word
 * boundaries. Everything else contributes a space on the way in and out - see
 * `blockTextMap`.
 */
const INLINE_TAGS = new Set([
	'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'IMG',
	'KBD', 'LABEL', 'MARK', 'OUTPUT', 'PICTURE', 'Q', 'RUBY', 'S', 'SAMP', 'SMALL',
	'SOURCE', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

/**
 * The site labels its sections with styled `<p>` eyebrows rather than headings
 * ("Colophon", "The pipeline", "Security posture"). They are identified by the two
 * utility classes every one of them carries. Fragile by construction - see R1 in the
 * plan - so `[data-search-section]` overrides it and an unlabelled block warns.
 */
const EYEBROW_CLASSES = ['uppercase', 'tracking-[0.2em]'];

/**
 * Route order used as the final ranking tiebreak: nav order, then the pages linked
 * from the body and footer.
 * @type {readonly string[]}
 */
export const NAV_ORDER = [
	'/',
	'/gaming-assistant/',
	'/investing/',
	'/stack/',
	'/now/',
	'/uses/',
	'/kowalski/',
	'/resume/',
];

/** The most occurrences reported for a single page. */
export const MAX_MATCHES_PER_PAGE = 200;

/** Queries shorter than this are ignored - every page matches "a". */
export const MIN_QUERY = 2;

/** `\s` already covers U+00A0; U+200B does not match it and renders as nothing. */
const WS_CHAR = /[\s\u00a0\u200b]/;
const WS_RUN = /[\s\u00a0\u200b]+/g;

/**
 * @param {string} s
 * @returns {string}
 */
function collapse(s) {
	return s.replace(WS_RUN, ' ').trim();
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isSkipped(el) {
	return el.matches(SKIP_SELECTOR);
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isEyebrow(el) {
	return EYEBROW_CLASSES.every((c) => el.classList.contains(c));
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isHeading(el) {
	return /^H[1-6]$/.test(el.tagName);
}

/**
 * A block's text plus a per-character map back to the text nodes it came from.
 *
 * The map is what lets the arrival highlighter wrap a phrase that spans a text-node
 * boundary (`, including ` + `<a>Kowalski</a>`) - and, more importantly, lets it
 * *count* that phrase the same way the indexer counted it.
 *
 * @typedef {{ node: Text, offset: number } | null} CharOrigin
 * @param {Element} el
 * @returns {{ text: string, map: CharOrigin[] }}
 */
export function blockTextMap(el) {
	/** @type {{ node: Text | null, raw: string }[]} */
	const parts = [];

	/** @param {Element} node */
	const gather = (node) => {
		for (const child of node.childNodes) {
			if (child.nodeType === 3) {
				parts.push({ node: /** @type {Text} */ (child), raw: child.nodeValue ?? '' });
			} else if (child.nodeType === 1) {
				const child_ = /** @type {Element} */ (/** @type {unknown} */ (child));
				if (isSkipped(child_)) continue;
				// A <br>, or the edge of any non-inline element, is a word boundary in the
				// rendered page but contributes no text node - so synthesise one. Without
				// this an atomic `dl > div` indexes as "LanguagesPython, C, C++" and a
				// table row as "AssetVectorWeightPriceToday".
				//
				// This is safe *because it lives here*: the indexer and the highlighter
				// both go through this function, so they insert the same characters in the
				// same places and their ordinals still agree. The synthetic character has
				// a null origin, so the highlighter skips it when wrapping, exactly as it
				// already did for <br>.
				const boundary = child_.tagName === 'BR' || !INLINE_TAGS.has(child_.tagName);
				if (boundary) parts.push({ node: null, raw: ' ' });
				gather(child_);
				if (boundary) parts.push({ node: null, raw: ' ' });
			}
		}
	};
	gather(el);

	let text = '';
	/** @type {CharOrigin[]} */
	const map = [];
	let pendingSpace = false;
	/** @type {CharOrigin} */
	let pendingOrigin = null;
	let started = false;

	for (const { node, raw } of parts) {
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i];
			if (WS_CHAR.test(ch)) {
				// A collapsed run of whitespace becomes one space, attributed to the
				// FIRST character of the run. Attributing it to the character that
				// follows instead would give two output characters the same origin
				// offset, which splits an otherwise contiguous match into two
				// <mark>s with an unhighlighted gap between them.
				if (started && !pendingSpace) {
					pendingSpace = true;
					pendingOrigin = node ? { node, offset: i } : null;
				}
				continue;
			}
			if (pendingSpace) {
				text += ' ';
				map.push(pendingOrigin);
				pendingSpace = false;
				pendingOrigin = null;
			}
			text += ch;
			map.push(node ? { node, offset: i } : null);
			started = true;
		}
	}

	return { text, map };
}

/**
 * Resolve the human-readable section label for a block.
 *
 * Order: `[data-search-section]` override → the block's own text if it *is* an
 * eyebrow → nearest preceding eyebrow → nearest preceding `h2`/`h3` → `''`. The
 * search is bounded by the block's nearest `<section>` so a section that forgot its
 * eyebrow inherits nothing from the one above it; it reports `''` and the build warns.
 *
 * @param {Element} el
 * @param {Element} root
 * @returns {string}
 */
export function sectionLabel(el, root) {
	const tagged = el.closest('[data-search-section]');
	if (tagged) return collapse(tagged.getAttribute('data-search-section') ?? '');

	if (isEyebrow(el)) return collapse(el.textContent ?? '');

	const bound = el.closest('section') ?? root;

	for (const p of precedingWithin(el, bound)) {
		if (isSkipped(p)) continue;
		if (isEyebrow(p)) return collapse(p.textContent ?? '');
	}
	for (const p of precedingWithin(el, bound)) {
		if (isSkipped(p)) continue;
		if (p.tagName === 'H2' || p.tagName === 'H3') return collapse(p.textContent ?? '');
	}
	return '';
}

/**
 * Every element before `el` in document order, nearest first, without leaving `bound`.
 * @param {Element} el
 * @param {Element} bound
 * @returns {Generator<Element>}
 */
function* precedingWithin(el, bound) {
	/** @type {Element | null} */
	let node = el;
	while (node && node !== bound) {
		let sib = node.previousElementSibling;
		while (sib) {
			yield* reverseSubtree(sib);
			sib = sib.previousElementSibling;
		}
		node = node.parentElement;
	}
}

/**
 * A subtree in reverse document order: deepest-last descendant first, root last.
 * @param {Element} el
 * @returns {Generator<Element>}
 */
function* reverseSubtree(el) {
	const kids = el.children;
	for (let i = kids.length - 1; i >= 0; i--) {
		yield* reverseSubtree(/** @type {Element} */ (kids[i]));
	}
	yield el;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function hasBlockDescendant(el) {
	for (const child of el.children) {
		const c = /** @type {Element} */ (child);
		if (isSkipped(c)) continue;
		if (c.matches(ATOMIC_SELECTOR) || c.matches(BLOCK_SELECTOR)) return true;
		if (hasBlockDescendant(c)) return true;
	}
	return false;
}

/**
 * @typedef {object} Block
 * @property {Element} el
 * @property {string} text     Collapsed, trimmed visible text.
 * @property {string} section  Section label, `''` when none could be resolved.
 * @property {boolean} heading Whether the block is an `h1`–`h6`.
 */

/**
 * The single walker. Returns the page's blocks in document order.
 *
 * Both the block-length floor and the within-page dedupe are applied here rather
 * than in the indexer: they change which ordinal each occurrence gets, so both
 * consumers must apply them identically or deep links drift. Dedupe is per page
 * only - "Cloudflare Tunnel" legitimately appears on three different pages.
 *
 * @param {Element} root Normally the page's `<main>`.
 * @returns {Block[]}
 */
export function extractBlocks(root) {
	/** @type {Block[]} */
	const out = [];
	const seen = new Set();

	/** @param {Element} el */
	const emit = (el) => {
		const { text } = blockTextMap(el);
		if (text.length < 2) return;
		const key = fold(text);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ el, text, section: sectionLabel(el, root), heading: isHeading(el) });
	};

	/** @param {Element} el */
	const walk = (el) => {
		if (el !== root) {
			if (isSkipped(el)) return;
			if (el.matches(ATOMIC_SELECTOR)) return emit(el);
			if (el.matches(BLOCK_SELECTOR) && !hasBlockDescendant(el)) return emit(el);
		}
		for (const child of el.children) walk(/** @type {Element} */ (child));
	};

	walk(root);
	return out;
}

/**
 * Case- and diacritic-folded, **offset-preserving**.
 *
 * `fold(s).length === s.length` is load-bearing: the context window and the
 * highlighter both index the *unfolded* string with offsets found in the folded one.
 * So folding runs per code point and only substitutes when the replacement is the
 * same length - `é → e` (single combining mark stripped) applies, `ﬁ` and `ß` fall
 * through unchanged. Typographic quotes and dashes are normalised 1:1 so a visitor
 * typing `that's` matches the page's rendered `that’s`.
 *
 * Punctuation-eliding folds (`dont` → `don't`) are deliberately **not** supported:
 * deleting a character breaks the length invariant, and a wrong `<mark>` position on
 * every deep link is a worse failure than a missed apostrophe.
 *
 * @param {string} s
 * @returns {string}
 */
export function fold(s) {
	let out = '';
	for (const ch of s) {
		if (ch === '’' || ch === '‘' || ch === 'ʼ') {
			out += "'";
			continue;
		}
		if (ch === '“' || ch === '”') {
			out += '"';
			continue;
		}
		// en dash / em dash / minus sign, by code point so no build step can
		// fold them back into literal glyphs in the shipped chunk
		const code = ch.codePointAt(0);
		if (code === 0x2013 || code === 0x2014 || code === 0x2212) {
			out += '-';
			continue;
		}
		const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		out += stripped.length === ch.length ? stripped : ch;
	}
	return out.toLowerCase();
}

/**
 * @typedef {object} Query
 * @property {string} phrase       The whole trimmed query, folded. Always tried first.
 * @property {string[]} terms      Whitespace-separated pieces, folded.
 * @property {boolean} quoted      Whether the user wrapped the query in double quotes.
 * @property {boolean} canFallback Whether an AND-of-terms retry is worth offering
 *                                 when the phrase matches nothing. False for a single
 *                                 term (nothing to retry) and for a quoted phrase
 *                                 (the quotes are the user saying "don't").
 */

/**
 * Find-in-files semantics: the whole trimmed query is one literal substring. That is
 * what makes `?q=` unambiguous. `"quoted"` forces the phrase reading even when the
 * caller would otherwise fall back to AND-of-terms.
 *
 * @param {string} raw
 * @returns {Query}
 */
export function parseQuery(raw) {
	let s = raw.trim();
	let quoted = false;
	if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
		s = s.slice(1, -1).trim();
		quoted = true;
	}
	const phrase = fold(collapse(s));
	const terms = phrase.split(' ').filter((t) => t.length >= MIN_QUERY);
	return { phrase, terms, quoted, canFallback: !quoted && terms.length >= 2 };
}

/**
 * Every occurrence of `needle` in `hay`, including overlapping ones (advance by
 * `start + 1`, not `start + needle.length` - "aaa" contains two "aa").
 *
 * Both arguments must already be folded, and folding is offset-preserving, so the
 * returned offsets index the unfolded string too.
 *
 * @param {string} hay
 * @param {string} needle
 * @param {number} [cap]
 * @returns {number[]}
 */
export function findMatches(hay, needle, cap = MAX_MATCHES_PER_PAGE) {
	/** @type {number[]} */
	const out = [];
	if (needle.length < MIN_QUERY) return out;
	let from = 0;
	for (;;) {
		const at = hay.indexOf(needle, from);
		if (at === -1 || out.length >= cap) return out;
		out.push(at);
		from = at + 1;
	}
}

/**
 * A window of surrounding text for one occurrence, snapped to word boundaries where
 * it can be done cheaply and *never* trimmed into the match itself.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} len
 * @param {{ budget?: number, lead?: number, slack?: number }} [opts]
 * @returns {{ pre: string, hit: string, post: string }}
 */
export function buildContext(text, start, len, opts = {}) {
	const budget = opts.budget ?? 96;
	const lead = opts.lead ?? 32;
	const slack = opts.slack ?? 12;
	const end = start + len;

	let s = Math.max(0, start - lead);
	if (s > 0) {
		const limit = Math.min(start, s + slack);
		for (let i = s; i < limit; i++) {
			if (text[i] === ' ') {
				s = i + 1;
				break;
			}
		}
	}

	const room = Math.max(0, budget - len - (start - s));
	let e = Math.min(text.length, end + room);
	if (e < text.length) {
		const limit = Math.max(end, e - slack);
		for (let i = e; i > limit; i--) {
			if (text[i] === ' ') {
				e = i;
				break;
			}
		}
	}

	return {
		pre: (s > 0 ? '…' : '') + text.slice(s, start),
		hit: text.slice(start, end),
		post: text.slice(end, e) + (e < text.length ? '…' : ''),
	};
}

/**
 * @typedef {object} PageRank
 * @property {string} u          Route, e.g. `/stack/`.
 * @property {boolean} titleHit  Query appears in the page title.
 * @property {number} headingHits Occurrences inside headings.
 * @property {number} hits       Total occurrences.
 */

/**
 * Order pages by a plain tuple, not a weighted score. With eight pages a scoring
 * function is unfalsifiable noise; "title hit beats heading hit beats more hits,
 * ties broken by nav order" is a rule a reader can check by eye.
 *
 * Sorts in place and returns the same array.
 *
 * @template {PageRank} T
 * @param {T[]} pages
 * @returns {T[]}
 */
export function rankPages(pages) {
	const navIndex = (/** @type {string} */ u) => {
		const i = NAV_ORDER.indexOf(u);
		return i === -1 ? NAV_ORDER.length : i;
	};
	return pages.sort(
		(a, b) =>
			Number(b.titleHit) - Number(a.titleHit) ||
			b.headingHits - a.headingHits ||
			b.hits - a.hits ||
			navIndex(a.u) - navIndex(b.u) ||
			a.u.localeCompare(b.u)
	);
}
