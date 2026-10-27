/**
 * Early-access waitlist endpoint for the AI Gaming Assistant: `POST /api/waitlist`.
 *
 * Accepts two content types off one code path:
 *   application/x-www-form-urlencoded  the native <form> POST, i.e. the no-JS path
 *   application/json                   the progressively-enhanced path
 * They differ only in how the result is returned: a 303 redirect vs. a JSON body.
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
const THANKS_PATH = '/gaming-assistant/thanks';

/**
 * Each failure class gets its own redirect. The query param is what the page
 * script reads; the fragment targets a hidden per-class message block that the
 * page reveals with CSS `:target`, so a no-JS visitor still sees the right
 * message. Collapsing these into one code is what the Pagefind outage taught
 * this repo never to do: failure states are never merged into one message.
 */
type FailureCode = 'invalid' | 'rate' | 'server';
const retryPath = (code: FailureCode) => `/gaming-assistant?e=${code}#w-err-${code}`;

const MAX_NAME = 80;
const MAX_NOTES = 2000;

/**
 * Bots fill in every field they can see. This one is visually hidden and labelled
 * as "leave this empty" for anything reading the DOM semantically; a non-empty
 * value means the submission is automated.
 *
 * `gamer_tag` is the current field name. It was renamed from `company` because
 * "company" is in Chrome's autofill heuristics (organization), and Chrome ignores
 * autocomplete="off": a real visitor's autofill could trip the trap and silently
 * lose their signup. `company` stays accepted until the site release after the
 * rename is live everywhere, because the Worker deploys instantly while the page
 * waits on a signed tag; drop it then.
 */
const HONEYPOT_FIELDS = ['gamer_tag', 'company'];

type Submission = {
	first_name: string;
	last_name: string;
	email: string;
	notes: string | null;
};

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

/** What the router answers when this handler throws something it did not expect. */
export function waitlistServerFailure(request: Request): Response {
	return wantsJson(request)
		? json({ error: 'Something went wrong on my end. Try again in a moment.' }, 500)
		: redirect(retryPath('server'));
}

export async function handleWaitlist(request: Request, env: Env): Promise<Response> {
	const isJson = wantsJson(request);

	if (await isRateLimited(env.WAITLIST_LIMITER, request, 'waitlist')) {
		return isJson
			? json({ error: 'That is a few too many tries in a row. Give it a minute.' }, 429)
			: redirect(retryPath('rate'));
	}

	const raw = await readBody(request);
	// A no-JS browser must never be shown raw JSON; essentially unreachable via
	// the real form, but a hand-built POST should still land somewhere styled.
	if (!raw) {
		return isJson ? json({ error: 'Malformed request.' }, 400) : redirect(retryPath('invalid'));
	}

	// Honeypot: report success, write nothing. A bot that can tell it was caught
	// is a bot that can be tuned against the filter. The log line carries no PII;
	// it exists so `wrangler tail` can measure how often the trap fires, because
	// a false positive here is silent data loss behind a success message.
	if (HONEYPOT_FIELDS.some((field) => clean(raw[field]))) {
		console.warn('waitlist honeypot tripped');
		return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
	}

	const result = validate(raw);
	if (!result.ok) {
		return isJson ? json({ error: result.error }, 400) : redirect(retryPath('invalid'));
	}
	const { first_name, last_name, email, notes } = result.data;

	try {
		// Re-submitting an address updates the row instead of erroring. Crucially the
		// response is byte-identical whether the address was new or already present:
		// a different answer for a known address is an email-enumeration oracle, and
		// matching them costs nothing.
		//
		// created_at, status and unsubscribe_token are deliberately NOT touched on
		// conflict — someone who already unsubscribed must not be revived by
		// resubmitting the form, and the original signup time is the useful one.
		//
		// COALESCE on notes means resubmitting with the field blank keeps the old
		// notes rather than clearing them. Deliberate: a plain form cannot tell
		// "left blank" apart from "wants it erased", and wiping notes on every
		// casual resubmit is the worse failure. Consequence: notes can be replaced
		// but never cleared via the form. Documented in the README.
		await env.DB.prepare(
			`INSERT INTO waitlist (email, first_name, last_name, notes, unsubscribe_token, source, country)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT(email) DO UPDATE SET
			   first_name = excluded.first_name,
			   last_name  = excluded.last_name,
			   notes      = COALESCE(excluded.notes, waitlist.notes)`
		)
			.bind(email, first_name, last_name, notes, crypto.randomUUID(), 'gaming-assistant', countryOf(request))
			.run();
	} catch (err) {
		console.error('waitlist insert failed', err);
		return waitlistServerFailure(request);
	}

	return isJson ? json({ ok: true }) : redirect(THANKS_PATH);
}
