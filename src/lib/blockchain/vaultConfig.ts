/**
 * vaultConfig — soft feature flag + kill switch for Sync Vaults.
 * Default ON. Toggle in Settings → Storage. URL: ?vaults=0 disables.
 */
const STORAGE_KEY = "swarm-sync-vaults-enabled";
let cache: boolean | null = null;

function urlOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search).get("vaults");
    if (p === "0" || p === "false") return false;
    if (p === "1" || p === "true") return true;
  } catch { /* ignore */ }
  return null;
}

export function isVaultsEnabled(): boolean {
  if (cache !== null) return cache;
  const override = urlOverride();
  if (override !== null) return (cache = override);
  if (typeof window === "undefined") return (cache = true);
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "0" || stored === "false") return (cache = false);
  } catch { /* ignore */ }
  return (cache = true);
}

export function setVaultsEnabled(v: boolean): void {
  cache = v;
  try { window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}