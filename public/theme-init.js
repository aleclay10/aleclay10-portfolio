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

	// Hero reveal, once per tab session. The fade-up ran on every page load, so
	// the same hero animated on every navigation, back button included. The
	// first page of a session keeps it; later pages skip it through a class on
	// <html>, set here before paint so there is no flash (the cross-document
	// view transition already eases those). Lives in this file because it is the
	// one script that runs before first paint. sessionStorage throws when
	// storage is blocked; then every page reveals, which is the old behaviour.
	try {
		if (sessionStorage.getItem('revealed')) document.documentElement.classList.add('no-reveal');
		else sessionStorage.setItem('revealed', '1');
	} catch {
		/* storage blocked - reveal on every page */
	}
})();
