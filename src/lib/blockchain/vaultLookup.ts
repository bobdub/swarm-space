/**
 * vaultLookup — local-first content resolution.
 * Miss falls through cleanly; this module never touches transport.
 */
import { findVaultEntry, bumpVaultCounter, getVault } from "./syncVault";
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
  // Coin-state gate: never serve from a failed archive, and never serve
  // from a media coin that hasn't finished sealing. Torrent fallback
  // keeps the content live in the meantime.
  const v = await getVault(vault.peerId);
  const coin = v?.coins.find((c) => c.coinId === entry.coinId);
  if (coin?.failed) return null;
  if (coin?.role === "media" && !coin.sealed) return null;
  if (entry.awaitingSync) return null;
  const bytes = entry.ref ? await getChunk(entry.ref) : null;
  if (!bytes) {
    await bumpVaultCounter(vault.peerId, "miss");
    return null;
  }
  await bumpVaultCounter(vault.peerId, "hit");
  return { peerId: vault.peerId, coinId: entry.coinId, bytes, mime: entry.mime };
}