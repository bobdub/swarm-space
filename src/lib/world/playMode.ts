/**
 * playMode — whether the local player is in online or offline play, and
 * which project's Brain they are standing in.
 *
 * Online play means the P2P mesh is enabled and at least one peer link is
 * open (`P2PProvider` reports it through `setMeshOnline`). Anything else —
 * P2P switched off, no peers reached yet, the browser offline — is offline
 * play. Unknown counts as offline, so a gather is never treated as online
 * before the mesh has said so.
 *
 * Gathered goods are tradable (Trading Stand), so the harvested bag keeps
 * what was gathered offline apart from what was gathered online
 * (`harvestedInventory`): offline gathers are for local play only and never
 * reach the ledger, a coin or an online build.
 *
 * The active Brain project lets a project's seed pool (offline gathers its
 * creator paid to bring in, see `offlineProjectSeed.ts`) be used inside
 * that project's Brain only.
 */

export type HarvestOrigin = 'online' | 'offline';

type Listener = () => void;

let meshOnline = false;
let activeProject: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* noop */ }
  }
}

/** True while the mesh is enabled and has at least one open peer link. */
export function isOnlinePlay(): boolean {
  return meshOnline;
}

/**
 * Why a SWARM payment (a drink at the bar, a Trading Stand trade, stocking or
 * funding a stand) can't be made right now, or null in online play. Anything
 * that moves SWARM or writes to the shared ledger needs the mesh: offline
 * play is for local gathering and building only, and a payment made against
 * a ledger no peer can see could be spent twice before it syncs.
 */
export function offlineSpendProblem(action: string): string | null {
  if (meshOnline) return null;
  return `You're offline. Connect to the mesh to ${action}: SWARM payments need a synced ledger, and offline play is for gathering and building only. Nothing was charged.`;
}

/** Where a gather made right now belongs. */
export function currentHarvestOrigin(): HarvestOrigin {
  return meshOnline ? 'online' : 'offline';
}

export function setMeshOnline(online: boolean): void {
  if (meshOnline === online) return;
  meshOnline = online;
  notify();
}

/** The project whose Brain the player is in, or null (Main Brain, or no Brain). */
export function activeBrainProject(): string | null {
  return activeProject;
}

export function setActiveBrainProject(projectId: string | null): void {
  const next = projectId || null;
  if (activeProject === next) return;
  activeProject = next;
  notify();
}

export function subscribePlayMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam. */
export function _resetPlayModeForTest(state: { online?: boolean; project?: string | null } = {}): void {
  meshOnline = state.online ?? false;
  activeProject = state.project ?? null;
}
