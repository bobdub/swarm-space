/**
 * Hold & Sync for bridged deposits.
 *
 * A MintMe-confirmed deposit is real custody immediately, so it can always be
 * withdrawn back to MetaMask. Using it inside the mesh (transfers, vault
 * top-ups) waits until the deposit log has been shared with at least one peer;
 * until then that portion shows as "Pending sync".
 */
const KEY = "swarm-deposit-synced";
export const DEPOSIT_SYNC_EVENT = "swarm-deposit-synced";

function readSynced(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]); } catch { return new Set(); }
}

export function isDepositSynced(id: string): boolean { return readSynced().has(id); }

/** Mark the given deposit ids synced only when a live peer connection exists. Returns true if anything changed. */
export function markDepositsSynced(ids: string[], connectedPeers: number): boolean {
  if (connectedPeers <= 0 || ids.length === 0) return false;
  const set = readSynced();
  const before = set.size;
  ids.forEach((id) => set.add(id));
  if (set.size === before) return false;
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage full */ }
  try { window.dispatchEvent(new Event(DEPOSIT_SYNC_EVENT)); } catch { /* */ }
  return true;
}

export async function connectedPeerCount(): Promise<number> {
  try {
    const { getSwarmMeshStandalone } = await import("../../p2p/swarmMesh.standalone");
    return getSwarmMeshStandalone().getConnectedPeers().length;
  } catch { return 0; }
}
