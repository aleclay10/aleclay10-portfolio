/**
 * Progressive enhancement for the feedback form (FeedbackForm.astro), shared by
 * the mascot's panel and the /feedback page.
 *
 * The form works with no JavaScript at all: it is a native POST to /api/feedback,
 * and the Worker answers a no-JS submission with a 303 to /feedback/thanks/, or
 * back to /feedback/?e=<code> on a failure. Everything below only upgrades that to
 * an inline result with no page navigation. Same rules as the waitlist form's
 * script: every failure path falls back to the native submit, and the one thing
 * this must never do is swallow a submission.
 */

// Written just before handing a failed fetch back to the native form POST, read
// back when the Worker's error redirect lands on /feedback. sessionStorage
// because the draft should survive the round trip but not the tab.
const DRAFT_KEY = 'feedback-draft';
const FIELDS = ['name', 'email', 'rating', 'message'] as const;

// Must match the copy in the static #fb-err-* blocks on /feedback, which cover
// the same codes for no-JS visitors.
const failureMessages: Record<string, string> = {
	invalid: 'Something in that did not pass the checks. Look over the fields and try again.',
	rate: 'Too many in a row. Wait a minute, then try once more.',
	server: 'Something went wrong on my end. Nothing was saved. Try again in a moment.',
};

export type EnhanceOptions = {
	/** Read ?e=<code> from the URL and restore a stashed draft. Only /feedback. */
	arrival?: boolean;
	/** Runs once the Worker has accepted the submission. */
	onSent?: () => void;
};

function fieldOf(form: HTMLFormElement, name: string) {
	return form.elements.namedItem(name);
}

function valueOf(form: HTMLFormElement, name: string): string {
	const data = new FormData(form);
	return String(data.get(name) ?? '');
}

export function enhanceFeedbackForm(form: HTMLFormElement, options: EnhanceOptions = {}) {
	const button = form.querySelector<HTMLButtonElement>('[data-feedback-submit]');
	const message = form.querySelector<HTMLElement>('[data-feedback-message]');
	const announcer = form.parentElement?.querySelector<HTMLElement>('[data-feedback-announce]') ?? null;
	const buttonLabel = button?.textContent ?? 'Send it to Alec';

	function say(text: string, tone: 'error' | 'muted' = 'error') {
		if (!message) return;
		message.textContent = text;
		message.classList.toggle('text-accent', tone === 'error');
		message.classList.toggle('text-muted', tone === 'muted');
	}

	if (options.arrival) {
		const failureCode = new URLSearchParams(location.search).get('e');
		if (failureCode !== null) {
			say(failureMessages[failureCode] ?? 'Something in that did not go through. Give it another try?');
			document.getElementById(`fb-err-${failureCode}`)?.remove();
			try {
				const draft = sessionStorage.getItem(DRAFT_KEY);
				if (draft) {
					const values = JSON.parse(draft) as Partial<Record<string, string>>;
					for (const field of FIELDS) {
						const value = values[field];
						if (typeof value !== 'string') continue;
						const input = fieldOf(form, field);
						if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
							input.value = value;
						} else if (input instanceof RadioNodeList) {
							input.value = value;
						}
					}
					sessionStorage.removeItem(DRAFT_KEY);
				}
			} catch {
				// Storage unavailable (private mode, quota). The error message still
				// shows; only the repopulation is lost.
			}
			const url = new URL(location.href);
			url.searchParams.delete('e');
			history.replaceState(null, '', url.pathname + url.search + url.hash);
		}
	}

	form.addEventListener('submit', async (event) => {
		if (!form.reportValidity()) return;
		event.preventDefault();

		const payload = {
			name: valueOf(form, 'name'),
			email: valueOf(form, 'email'),
			rating: valueOf(form, 'rating'),
			message: valueOf(form, 'message'),
			page: valueOf(form, 'page'),
			favorite_fish: valueOf(form, 'favorite_fish'),
		};

		if (button) {
			button.disabled = true;
			button.textContent = 'Sending…';
		}
		say('Sending…', 'muted');

		let res: Response;
		try {
			res = await fetch(form.action, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
		} catch {
			// Offline, blocked, or the edge is unreachable. Hand the submission back to
			// the browser: a full-page POST may still succeed, and if it does not the
			// visitor gets the browser's own error rather than a silently dead button.
			// Stash the typed values first so the arrival handler can restore them if
			// the Worker bounces the native POST to /feedback. Never the honeypot field:
			// restoring that would trip the trap on the retry.
			try {
				sessionStorage.setItem(
					DRAFT_KEY,
					JSON.stringify({ name: payload.name, email: payload.email, rating: payload.rating, message: payload.message })
				);
			} catch {
				// Storage unavailable; the native POST still goes out.
			}
			form.submit();
			return;
		}

		if (button) {
			button.disabled = false;
			button.textContent = buttonLabel;
		}

		if (res.ok) {
			try {
				sessionStorage.removeItem(DRAFT_KEY);
			} catch {
				// Nothing stashed, or storage unavailable. Either way done.
			}
			const done = document.createElement('div');
			done.className = 'rounded-xl border border-accent p-5 focus:outline-none';
			// No role="status" here: a live region announces changes to content it
			// already had, so text arriving together with a brand-new node is read by
			// nothing. The pre-existing announcer does the announcing; moving focus
			// onto the card covers it a second way.
			done.tabIndex = -1;
			done.innerHTML =
				'<p class="font-mono t-caption uppercase tracking-[0.14em] text-accent">Filed</p>' +
				'<p class="mt-2 t-callout leading-relaxed text-body">' +
				'Alec reads every one of these himself. If he has a question, he will write back.</p>';
			form.replaceWith(done);
			if (announcer) announcer.textContent = 'Filed. Alec reads every one of these himself.';
			done.focus({ preventScroll: true });
			options.onSent?.();
			return;
		}

		let error = 'Something in that did not go through. Give it another try?';
		try {
			const body = (await res.json()) as { error?: string };
			if (typeof body.error === 'string' && body.error) error = body.error;
		} catch {
			// Not JSON (an edge error page, say). The generic line stands.
		}
		say(error);
	});
}
