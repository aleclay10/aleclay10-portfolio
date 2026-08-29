/**
 * The only search code that loads on every page view (~1 KB, plus Vite's shared
 * preload helper).
 *
 * It owns two decisions and nothing else:
 *
 *   - "the visitor wants to search" → pull in `search-palette.ts`, which with its
 *     share of `search-core.js` is ~10 KB. Loading that eagerly would make search
 *     the single largest thing this site ships, on every page, for a feature most
 *     visitors never open - the wrong trade at a stated bar of ~0 JS.
 *   - "this visitor arrived from a search result" → pull in `search-highlight.ts`.
 *
 * Both live here rather than in two `<script>` tags so the preload helper they share
 * is fetched once. Intent is read generously: hovering or focusing the trigger starts
 * the index fetch, so by the time the click lands the palette usually opens ready.
 */

if (new URLSearchParams(location.search).has('q')) {
	// A lost highlight degrades to a normal page view, but never silently: the
	// visitor clicked a search result and got no highlight, and without this line
	// the only trace would be an unhandled-rejection entry pointing nowhere.
	import('./search-highlight').catch((err) => {
		console.error('[search] arrival highlighter failed to load', err);
	});
}

const palette = document.getElementById('palette');
// Two triggers: the desktop header button, and the item inside the mobile
// disclosure nav (the header button is `sm:flex`, so below `sm` that panel is the
// only way in - there is no keyboard to press ⌘K on).
const triggers = ['cmdk', 'cmdk-mobile']
	.map((id) => document.getElementById(id))
	.filter((el): el is HTMLElement => el !== null);

let engine: Promise<typeof import('./search-palette') | null> | null = null;

function load() {
	// The catch does two jobs. It names the failure (house rule: a chunk that
	// fails to arrive must say so, not surface as an unhandled rejection). And it
	// clears the cache: `engine ??=` would otherwise memoise the *rejected*
	// promise, leaving ⌘K permanently dead for the rest of the page view when the
	// next attempt - one flaky-network moment later - would have succeeded.
	engine ??= import('./search-palette').catch((err): null => {
		console.error('[search] palette engine failed to load', err);
		engine = null;
		return null;
	});
	return engine;
}

/**
 * Marks the keydown that asked for an open, so `search-palette.ts` - which binds ⌘K
 * too, as the *close* toggle - does not treat that same event as a close.
 *
 * Without it the two handlers fight inside a single dispatch, and only after the
 * engine has been loaded once. On the first ⌘K the dynamic import below is a real
 * async task that settles long after the event is done, so the palette opens and
 * stays open. On every later ⌘K `load()` returns an already-resolved promise, so
 * `.then` runs at the microtask checkpoint *between* the two listeners: this one
 * opens the palette, the checkpoint fires, and the palette's own listener then sees
 * a visible palette and closes it again. Net effect was that ⌘K worked exactly once
 * per page load and then silently did nothing.
 *
 * `Symbol.for` rather than a module-local symbol: these two files are separate
 * chunks and have to agree on the key without importing each other.
 */
const OPEN_CLAIMED = Symbol.for('aleclay10.palette.openClaimed');

function openPalette(e?: KeyboardEvent) {
	if (e) Object.defineProperty(e, OPEN_CLAIMED, { value: true });
	void load().then((m) => m?.open());
}

function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

for (const trigger of triggers) {
	trigger.addEventListener('pointerenter', () => void load());
	trigger.addEventListener('focus', () => void load());
	// No event passed: a click cannot be mistaken for the palette's ⌘K close toggle,
	// so it needs no claim marker.
	trigger.addEventListener('click', () => openPalette());
}

document.addEventListener('keydown', (e) => {
	// Only opening lives here. Once the palette is open the engine's own handler has
	// the keyboard, including ⌘K to close - so bail the moment it is visible.
	if (!palette || !palette.hidden) return;

	// `e.key.toLowerCase()` rather than a bare `=== 'k'`: with Caps Lock on, the old
	// palette's shortcut silently did nothing.
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
		e.preventDefault();
		openPalette(e);
		return;
	}

	if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
		e.preventDefault();
		openPalette(e);
	}
});
