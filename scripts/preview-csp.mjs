// Serves dist/ with the PRODUCTION security headers, so a CSP violation shows up
// locally instead of on the live site.
//
// This exists because nothing else in the toolchain exercises the production CSP:
// `astro dev` and `astro preview` set no CSP at all, and the Caddyfile lives outside
// the repo. A fully-built, correctly-deployed Pagefind search was dead for weeks
// behind exactly that gap - the WASM downloaded fine and then failed to compile,
// because `default-src 'self'` has no `wasm-unsafe-eval`. Run this before shipping
// anything that adds or moves a script.
//
// The header below is copied byte-for-byte from ops/Caddyfile (the tracked mirror
// of /opt/homebrew/etc/Caddyfile on the origin host). If the two ever diverge,
// this file is lying - diff them.
//
//   npm run build && node scripts/preview-csp.mjs   →  http://localhost:4321

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const CSP =
	"default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const ROOT = path.resolve('dist');
const PORT = Number(process.env.PORT ?? 4321);

// Without this the server starts happily over a missing dist/ and 404s every
// request - which, in the tool that exists to catch invisible production
// failures, would read as "the CSP broke the whole site".
try {
	await stat(path.join(ROOT, 'index.html'));
} catch {
	console.error('[preview:csp] no dist/index.html - run `npm run build` first.');
	process.exit(1);
}

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.pdf': 'application/pdf',
	'.xml': 'application/xml; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
};

async function resolve(urlPath) {
	const clean = decodeURIComponent(urlPath.split('?')[0]);
	const target = path.join(ROOT, path.normalize(clean));
	if (!target.startsWith(ROOT)) return null;
	try {
		const info = await stat(target);
		if (info.isDirectory()) return resolve(path.posix.join(clean, 'index.html'));
		return target;
	} catch {
		return null;
	}
}

createServer(async (req, res) => {
	const file = await resolve(req.url ?? '/');
	// Set on every response, 404s included - the same as Caddy's `header` block.
	res.setHeader('Content-Security-Policy', CSP);
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

	if (!file) {
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('404');
		return;
	}
	res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
	createReadStream(file)
		.on('error', (err) => {
			// stat() succeeded but the read failed (file replaced mid-request by a
			// rebuild, most likely). Without a handler this is an uncaught 'error'
			// event that takes the whole server down over one request.
			console.error(`[preview:csp] read failed for ${path.relative(ROOT, file)}: ${err.message}`);
			res.destroy();
		})
		.pipe(res);
})
	.on('error', (err) => {
		if (err.code === 'EADDRINUSE') {
			console.error(`[preview:csp] port ${PORT} is already in use - stop the other server or set PORT.`);
		} else {
			console.error(`[preview:csp] server error: ${err.message}`);
		}
		process.exit(1);
	})
	.listen(PORT, () => {
		console.log(`dist/ on http://localhost:${PORT} with the production CSP`);
	});
