// Shared client-side contract for /prices.json - the live quote feed a scheduled
// job writes on the host (same-origin, never a build artifact, 404s in dev).
// One fetch + freshness guard + formatter set, imported by every consumer
// (/investing page script, AllocationDonut, BookChip), so the freshness rules
// can never drift between surfaces.

export type Quote = { price?: number; changePct?: number; weight?: number };

export type Prices = {
	generated?: string;
	marketState?: string;
	portfolio?: { dayChangePct?: number };
	quotes?: Record<string, Quote>;
	vectors?: Record<string, number>;
};

// Prices go stale outside market hours; 6h is generous.
export const PRICES_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const nf = (n: number, dp = 2) =>
	n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

// U+2212 minus, not a hyphen: it matches the plus sign's width in tabular figures.
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${nf(Math.abs(n))}%`;

/**
 * Fetch /prices.json and return it only when fresh. Any failure - missing file
 * (expected in dev, same as /status.json), HTTP error, malformed JSON, stale
 * timestamp - returns null so callers keep their server-rendered baseline.
 */
export async function loadFreshPrices(): Promise<{ data: Prices; generatedAt: Date } | null> {
	try {
		const res = await fetch('/prices.json', { cache: 'no-store' });
		if (!res.ok) return null;
		const data: Prices = await res.json();
		const gen = data.generated ? Date.parse(data.generated) : NaN;
		if (!Number.isFinite(gen) || Date.now() - gen > PRICES_MAX_AGE_MS) return null;
		return { data, generatedAt: new Date(gen) };
	} catch {
		return null;
	}
}
