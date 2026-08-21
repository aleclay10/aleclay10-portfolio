/**
 * Early-access waitlist endpoint for the AI Gaming Assistant.
 *
 * Runs at the Cloudflare edge on `aleclay10.dev/api/waitlist*`, so a public write
 * endpoint and a table of real people's names and email addresses never touch the
 * Mac mini — the host that also holds Google OAuth tokens, a GitHub PAT, the tunnel
 * credentials and holdings.json.
 *
 * Same-origin with the site by design. That is what lets the browser `fetch` satisfy
 * the production CSP (`default-src 'self'`) with no `connect-src` amendment. A
 * `waitlist.aleclay10.dev` subdomain would have required loosening the policy.
 *
 * Accepts two content types off one code path:
 *   application/x-www-form-urlencoded  the native <form> POST, i.e. the no-JS path
 *   application/json                   the progressively-enhanced path
 * They differ only in how the result is returned: a 303 redirect vs. a JSON body.
 */

export interface Env {
	DB: D1Database;
}

// Both hostnames serve the site: cloudflared routes aleclay10.dev AND
// www.aleclay10.dev to the same origin, and www does NOT redirect to the apex — it
// answers 200 with its own Origin. Checking only the apex would 403 every visitor
// who arrived via www. (The canonical tag points at the apex, which is an SEO
// signal, not a redirect.)
const SITE_ORIGINS = new Set(['https://aleclay10.dev', 'https://www.aleclay10.dev']);
// Host-relative on purpose: a submission from www stays on www.
const THANKS_PATH = '/gaming-assistant/thanks';
const RETRY_PATH = '/gaming-assistant?e=1#waitlist';

const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_NOTES = 2000;

/**
 * Bots fill in every field they can see. This one is visually hidden and labelled
 * as "leave this empty" for anything reading the DOM semantically; a non-empty
 * value means the submission is automated.
 */
const HONEYPOT_FIELD = 'company';

type Submission = {
	first_name: string;
	last_name: string;
	email: string;
	notes: string | null;
};

/**
 * Deliberately not an RFC 5322 parser — those either reject deliverable addresses
 * or accept nonsense. Cheap structural checks only; the confirmation email is what
 * will actually prove an address exists, once that phase ships.
 */
function isPlausibleEmail(value: string): boolean {
	if (value.length < 3 || value.length > MAX_EMAIL) return false;
	if (/[\s<>,;"\\]/.test(value)) return false;
	const parts = value.split('@');
	if (parts.length !== 2) return false;
	const [local, domain] = parts;
	if (!local || !domain) return false;
	if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
	if (domain.includes('..')) return false;
	return true;
}

/**
 * Strip C0/C7 control characters. These have no business in a name and would
 * otherwise ride along into an email header the moment the sending phase lands.
 */
function clean(value: unknown): string {
	if (typeof value !== 'string') return '';
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function validate(raw: Record<string, unknown>): { ok: true; data: Submission } | { ok: false; error: string } {
	const first_name = clean(raw.first_name);
	const last_name = clean(raw.last_name);
	const email = clean(raw.email).toLowerCase();
	const notes = clean(raw.notes);

	if (!first_name) return { ok: false, error: 'A first name is required.' };
	if (first_name.length > MAX_NAME) return { ok: false, error: `First name is limited to ${MAX_NAME} characters.` };
	if (!last_name) return { ok: false, error: 'A last name is required.' };
	if (last_name.length > MAX_NAME) return { ok: false, error: `Last name is limited to ${MAX_NAME} characters.` };
	if (!isPlausibleEmail(email)) return { ok: false, error: 'That email address does not look right.' };
	if (notes.length > MAX_NOTES) return { ok: false, error: `Notes are limited to ${MAX_NOTES} characters.` };

	return { ok: true, data: { first_name, last_name, email, notes: notes || null } };
}

async function readBody(request: Request): Promise<{ raw: Record<string, unknown>; isJson: boolean } | null> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		try {
			const parsed = await request.json();
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			return { raw: parsed as Record<string, unknown>, isJson: true };
		} catch {
			return null;
		}
	}

	if (
		contentType.includes('application/x-www-form-urlencoded') ||
		contentType.includes('multipart/form-data')
	) {
		try {
			const form = await request.formData();
			const raw: Record<string, unknown> = {};
			for (const [key, value] of form.entries()) raw[key] = value;
			return { raw, isJson: false };
		} catch {
			return null;
		}
	}

	return null;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});

const redirect = (path: string) =>
	new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname !== '/api/waitlist') {
			return json({ error: 'Not found.' }, 404);
		}

		if (request.method !== 'POST') {
			return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
				status: 405,
				headers: {
					'content-type': 'application/json; charset=utf-8',
					allow: 'POST',
					'cache-control': 'no-store',
				},
			});
		}

		// Modern browsers send Origin on every POST, including a plain form submit,
		// so this costs the no-JS path nothing and drops most drive-by scripted noise.
		const origin = request.headers.get('origin');
		if (!origin || !SITE_ORIGINS.has(origin)) {
			return json({ error: 'Forbidden.' }, 403);
		}

		const body = await readBody(request);
		if (!body) return json({ error: 'Malformed request.' }, 400);
		const { raw, isJson } = body;

		// Honeypot: report success, write nothing. A bot that can tell it was caught
		// is a bot that can be tuned against the filter.
		if (clean(raw[HONEYPOT_FIELD])) {
			return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
		}

		const result = validate(raw);
		if (!result.ok) {
			return isJson ? json({ error: result.error }, 400) : redirect(RETRY_PATH);
		}
		const { first_name, last_name, email, notes } = result.data;

		const country =
			(request as Request & { cf?: { country?: string } }).cf?.country ?? null;

		try {
			// Re-submitting an address updates the row instead of erroring. Crucially the
			// response is byte-identical whether the address was new or already present:
			// a different answer for a known address is an email-enumeration oracle, and
			// matching them costs nothing.
			//
			// created_at, status and unsubscribe_token are deliberately NOT touched on
			// conflict — someone who already unsubscribed must not be revived by
			// resubmitting the form, and the original signup time is the useful one.
			await env.DB.prepare(
				`INSERT INTO waitlist (email, first_name, last_name, notes, unsubscribe_token, source, country)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
				 ON CONFLICT(email) DO UPDATE SET
				   first_name = excluded.first_name,
				   last_name  = excluded.last_name,
				   notes      = COALESCE(excluded.notes, waitlist.notes)`
			)
				.bind(email, first_name, last_name, notes, crypto.randomUUID(), 'gaming-assistant', country)
				.run();
		} catch (err) {
			console.error('waitlist insert failed', err);
			return isJson
				? json({ error: 'Something went wrong on my end. Try again in a moment.' }, 500)
				: redirect(RETRY_PATH);
		}

		return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
	},
} satisfies ExportedHandler<Env>;
