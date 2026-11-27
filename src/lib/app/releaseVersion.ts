/**
 * Human-facing app version, shown on the Node Dashboard mode chip.
 *
 * `release.json` at the repo root holds an integer counter. The
 * "Bump release version" workflow adds 1 on every push to main (each merged
 * PR), and the build bakes the counter in as __APP_RELEASE__. It is shown in
 * thousandths: release 1 is v0.001, release 1000 is v1.000.
 *
 * Peers also swap this number in `app-release` packets (./p2p/appVersion.ts)
 * to tell which of them is behind; the host's version.json confirms it.
 */

import type { ReleaseStamp } from '../p2p/appVersion';

declare const __APP_RELEASE__: number | undefined;

export function formatReleaseVersion(release: number): string {
  if (!Number.isSafeInteger(release) || release < 0) return '0.000';
  return (release / 1000).toFixed(3);
}

export const APP_RELEASE: number = (() => {
  try {
    if (typeof __APP_RELEASE__ === 'number') return __APP_RELEASE__;
  } catch { /* not defined (tests) */ }
  return 0;
})();

export const APP_VERSION = formatReleaseVersion(APP_RELEASE);

/** The confirmed-update sentence shared by the Brain line and the inbox. */
export function updateAvailableText(deployed: ReleaseStamp): string {
  return `A newer Swarm Space version (v${formatReleaseVersion(deployed.release)}) is live. You are holding your current version. Update when you are ready.`;
}
