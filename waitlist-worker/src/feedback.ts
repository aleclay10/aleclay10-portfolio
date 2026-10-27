/**
 * Site feedback endpoint behind the Kowalski mascot: `POST /api/feedback`.
 *
 * The mascot's panel and the `/feedback/` page post the same form here. Same two
 * content types as the waitlist: a native form POST gets a 303 (to the thanks
 * page, or back to `/feedback/` with a failure class), JSON gets a JSON body.
 *
 * Every submission is its own row. There is no upsert: two tips from one person
 * are two tips, and nothing here is a list anyone gets emailed from.
 */

import {
	clean,
	countryOf,
	isPlausibleEmail,
	isRateLimited,
	json,
	readBody,
	redirect,
	wantsJson,
	type Env,
} from './shared';

// Host-relative on purpose: a submission from www stays on www.
const THANKS_PATH = '/feedback/thanks/';

// Same shape as the waitlist's: the page reveals the matching #fb-err-* block
// with CSS :target for a no-JS visitor and reads ?e= for the enhanced one.
type FailureCode = 'invalid' | 'rate' | 'server';
const retryPath = (code: FailureCode) => `/feedback/?e=${code}#fb-err-${code}`;

const MAX_NAME = 80;
const MAX_MESSAGE = 2000;
const MAX_PAGE = 200;

/**
 * Honeypot. `favorite_fish` is in no browser's autofill vocabulary, which is the
 * one property the field name must have (see the waitlist's `company` incident).
 */
const HONEYPOT_FIELDS = ['favorite_fish'];

type Submission = {
	name: string;
	email: string;
	rating: number | null;
	message: string;
	page: string | null;
};

/**
 * The page the visitor was on, sent by the form so a tip like "this chart is
 * unreadable" can be matched to a chart. Stored only when it is a plain
 * site-relative path: one leading slash, no scheme, no host, nothing that
 * could be mistaken for a URL anywhere this value is later rendered.
 */
function cleanPage(value: unknown): string | null {
	const page = clean(value);
	if (!page || page.length > MAX_PAGE) return null;
	if (!/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(page)) return null;
	return page;
}

function cleanRating(value: unknown): number | null | false {
	const text = clean(value);
	if (!text) return null;
	if (!/^[1-5]$/.test(text)) return false;
	return Number(text);
}

function validate(raw: Record<string, unknown>): { ok: true; data: Submission } | { ok: false; error: string } {
	const name = clean(raw.name);
	const email = clean(raw.email).toLowerCase();
	const message = clean(raw.message, { singleLine: false });
	const rating = cleanRating(raw.rating);
	const page = cleanPage(raw.page);

	if (!name) return { ok: false, error: 'A name is required.' };
	if (name.length > MAX_NAME) return { ok: false, error: `Name is limited to ${MAX_NAME} characters.` };
	if (!isPlausibleEmail(email)) return { ok: false, error: 'That email address does not look right.' };
	if (rating === false) return { ok: false, error: 'The rating has to be 1 to 5.' };
	if (!message) return { ok: false, error: 'The message is the point. It cannot be empty.' };
	if (message.length > MAX_MESSAGE) return { ok: false, error: `Messages are limited to ${MAX_MESSAGE} characters.` };

	return { ok: true, data: { name, email, rating, message, page } };
}

/** What the router answers when this handler throws something it did not expect. */
export function feedbackServerFailure(request: Request): Response {
	return wantsJson(request)
		? json({ error: 'Something went wrong on my end. Try again in a moment.' }, 500)
		: redirect(retryPath('server'));
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
	const isJson = wantsJson(request);

	if (await isRateLimited(env.FEEDBACK_LIMITER, request, 'feedback')) {
		return isJson
			? json({ error: 'That is a few too many in a row. Give it a minute.' }, 429)
			: redirect(retryPath('rate'));
	}

	const raw = await readBody(request);
	if (!raw) {
		return isJson ? json({ error: 'Malformed request.' }, 400) : redirect(retryPath('invalid'));
	}

	// Honeypot: report success, write nothing, log a PII-free line for
	// `wrangler tail`. Same reasoning as the waitlist's.
	if (HONEYPOT_FIELDS.some((field) => clean(raw[field]))) {
		console.warn('feedback honeypot tripped');
		return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
	}

	const result = validate(raw);
	if (!result.ok) {
		return isJson ? json({ error: result.error }, 400) : redirect(retryPath('invalid'));
	}
	const { name, email, rating, message, page } = result.data;

	try {
		await env.DB.prepare(
			`INSERT INTO feedback (name, email, rating, message, page, country)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
		)
			.bind(name, email, rating, message, page, countryOf(request))
			.run();
	} catch (err) {
		console.error('feedback insert failed', err);
		return feedbackServerFailure(request);
	}

	return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
}
