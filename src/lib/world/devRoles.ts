/**
 * devRoles — who may lay communal land (roads / squares / parks).
 *
 * Deliberately tiny and local: no chain, no server. A dev is either
 * listed in the hardcoded allowlist below or added at runtime through
 * `localStorage['swarm-dev-peer-ids']` (JSON array of peer ids). This
 * mirrors the trust model of `landPlots` — local-first, gossip later.
 */

/** Baked-in maintainer peer ids. Extend as maintainers are minted. */
export const DEV_PEER_IDS: readonly string[] = [];

const LS_KEY = 'swarm-dev-peer-ids';

function runtimeDevIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** True when this peer may claim communal (road / public) plots. */
export function isDev(peerId?: string | null): boolean {
  if (!peerId) return false;
  if (DEV_PEER_IDS.includes(peerId)) return true;
  return runtimeDevIds().includes(peerId);
}

/** Add a dev peer id at runtime (dev console helper). */
export function grantDev(peerId: string): void {
  try {
    const next = Array.from(new Set([...runtimeDevIds(), peerId]));
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch { /* ignore quota */ }
}
