/**
 * The site's two write endpoints, one Worker at the Cloudflare edge:
 *
 *   POST /api/waitlist   early access for the AI Gaming Assistant   → waitlist.ts
 *   POST /api/feedback   tips about the site, via the mascot        → feedback.ts
 *
 * Both run at the edge so a public write endpoint and a table of real people's
 * names and email addresses never touch the Mac mini — the host that also holds
 * Google OAuth tokens, the tunnel credentials and holdings.json.
 *
 * Same-origin with the site by design. That is what lets the browser `fetch`
 * satisfy the production CSP (`default-src 'self'`) with no `connect-src`
 * amendment. A subdomain would have required loosening the policy.
 *
 * The Worker's name is still `aleclay10-waitlist`: renaming a deployed Worker
 * creates a second one and orphans the first, routes and all, for no gain.
 */

import { feedbackServerFailure, handleFeedback } from './feedback';
import { json, methodNotAllowed, originAllowed, type Env } from './shared';
import { handleWaitlist, waitlistServerFailure } from './waitlist';

type Route = {
	handle: (request: Request, env: Env) => Promise<Response>;
	/** The styled dead-end for anything the handler throws unexpectedly. */
	onError: (request: Request) => Response;
	label: string;
};

const ROUTES: Record<string, Route> = {
	'/api/waitlist': { handle: handleWaitlist, onError: waitlistServerFailure, label: 'waitlist' },
	'/api/feedback': { handle: handleFeedback, onError: feedbackServerFailure, label: 'feedback' },
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const route = ROUTES[new URL(request.url).pathname];
		if (!route) return json({ error: 'Not found.' }, 404);
		if (request.method !== 'POST') return methodNotAllowed();
		if (!originAllowed(request)) return json({ error: 'Forbidden.' }, 403);

		// Last-resort backstop. Without it, anything a handler throws that its own
		// try/catches do not cover surfaces as Cloudflare's raw exception page -
		// which for the no-JS form visitor is a dead end with no styled retry path,
		// and for `wrangler tail` an error with no context. Every *expected* failure
		// is still handled at its own site with its own message; this only exists so
		// an unexpected one degrades the same way the D1 path does.
		try {
			return await route.handle(request, env);
		} catch (err) {
			console.error(`${route.label} unhandled error`, err);
			return route.onError(request);
		}
	},
} satisfies ExportedHandler<Env>;
