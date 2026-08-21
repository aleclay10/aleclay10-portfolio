// @ts-check

/**
 * Ship log — release velocity on this repo, read from the public GitHub API.
 *
 * Replaces the "GitHub activity strip" from the roadmap, which was scoped as a
 * contribution calendar. That was measured before building and rejected on the
 * data: the account shows 70 contributions across 20 active days in 365, because
 * the professional work is not on this account and Kowalski is not on GitHub. As
 * green squares that reads "barely writes code" — the opposite of the intent.
 * The same repo framed as shipping velocity is both accurate and strong.
 *
 * Unauthenticated on purpose. The host builds with no GitHub credential and
 * should keep it that way; a public repo needs none. The cost is a 60 req/hr
 * per-IP limit, which is why every caller must be able to fall back.
 */

export const REPO = 'aleclay10/aleclay10-portfolio';

const API = 'https://api.github.com';
// Bounded so a hung connection cannot stall a build. The whole point of this
// module is that it is never load-bearing.
const TIMEOUT_MS = 8000;

/** @param {string} path */
async function api(path) {
	const res = await fetch(`${API}${path}`, {
		headers: {
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'aleclay10.dev-build',
		},
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) {
		// Rate limiting is the expected failure and deserves to say so by name
		// rather than arriving as a bare 403.
		const remaining = res.headers.get('x-ratelimit-remaining');
		if (res.status === 403 && remaining === '0') {
			throw new Error(`GitHub rate limit exhausted (unauthenticated, 60/hr) on ${path}`);
		}
		throw new Error(`GitHub ${res.status} on ${path}`);
	}
	return res.json();
}

/**
 * @typedef {object} ShipLog
 * @property {string} repo
 * @property {number} mergedPrs
 * @property {number} releases
 * @property {string} since        ISO date of the first merged PR
 * @property {{ number: number, title: string, mergedAt: string }[]} recent
 * @property {string} refreshed    ISO date this snapshot was taken
 */

/**
 * Only the fields used. `res.json()` is `any`, so without this the callbacks
 * below trip noImplicitAny under `astro check`.
 * @typedef {{ number: number, title: string, merged_at: string | null }} GhPull
 */

/**
 * @returns {Promise<ShipLog>}
 */
export async function fetchShipLog() {
	// Ceiling: one page. At 26 closed PRs today this is fine, and `per_page` caps
	// at 100. Past that the count silently under-reports and this needs paging —
	// the same class of ceiling documented for the search index.
	const [closed, tags] = /** @type {[GhPull[], unknown[]]} */ (
		await Promise.all([
			api(`/repos/${REPO}/pulls?state=closed&per_page=100&sort=updated&direction=desc`),
			api(`/repos/${REPO}/tags?per_page=100`),
		])
	);

	const merged = closed
		.filter((pr) => pr.merged_at !== null)
		.sort((a, b) => (String(a.merged_at) < String(b.merged_at) ? 1 : -1));

	if (merged.length === 0) throw new Error('no merged PRs returned — refusing to publish an empty ship log');

	return {
		repo: REPO,
		mergedPrs: merged.length,
		releases: tags.length,
		since: String(merged[merged.length - 1].merged_at).slice(0, 10),
		recent: merged.slice(0, 4).map((pr) => ({
			number: pr.number,
			title: pr.title,
			mergedAt: String(pr.merged_at).slice(0, 10),
		})),
		refreshed: new Date().toISOString().slice(0, 10),
	};
}
