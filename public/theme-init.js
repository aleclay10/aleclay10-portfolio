// Set the theme class before first paint to avoid a flash.
// Loaded as a blocking classic script in <head>; kept external because the
// production CSP (default-src 'self') blocks inline scripts.
(() => {
	// localStorage *access* throws when storage is blocked (Safari's "Block all
	// cookies", some embedded webviews). This script runs before anything else,
	// so an uncaught throw here doesn't just lose the preference - it kills
	// theming entirely and guarantees the flash it exists to prevent. Storage
	// denied degrades to the OS preference, which is the pre-toggle behavior.
	let stored = null;
	try {
		stored = localStorage.getItem('theme');
	} catch {
		/* storage blocked - fall through to the media query */
	}
	const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	document.documentElement.classList.toggle('dark', dark);
})();
