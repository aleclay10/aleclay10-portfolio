// Set the theme class before first paint to avoid a flash.
// Loaded as a blocking classic script in <head>; kept external because the
// production CSP (default-src 'self') blocks inline scripts.
(() => {
	const stored = localStorage.getItem('theme');
	const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	document.documentElement.classList.toggle('dark', dark);
})();
