/**
 * Full-state export/import for offline-first backups.
 * Bundles identity, chain snapshot, and all critical IndexedDB stores.
 */
import { getAll, put, openDB } from "@/lib/store";

const BACKUP_STORES = [
  "users",
  "blockchain",
  "tokenBalances",
  "miningSessions",
  "profileTokens",
  "profileTokenHoldings",
  "tokenUnlockStates",
  "rewardPool",
  "creatorVaults",
  "coinListings",
  "participantListings",
  "manifests",
  "chunks",
  "meta",
] as const;

const LS_KEYS = [
  "me",
  "__swarm_chain_snapshot",
  "__swarm_chain_snapshot_prev",
  "p2p-connection-state",
  "swarmMeshMode",
] as const;

export interface FullBackup {
  version: 1;
  createdAt: string;
  localStorage: Record<string, string>;
  stores: Record<string, unknown[]>;
}

export async function exportFullState(): Promise<FullBackup> {
  const db = await openDB();
  const availableStores = new Set<string>(Array.from(db.objectStoreNames));
  const stores: Record<string, unknown[]> = {};
  for (const name of BACKUP_STORES) {
    if (!availableStores.has(name)) continue;
    try {
      stores[name] = await getAll<unknown>(name);
    } catch (err) {
      console.warn(`[Backup] Skipped store ${name}:`, err);
    }
  }
  const ls: Record<string, string> = {};
  for (const k of LS_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) ls[k] = v;
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    localStorage: ls,
    stores,
  };
}

export async function importFullState(bundle: FullBackup): Promise<{ restoredStores: number; restoredKeys: number }> {
  if (!bundle || bundle.version !== 1) throw new Error("Unsupported backup format");
  let restoredStores = 0;
  let restoredKeys = 0;
  const db = await openDB();
  const availableStores = new Set<string>(Array.from(db.objectStoreNames));
  for (const [name, rows] of Object.entries(bundle.stores ?? {})) {
    if (!availableStores.has(name) || !Array.isArray(rows)) continue;
    for (const row of rows) {
      try { await put(name, row); } catch { /* skip individual bad rows */ }
    }
    restoredStores++;
  }
  for (const [k, v] of Object.entries(bundle.localStorage ?? {})) {
    try {
      localStorage.setItem(k, v);
      restoredKeys++;
    } catch { /* ignore quota */ }
  }
  return { restoredStores, restoredKeys };
}

export function downloadBackup(bundle: FullBackup, filename = `swarm-backup-${Date.now()}.json`): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}