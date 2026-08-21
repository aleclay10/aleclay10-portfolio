import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fetchShipLog } from '../src/lib/ship-log.mjs';

/**
 * Refreshes the committed ship-log snapshot at src/data/ship-log.json.
 *
 * That file is the fallback /stack renders when the build-time fetch fails
 * (GitHub down, or the unauthenticated 60/hr limit exhausted). It is only a
 * useful fallback if it does not rot, so run this alongside `npm run og` when
 * prepping a release.
 *
 *   npm run ship-log
 */

const OUT = path.resolve(process.cwd(), 'src/data/ship-log.json');

try {
	const log = await fetchShipLog();
	await writeFile(OUT, `${JSON.stringify(log, null, '\t')}\n`, 'utf8');
	console.log(
		`[ship-log] ${log.mergedPrs} merged PRs · ${log.releases} releases · since ${log.since} → src/data/ship-log.json`
	);
} catch (err) {
	// Hard-fail here, unlike at build time: this script exists to refresh the
	// snapshot, so silently leaving a stale one would defeat the point.
	console.error(`[ship-log] refresh failed: ${err.message}`);
	process.exit(1);
}
