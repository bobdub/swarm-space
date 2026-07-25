/**
 * vaultEnroll — idempotent per-item enrolment of completed content into
 * the owning peer's Sync Vault. Falls back to an Archive coin when no
 * real wallet coin is free, so nothing is ever silently dropped.
 */
import { MEDIA_COIN_SEAL_FRACTION } from "./types";
import {
  ensureVault,
  findVaultEntry,
  getOrCreateMediaCoin,
  sealMediaCoin,
  recordVaultEntry,
  getVault,
} from "./syncVault";

export interface EnrollInput {
  contentHash: string;
  ownerPeerId: string; // "self" for local-owned
  isSelf: boolean;
  name: string;
  mime: string;
  size: number;
  ref: string;
  completedAt?: string;
}

export async function enrollContent(input: EnrollInput): Promise<"skipped" | "enrolled" | "archived"> {
  const existing = await findVaultEntry(input.contentHash);
  if (existing) return "skipped";

  // Archive-first: unknown owner => global archive vault; known peer =>
  // that peer's archive vault. Media coin lives inside the vault until
  // the wrap sweep engraves a wallet coin onto it.
  const hasOwner = !!input.ownerPeerId && input.ownerPeerId !== "self";
  const vaultKey = hasOwner ? input.ownerPeerId : "archive:global";
  await ensureVault(vaultKey);

  const ref = await getOrCreateMediaCoin(vaultKey);
  const size = Math.max(0, input.size | 0);
  const now = new Date().toISOString();

  await recordVaultEntry(vaultKey, input.contentHash, {
    coinId: ref.coinId,
    offset: ref.fillBytes,
    length: size,
    mime: input.mime,
    ref: input.ref,
    name: input.name,
    pending: true, // pending until wrapped onto a real wallet coin
    firstSeenAt: now,
    completedAt: input.completedAt ?? now,
  });

  // Post-write seal check — re-read the vault so we see the *actual*
  // fill that recordVaultEntry persisted (the `ref` snapshot in scope
  // is stale for freshly-allocated coins and would keep the coin stuck
  // in "Sealing" forever).
  try {
    const fresh = await getVault(vaultKey);
    const coin = fresh?.coins.find((c) => c.coinId === ref.coinId);
    if (coin && !coin.sealed && coin.capacityBytes > 0
      && coin.fillBytes / coin.capacityBytes >= MEDIA_COIN_SEAL_FRACTION) {
      await sealMediaCoin(vaultKey, ref.coinId);
    }
  } catch { /* seal is best-effort; the wrap sweep will retry */ }
  return "archived";
}