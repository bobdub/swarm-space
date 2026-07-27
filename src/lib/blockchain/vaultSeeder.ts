/**
 * vaultSeeder — read-only advertisement of vault-held pieces.
 * Does NOT register new gossip topics; cross-peer seeding hook lands later.
 */
import { findVaultEntry, listVaults, updateVaultEntryPendingStates } from "./syncVault";
import { getAll } from "@/lib/store";

export async function vaultHas(contentHash: string): Promise<boolean> {
  return !!(await findVaultEntry(contentHash));
}

export async function vaultInventory(): Promise<string[]> {
  const vaults = await listVaults();
  const out = new Set<string>();
  for (const v of vaults) for (const h of Object.keys(v.index)) out.add(h);
  return Array.from(out);
}

interface SeedingRecord {
  fileId?: string;
  manifestId?: string;
  state?: string;
  percent?: number;
}

/**
 * enforceVaultSeeding — flip vault entries to pending when their backing
 * torrent/file is no longer seeding. Redundancy sweep picks pending items
 * back up. No new gossip topic.
 */
export async function enforceVaultSeeding(): Promise<void> {
  let live = new Set<string>();
  try {
    const [files, torrents] = await Promise.all([
      getAll<SeedingRecord>("fileTransfers").catch(() => []),
      getAll<SeedingRecord>("torrents").catch(() => []),
    ]);
    for (const f of files) {
      if (f.fileId && (f.percent === 100 || f.state === "seeding" || f.state === "complete")) {
        live.add(f.fileId);
      }
    }
    for (const t of torrents) {
      if (t.manifestId && (t.state === "seeding" || t.state === "complete")) {
        live.add(t.manifestId);
      }
    }
  } catch {
    live = new Set();
  }
  const vaults = await listVaults();
  for (const v of vaults) {
    const updates = new Map<string, boolean>();
    for (const [hash, entry] of Object.entries(v.index)) {
      const coin = v.coins.find((c) => c.coinId === entry.coinId);
      if (coin?.wrapped) {
        if (entry.pending) updates.set(hash, false);
        continue;
      }
      const stillLive = live.has(entry.ref ?? hash) || live.has(hash);
      const pending = !stillLive;
      if (!!entry.pending !== pending && !entry.coinId.startsWith("archive:")) updates.set(hash, pending);
    }
    await updateVaultEntryPendingStates(v.peerId, updates);
  }
}