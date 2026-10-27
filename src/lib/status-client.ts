// Shared client-side contract for /status.json - written on the host every five
// minutes by health-check.sh, never a build artifact, 404s in dev. One fetch
// plus one freshness guard, imported by every consumer (the home LiveStrip, the
// /kowalski trace, the /stack pipeline), so the rules can never drift.

export type Status = {
	status?: 'up' | 'down';
	checked?: string;
	uptime?: { '7d'?: number; '30d'?: number };
	since?: string | null;
	// Deployed release: the verified tag and the minute it went live.
	release?: { tag?: string; deployedAt?: string } | null;
};

// A status file that stopped being written (host asleep, launchd job unloaded)
// is treated as unknown rather than reported as fact: a stale "up" is worse
// than nothing.
export const STATUS_MAX_AGE_MS = 30 * 60 * 1000;

const TAG = /^v\d+\.\d+\.\d+$/;

/**
 * Fetch /status.json and return it only when fresh. Any failure - missing file
 * (expected in dev), HTTP error, malformed JSON, stale stamp - returns null so
 * callers keep their server-rendered baseline. `checkedAt` is the parsed stamp.
 */
export async function loadFreshStatus(): Promise<{ data: Status; checkedAt: number } | null> {
	try {
		const res = await fetch('/status.json', { cache: 'no-store' });
		if (!res.ok) return null;
		const data: Status = await res.json();
		const checkedAt = data.checked ? Date.parse(data.checked) : NaN;
		if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > STATUS_MAX_AGE_MS) return null;
		return { data, checkedAt };
	} catch (err) {
		// Offline, blocked, or bad JSON from the host. Named in the console; the
		// expected dev-time 404 returns earlier via !res.ok and never reaches this.
		console.debug('[status] feed unavailable:', err);
		return null;
	}
}

/** The deployed release, if the feed is fresh and the tag looks like one. */
export async function loadLiveRelease(): Promise<{ tag: string; deployedAt: Date | null } | null> {
	const fresh = await loadFreshStatus();
	const rel = fresh?.data.release;
	if (!rel || typeof rel.tag !== 'string' || !TAG.test(rel.tag)) return null;
	const t = typeof rel.deployedAt === 'string' ? Date.parse(rel.deployedAt) : NaN;
	return { tag: rel.tag, deployedAt: Number.isFinite(t) ? new Date(t) : null };
}

/** "Wed 8:41 PM" inside a week, "Oct 21" beyond it. Visitor's own zone. */
export function deployedWhen(d: Date) {
	const recent = Date.now() - d.getTime() < 7 * 86_400_000;
	return recent
		? `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
		: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
