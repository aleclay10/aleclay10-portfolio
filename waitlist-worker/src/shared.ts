/**
 * Pieces both endpoints share: the origin allow-list, body parsing for the two
 * content types, the response helpers, and the cleaning/validation primitives.
 *
 * Everything here used to live inline in the waitlist handler. It moved when the
 * feedback endpoint arrived so the two could not drift: a fix to how a form body
 * is read, or to which origins are allowed, must land on both at once.
 */

export interface Env {
	DB: D1Database;
	WAITLIST_LIMITER: RateLimit;
	FEEDBACK_LIMITER: RateLimit;
}

// Both hostnames serve the site: cloudflared routes aleclay10.dev AND
// www.aleclay10.dev to the same origin, and www does NOT redirect to the apex — it
// answers 200 with its own Origin. Checking only the apex would 403 every visitor
// who arrived via www. (The canonical tag points at the apex, which is an SEO
// signal, not a redirect.)
export const SITE_ORIGINS = new Set(['https://aleclay10.dev', 'https://www.aleclay10.dev']);

export const MAX_EMAIL = 254;

/**
 * Deliberately not an RFC 5322 parser — those either reject deliverable addresses
 * or accept nonsense. Cheap structural checks only; the confirmation email is what
 * will actually prove an address exists, once that phase ships.
 */
export function isPlausibleEmail(value: string): boolean {
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
 * Newlines are kept for multi-line fields; callers that want a single line pass
 * `singleLine`.
 */
export function clean(value: unknown, opts: { singleLine?: boolean } = {}): string {
	if (typeof value !== 'string') return '';
	const pattern = opts.singleLine === false
		? // eslint-disable-next-line no-control-regex
			/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
		: // eslint-disable-next-line no-control-regex
			/[\u0000-\u001f\u007f]/g;
	return value.replace(pattern, ' ').trim();
}

export function wantsJson(request: Request): boolean {
	return (request.headers.get('content-type') ?? '').includes('application/json');
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		try {
			const parsed = await request.json();
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			return parsed as Record<string, unknown>;
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
			return raw;
		} catch {
			return null;
		}
	}

	return null;
}

export const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});

export const redirect = (path: string) =>
	new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });

export const methodNotAllowed = () =>
	new Response(JSON.stringify({ error: 'Method not allowed.' }), {
		status: 405,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			allow: 'POST',
			'cache-control': 'no-store',
		},
	});

/** Modern browsers send Origin on every POST, including a plain form submit,
 *  so this costs the no-JS path nothing and drops most drive-by scripted noise. */
export function originAllowed(request: Request): boolean {
	const origin = request.headers.get('origin');
	return !!origin && SITE_ORIGINS.has(origin);
}

/**
 * Rate limit before reading the body: a request that is going to be rejected
 * should not get to allocate anything. Keyed on the client IP, which at the
 * edge is CF-Connecting-IP; a missing header falls back to a shared bucket
 * rather than to no limit at all.
 *
 * The limiter is its own service and can fail independently of this Worker.
 * That failure must not take the form down: the limiter is an abuse control,
 * not a security boundary, and a real visitor losing their submission to an
 * internal Cloudflare blip is the worse outcome. Fail open, but say so -
 * a run of these lines in `wrangler tail` means submissions are currently
 * unthrottled, which is worth knowing.
 */
export async function isRateLimited(limiter: RateLimit, request: Request, label: string): Promise<boolean> {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	try {
		const { success } = await limiter.limit({ key: ip });
		return !success;
	} catch (err) {
		console.error(`${label} rate limiter unavailable - failing open`, err);
		return false;
	}
}

export function countryOf(request: Request): string | null {
	return (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
}
