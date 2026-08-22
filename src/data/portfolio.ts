// Portfolio composition for /investing.
//
// ⚠️ THIS FILE IS IN A PUBLIC REPO. It must contain NO share counts, NO dollar
// values, and NO cost basis - only allocation percentages, which Alec has agreed
// to publish. Share counts live in ~/portfolio/holdings.json on the mini (mode
// 600, never committed); fetch-prices.mjs reads them there to compute live
// weights and publishes only percentages to www/prices.json.
//
// `weight` is a BASELINE snapshot used for the server-rendered chart and as the
// fallback when prices.json is missing or stale. When prices.json is fresh, the
// page recomputes weights from live prices so the chart does not drift.

export type VectorId = 'compute' | 'robotics' | 'space' | 'index' | 'crypto' | 'offthesis';

export type Vector = {
	id: VectorId;
	label: string;
	/** Categorical palette slot (1-indexed) - see validated palette in the page's <style>. */
	slot: number;
	/** The thesis in one line. This is the "why" the page exists to show. */
	thesis: string;
};

// Order is fixed and meaningful: conviction vectors first by size, then the
// index core, then crypto, then the book's own failures last. Do not reorder to
// make it look tidier - palette slots are assigned by this order and the slot
// ordering is the CVD-safety mechanism.
export const vectors: Vector[] = [
	{
		id: 'compute',
		label: 'Compute',
		slot: 1,
		thesis:
			'Compute scaling drives the next decade. Own the silicon, the power that feeds it, the infrastructure it runs on, and the defence software built atop it, not just one layer.',
	},
	{
		id: 'robotics',
		label: 'Robotics',
		slot: 2,
		thesis:
			'General-purpose humanoid robotics is the largest unpriced market in the book. A decade-long bet, tracked against shipping checkpoints rather than share price.',
	},
	{
		id: 'index',
		label: 'Index core',
		slot: 3,
		thesis:
			'Broad-market and dividend index exposure. Deliberately boring: it is the counterweight that lets the rest of the book be concentrated.',
	},
	{
		id: 'space',
		label: 'Space',
		slot: 4,
		thesis:
			'Launch cadence and orbital infrastructure are becoming utilities. Bought on cadence and backlog, held through a brutal post-IPO unwind.',
	},
	{
		id: 'crypto',
		label: 'Crypto',
		slot: 5,
		thesis:
			'A deliberately small, uncorrelated tail position. Sized so it cannot matter much either way.',
	},
	{
		id: 'offthesis',
		label: 'Off-thesis · exiting',
		slot: 6,
		thesis:
			'Positions that map to no vector. Flagged for exit by the framework and still held: the gap between analysis and execution, left visible on purpose.',
	},
];

export type Holding = {
	ticker: string;
	name: string;
	vector: VectorId;
	/** % of the brokerage + crypto book. Baseline snapshot - see note above. */
	weight: number;
	kind: 'stock' | 'etf' | 'crypto';
	/** Optional one-line note shown in the table. Reasoning, not performance. */
	note?: string;
};

// Baseline as of 2026-07-29 brokerage marks. Excludes $6 of uninvested brokerage
// cash and everything outside the taxable book (retirement, savings) - the page
// is explicitly scoped to brokerage + crypto.
export const holdings: Holding[] = [
	{ ticker: 'NVDA', name: 'NVIDIA', vector: 'compute', weight: 15.88, kind: 'stock', note: 'The compute layer itself. Largest position.' },
	{ ticker: 'TSLA', name: 'Tesla', vector: 'robotics', weight: 14.15, kind: 'stock', note: 'Held for Optimus, not cars. Checkpoint missed in 2026; under review, not sold.' },
	{ ticker: 'CRM', name: 'Salesforce', vector: 'offthesis', weight: 11.09, kind: 'stock', note: 'Exit decided. Correlated with my salary and RSUs: the same seat-based SaaS bet three times.' },
	{ ticker: 'VTI', name: 'Vanguard Total Stock Market', vector: 'index', weight: 8.61, kind: 'etf' },
	{ ticker: 'SPCX', name: 'SpaceX', vector: 'space', weight: 7.38, kind: 'stock', note: 'Bought post-IPO on launch cadence. Down hard; thesis unchanged.' },
	{ ticker: 'CEG', name: 'Constellation Energy', vector: 'compute', weight: 6.16, kind: 'stock', note: 'The power behind the datacentre. Compute is an energy trade.' },
	{ ticker: 'COHR', name: 'Coherent', vector: 'compute', weight: 5.25, kind: 'stock', note: 'Optical interconnect, the plumbing between accelerators.' },
	{ ticker: 'PLTR', name: 'Palantir', vector: 'compute', weight: 5.08, kind: 'stock', note: 'Defence and enterprise AI deployment layer.' },
	{ ticker: 'VXUS', name: 'Vanguard Total International', vector: 'index', weight: 4.43, kind: 'etf' },
	{ ticker: 'BTC', name: 'Bitcoin', vector: 'crypto', weight: 4.37, kind: 'crypto' },
	{ ticker: 'RKLB', name: 'Rocket Lab', vector: 'space', weight: 4.15, kind: 'stock', note: 'Re-underwriting the Iridium acquisition: a capital-allocation question, not a price one.' },
	{ ticker: 'NFLX', name: 'Netflix', vector: 'offthesis', weight: 3.47, kind: 'stock', note: 'Flagged off-thesis since June. Still held. That is the point of showing this slice.' },
	{ ticker: 'NBIS', name: 'Nebius Group', vector: 'compute', weight: 2.63, kind: 'stock', note: 'Neoclouds: compute capacity as a rentable utility.' },
	{ ticker: 'AMD', name: 'AMD', vector: 'compute', weight: 2.54, kind: 'stock', note: 'Best call in the book by percentage. Also still a token-sized position, which the framework calls dabbling.' },
	{ ticker: 'GOOGL', name: 'Alphabet', vector: 'compute', weight: 1.99, kind: 'stock', note: 'Integrated model, silicon, and distribution.' },
	{ ticker: 'SCHD', name: 'Schwab US Dividend Equity', vector: 'index', weight: 1.41, kind: 'etf' },
	{ ticker: 'USAR', name: 'USA Rare Earth', vector: 'offthesis', weight: 0.94, kind: 'stock', note: 'Flagged for exit for ten weeks. Worst performer in the book.' },
	{ ticker: 'XRP', name: 'XRP', vector: 'crypto', weight: 0.41, kind: 'crypto' },
	{ ticker: 'DOGE', name: 'Dogecoin', vector: 'crypto', weight: 0.07, kind: 'crypto' },
];

// Watch-only names: tracked, no position. Seeded empty - the watchlist currently
// shows the held book, which is where Alec asked to start. Add entries here as
// genuine watch-only ideas appear and they will render alongside the held names
// with a "watching" marker instead of "held". Anything added here must ALSO be
// listed in the `watchlist` array of ~/portfolio/holdings.json so the price job
// fetches a quote for it.
export const watching: { ticker: string; name: string; why?: string }[] = [];

/**
 * Everything on the radar - held positions plus watch-only names.
 * Rendered as a compact price grid, deliberately distinct from the positions
 * table (which carries weights, vectors and reasoning).
 */
export function watchlist(): { ticker: string; name: string; held: boolean; why?: string }[] {
	return [
		...holdings.map((h) => ({ ticker: h.ticker, name: h.name, held: true })),
		...watching.map((w) => ({ ...w, held: false })),
	];
}

/** Vector totals from the per-asset baseline - one source of truth. */
export function vectorWeights(source: { ticker: string; weight: number }[] = holdings) {
	return vectors.map((v) => ({
		...v,
		weight: source
			.filter((h) => holdings.find((x) => x.ticker === h.ticker)?.vector === v.id)
			.reduce((sum, h) => sum + h.weight, 0),
	}));
}

/** Principles shown alongside the chart - the philosophy, stated plainly. */
export const principles: { rule: string; detail: string }[] = [
	{
		rule: 'Pick a vector, not fifteen stories',
		detail:
			'"I like tech" is not a thesis. A vector names what has to be true for the whole group to work, and it governs every add and every exit.',
	},
	{
		rule: 'Concentration is the strategy, not an accident',
		detail:
			'The indexed retirement account is the safety bucket. That is what earns this book the right to be concentrated: it is one half of a barbell, not an unbalanced portfolio.',
	},
	{
		rule: 'Sell on a broken thesis, never on a red number',
		detail:
			'Price moves are not information. A missed shipping checkpoint, a change in capital allocation, or a correlation I did not notice: those are information.',
	},
	{
		rule: 'Ten years, and I mean it',
		detail:
			'This book has been down more than 8% on cost with zero trades executed during the drawdown. Not selling into fear is the hardest part of the plan and the only part that cannot be faked.',
	},
	{
		rule: 'Watch what kills the thesis, not the ticker',
		detail:
			'Structural risks (capex pauses, GPU oversupply, regulatory hits to defence AI) get tracked. Daily volatility does not.',
	},
	{
		rule: 'Correlation hides in your paycheque',
		detail:
			'My salary and RSUs are both enterprise SaaS. Holding a third bet on the same thing was concentration I had not counted, which is why it is being exited.',
	},
];
