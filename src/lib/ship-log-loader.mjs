// @ts-check

/**
 * One ship-log fetch per build, shared by every consumer (ShipLog on /stack,
 * LiveStrip and PrReceipt on the home page). Memoised at module level: Astro
 * renders every page in one process, so the promise is created once and the
 * unauthenticated 60/hr GitHub budget is spent once, not once per page.
 *
 * Never throws. The committed snapshot in src/data/ship-log.json is the
 * fallback, and the failure is logged by name rather than swallowed - a bare
 * catch is what kept the Pagefind outage invisible for weeks.
 */

import cached from '../data/ship-log.json' with { type: 'json' };
import { fetchShipLog } from './ship-log.mjs';

/** @typedef {import('./ship-log.mjs').ShipLog} ShipLog */

/** @type {Promise<{ log: ShipLog, stale: boolean }> | null} */
let pending = null;

/** @returns {Promise<{ log: ShipLog, stale: boolean }>} */
export function loadShipLog() {
	if (!pending) {
		pending = fetchShipLog()
			.then((log) => ({ log, stale: false }))
			.catch((err) => {
				console.warn(
					`[ship-log] live fetch failed (${err instanceof Error ? err.message : err}) - using committed snapshot from ${cached.refreshed}`
				);
				return { log: /** @type {ShipLog} */ (cached), stale: true };
			});
	}
	return pending;
}
