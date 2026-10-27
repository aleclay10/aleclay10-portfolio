/**
 * What only a script can add to the mascot (Mascot.astro): dragging, memory of
 * his spot, Escape and outside-click to close, a 30-day quiet after a send, a
 * "hide him for now" that lasts the tab, and the inline form result.
 *
 * Everything degrades to the plain <details>: no storage means he parks on the
 * right edge every time, a pointer that never moves four pixels is a click, and
 * the form still posts natively if the fetch cannot go out.
 */
import { enhanceFeedbackForm } from './feedback-form';

const QUIET_KEY = 'mascot-quiet-until'; // localStorage: ms timestamp
const POS_KEY = 'mascot-pos'; // localStorage: {"top": px, "side": "left" | "right"}
const HIDE_KEY = 'mascot-hidden'; // sessionStorage: "1"
const QUIET_DAYS = 30;
const DRAG_THRESHOLD = 4;
const EDGE_MARGIN = 8;
const IDLE_MS = 10_000;

type Side = 'left' | 'right';

function read(store: Storage, key: string): string | null {
	try {
		return store.getItem(key);
	} catch {
		return null;
	}
}

function write(store: Storage, key: string, value: string) {
	try {
		store.setItem(key, value);
	} catch {
		// Storage blocked or full: the behaviour still happens for this page view.
	}
}

function boot(root: HTMLDetailsElement) {
	const summary = root.querySelector<HTMLElement>('summary');
	const panel = root.querySelector<HTMLElement>('.mascot-panel');
	const form = root.querySelector<HTMLFormElement>('form[data-feedback-form]');
	if (!summary || !panel) return;

	// Quiet: he does not ask twice. Thirty days after a send, or the rest of the
	// tab after "hide him for now".
	const quietUntil = Number(read(localStorage, QUIET_KEY));
	if ((quietUntil && quietUntil > Date.now()) || read(sessionStorage, HIDE_KEY)) {
		root.hidden = true;
		return;
	}

	// Dragging is desktop only. Below sm he sits in a fixed corner (global.css):
	// a draggable thing on a phone fights scrolling and loses.
	const wide = matchMedia('(min-width: 640px)');

	function place(top: number, side: Side) {
		const max = innerHeight - summary!.offsetHeight - EDGE_MARGIN;
		const clamped = Math.min(Math.max(EDGE_MARGIN, top), Math.max(EDGE_MARGIN, max));
		root.style.top = `${clamped}px`;
		root.style.bottom = 'auto';
		root.dataset.side = side;
		// The panel grows away from whichever half of the viewport he is in, so it
		// never runs off the top when he is parked high.
		root.dataset.anchor = clamped + summary!.offsetHeight / 2 < innerHeight / 2 ? 'top' : 'bottom';
		return clamped;
	}

	function resetPlace() {
		root.style.top = '';
		root.style.bottom = '';
		root.dataset.side = 'right';
		root.dataset.anchor = 'bottom';
	}

	function restore() {
		if (!wide.matches) return;
		const raw = read(localStorage, POS_KEY);
		if (!raw) return;
		try {
			const saved = JSON.parse(raw) as { top?: unknown; side?: unknown };
			if (typeof saved.top === 'number' && (saved.side === 'left' || saved.side === 'right')) {
				place(saved.top, saved.side);
			}
		} catch {
			// A stale or hand-edited value. He parks in the default spot.
		}
	}

	restore();
	wide.addEventListener('change', () => (wide.matches ? restore() : resetPlace()));
	addEventListener('resize', () => {
		if (wide.matches && root.style.top) place(parseFloat(root.style.top), root.dataset.side as Side);
	});

	// Drag. Pointer capture on the summary keeps the move and up events coming
	// even when the pointer outruns him. A press that never travels four pixels
	// is a click and toggles the panel as normal; one that does suppresses the
	// click that follows the release, so a drop never also opens the form.
	let drag: { x: number; y: number; top: number; moved: boolean } | null = null;
	let swallowClick = false;

	summary.addEventListener('pointerdown', (e) => {
		if (!wide.matches || e.button !== 0) return;
		drag = { x: e.clientX, y: e.clientY, top: root.getBoundingClientRect().top, moved: false };
		summary.setPointerCapture(e.pointerId);
	});

	summary.addEventListener('pointermove', (e) => {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved) {
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			drag.moved = true;
			root.classList.add('is-dragging');
			root.open = false;
		}
		e.preventDefault();
		place(drag.top + dy, e.clientX < innerWidth / 2 ? 'left' : 'right');
	});

	const endDrag = () => {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		root.classList.remove('is-dragging');
		if (!moved) return;
		const top = place(root.getBoundingClientRect().top, root.dataset.side as Side);
		write(localStorage, POS_KEY, JSON.stringify({ top, side: root.dataset.side }));
		swallowClick = true;
		// The click lands in the same task as pointerup, if at all. Clear the flag
		// afterwards so a cancelled drag cannot eat the next genuine click.
		setTimeout(() => (swallowClick = false), 0);
	};
	summary.addEventListener('pointerup', endDrag);
	summary.addEventListener('pointercancel', endDrag);
	summary.addEventListener('click', (e) => {
		if (swallowClick) e.preventDefault();
	});

	// Open and close. Focus goes to the panel itself (tabindex=-1), not into the
	// name field: the next Tab reaches it, and nothing pops a keyboard on a phone
	// before the visitor has read the question.
	root.addEventListener('toggle', () => {
		if (root.open) {
			delete root.dataset.idle;
			panel.focus({ preventScroll: true });
		} else if (panel.contains(document.activeElement)) {
			summary.focus({ preventScroll: true });
		}
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && root.open) root.open = false;
	});

	document.addEventListener('pointerdown', (e) => {
		if (root.open && !root.contains(e.target as Node)) root.open = false;
	});

	root.querySelector('[data-mascot-close]')?.addEventListener('click', () => {
		root.open = false;
		summary.focus({ preventScroll: true });
	});

	root.querySelector('[data-mascot-hide]')?.addEventListener('click', () => {
		write(sessionStorage, HIDE_KEY, '1');
		root.hidden = true;
	});

	// Left alone for ten seconds, he dims so he stops competing with the page.
	// Hover, focus and open all override it in CSS; the attribute just arms it.
	setTimeout(() => {
		if (!root.open) root.dataset.idle = '';
	}, IDLE_MS);

	if (form) {
		enhanceFeedbackForm(form, {
			onSent() {
				write(localStorage, QUIET_KEY, String(Date.now() + QUIET_DAYS * 86_400_000));
				root.classList.add('is-bowing');
				setTimeout(() => root.classList.remove('is-bowing'), 900);
			},
		});
	}
}

const mascot = document.getElementById('mascot');
if (mascot instanceof HTMLDetailsElement) boot(mascot);
