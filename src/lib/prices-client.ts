// Shared client-side contract for /prices.json - the live quote feed a scheduled
// job writes on the host (same-origin, never a build artifact, 404s in dev).
// One fetch + freshness guard + formatter set, imported by every consumer
// (/investing page script, AllocationDonut, BookChip), so the freshness rules
// can never drift between surfaces.

export type Quote = { price?: number; changePct?: number; weight?: number };

export type Prices = {
	generated?: string;
	// When the equity closes were last fetched live. The host job stamps this so
	// a file it merely re-copied after hours still dates the closes correctly.
	equitiesAsOf?: string;
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

// The session a close belongs to, named in exchange time. A 16:00 ET close is
// already the next calendar day in Asia, so the visitor's zone must not decide
// the date. 'long' reads "Wed, Sep 2"; 'short' is "Sep 2" for narrow chips.
export const closeDay = (d: Date, style: 'long' | 'short' = 'long') =>
	d.toLocaleDateString(undefined, {
		timeZone: 'America/New_York',
		...(style === 'long' ? { weekday: 'short' } : {}),
		month: 'short',
		day: 'numeric',
	});

/**
 * Fetch /prices.json and return it only when fresh. Any failure - missing file
 * (expected in dev, same as /status.json), HTTP error, malformed JSON, stale
 * timestamp - returns null so callers keep their server-rendered baseline.
 */
export async function loadFreshPrices(): Promise<{
	data: Prices;
	generatedAt: Date;
	// Null when the feed predates the stamp or carries no equities; callers fall
	// back to the older "last close" wording rather than inventing a date.
	closesAt: Date | null;
} | null> {
	try {
		const res = await fetch('/prices.json', { cache: 'no-store' });
		if (!res.ok) return null;
		const data: Prices = await res.json();
		const gen = data.generated ? Date.parse(data.generated) : NaN;
		if (!Number.isFinite(gen) || Date.now() - gen > PRICES_MAX_AGE_MS) return null;
		const closes = data.equitiesAsOf ? Date.parse(data.equitiesAsOf) : NaN;
		return { data, generatedAt: new Date(gen), closesAt: Number.isFinite(closes) ? new Date(closes) : null };
	} catch {
		return null;
	}
}
