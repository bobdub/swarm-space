/**
 * vaultLookup — local-first content resolution.
 * Miss falls through cleanly; this module never touches transport.
 */
import { findVaultEntry, bumpVaultCounter } from "./syncVault";
import { getChunk } from "@/lib/store";
import { isVaultsEnabled } from "./vaultConfig";

export interface VaultHit {
  peerId: string;
  coinId: string;
  bytes: Uint8Array;
  mime?: string;
}

export async function resolveFromVaults(
  contentHash: string,
): Promise<VaultHit | null> {
  if (!isVaultsEnabled()) return null;
  const found = await findVaultEntry(contentHash);
  if (!found) return null;
  const { vault, entry } = found;
  const bytes = entry.ref ? await getChunk(entry.ref) : null;
  if (!bytes) {
    await bumpVaultCounter(vault.peerId, "miss");
    return null;
  }
  await bumpVaultCounter(vault.peerId, "hit");
  return { peerId: vault.peerId, coinId: entry.coinId, bytes, mime: entry.mime };
}