// @ts-check

/**
 * The release this build belongs to, read from git at build time.
 *
 * On the host the deploy is a detached checkout of the signed tag, so
 * `git describe --tags --abbrev=0` is that exact tag and the newest merge
 * commit is the pull request that shipped the page being built. Locally on a
 * branch the same calls return the nearest tag and the last merge below it,
 * which is the honest answer for a preview. Both are static baselines: the
 * home page's live strip replaces the tag with whatever status.json reports
 * once the page is open.
 *
 * Never throws. A checkout with no git (a tarball, say) renders the page
 * without a tag rather than failing the build and freezing the live site.
 */

import { execSync } from 'node:child_process';

/** @param {string} cmd */
function git(cmd) {
	try {
		return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
	} catch {
		return '';
	}
}

/**
 * @returns {{ tag: string | null, prNumber: number | null }}
 */
export function currentRelease() {
	const tag = git('describe --tags --abbrev=0');
	// "Merge pull request #57 from aleclay10/design/hig-low-findings"
	const merge = git('log --merges -1 --format=%s');
	const m = /^Merge pull request #(\d+)\b/.exec(merge);
	return {
		tag: /^v\d+\.\d+\.\d+$/.test(tag) ? tag : null,
		prNumber: m ? Number(m[1]) : null,
	};
}
