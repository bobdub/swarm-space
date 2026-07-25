/**
 * vaultMigration — one-time index-only enroll of already-completed
 * torrents/files into per-peer Sync Vaults.
 *
 * Does NOT copy bytes: entries reference existing chunk/manifest storage.
 * Guarded by a sessionStorage flag so it runs at most once per session.
 */
import { getAll } from "@/lib/store";
import type { SwarmCoin } from "./types";
import {
  allocateVaultCoin,
  ensureVault,
  findVaultEntry,
  getOrRolloverReceiverCoin,
  recordVaultEntry,
} from "./syncVault";

const SESSION_FLAG = "vault-migration-v1-done";

export interface MigrationCandidate {
  contentHash: string;
  ownerPeerId: string; // "self" for local-owned
  isSelf: boolean;
  name: string;
  mime: string;
  size: number;
  ref: string;
}

export interface MigrationResult {
  enrolled: number;
  skipped: number;
  needsCoin: boolean;
}

async function walletCoins(): Promise<SwarmCoin[]> {
  try {
    const all = await getAll<SwarmCoin>("swarmCoins");
    return all.filter((c) => c.status === "wallet" && c.fillState !== "spent");
  } catch {
    return [];
  }
}

export async function migrateCompletedIntoVaults(
  candidates: MigrationCandidate[],
): Promise<MigrationResult> {
  const result: MigrationResult = { enrolled: 0, skipped: 0, needsCoin: false };
  if (!candidates.length) return result;

  const coins = await walletCoins();
  if (!coins.length) {
    result.needsCoin = true;
    return result;
  }

  for (const c of candidates) {
    try {
      const already = await findVaultEntry(c.contentHash);
      if (already) {
        result.skipped += 1;
        continue;
      }
      await ensureVault(c.ownerPeerId);
      const ref = c.isSelf
        ? (await allocateVaultCoin(c.ownerPeerId, "canonical", coins))
          ?? (await getOrRolloverReceiverCoin(c.ownerPeerId, coins))
        : await getOrRolloverReceiverCoin(c.ownerPeerId, coins);
      if (!ref) {
        result.needsCoin = true;
        result.skipped += 1;
        continue;
      }
      await recordVaultEntry(c.ownerPeerId, c.contentHash, {
        coinId: ref.coinId,
        offset: ref.fillBytes,
        length: Math.max(0, c.size | 0),
        mime: c.mime,
        ref: c.ref,
      });
      result.enrolled += 1;
    } catch (err) {
      console.warn("[vaultMigration] skipped", c.contentHash, err);
      result.skipped += 1;
    }
  }
  return result;
}

export function migrationAlreadyRan(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

export function markMigrationRan(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    /* noop */
  }
}