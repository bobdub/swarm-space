/**
 * Human-facing app version, shown on the Node Dashboard mode chip.
 *
 * `release.json` at the repo root holds an integer counter. The
 * "Bump release version" workflow adds 1 on every push to main (each merged
 * PR), and the build bakes the counter in as __APP_RELEASE__. It is shown in
 * thousandths: release 1 is v0.001, release 1000 is v1.000.
 *
 * Ordering of builds for the mesh refresh prompt still uses the build stamp
 * in ./p2p/appVersion.ts; this number is for people to read.
 */

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
