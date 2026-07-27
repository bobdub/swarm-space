/**
 * vaultEnroll — idempotent per-item enrolment of completed content into
 * the owning peer's Sync Vault. Falls back to an Archive coin when no
 * real wallet coin is free, so nothing is ever silently dropped.
 */
import { MEDIA_COIN_CAPACITY_BYTES } from "./types";
import {
  ensureVault,
  findVaultEntry,
  getOrCreateMediaCoin,
  forceSealCompletedMediaCoin,
  recordVaultEntry,
  markCoinPhase,
} from "./syncVault";
import { resyncStalled } from "./mediaCoinStuckWatch";

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

  // Pre-check: seal-fail any coin whose engrave stalled before we
  // allocate a fresh one. Idempotent + guarded against reentry.
  try { await resyncStalled(); } catch { /* best-effort */ }

  // Archive-first: unknown owner => global archive vault; known peer =>
  // that peer's archive vault. Media coin lives inside the vault until
  // the wrap sweep engraves a wallet coin onto it.
  const hasOwner = !!input.ownerPeerId && input.ownerPeerId !== "self";
  const vaultKey = hasOwner ? input.ownerPeerId : "archive:global";
  await ensureVault(vaultKey);

  const size = Number.isFinite(input.size) && input.size > 0 ? Math.floor(input.size) : 0;
  // Size-aware allocator: oversized files get a dedicated coin; a
  // normal file that would push the active coin past the seal line
  // triggers a pre-engrave seal + fresh coin. Files never split.
  const ref = await getOrCreateMediaCoin(vaultKey, size);
  const now = new Date().toISOString();

  // Mark phase "writing" for the duration of this engrave so the stuck
  // watch can distinguish quiet coins from actively-writing ones.
  try { await markCoinPhase(vaultKey, ref.coinId, "writing"); } catch { /* noop */ }

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

  // Oversized single-file coin: engrave is complete, seal now. Normal
  // coins are sealed pre-engrave by the allocator when the *next*
  // file would push them past the seal line, so we never seal a coin
  // mid-engrave.
  if (size >= MEDIA_COIN_CAPACITY_BYTES) {
    try { await forceSealCompletedMediaCoin(vaultKey, ref.coinId, "oversized-complete"); } catch { /* best-effort */ }
  } else {
    // Return to a quiescent "filling" phase after a successful write.
    try { await markCoinPhase(vaultKey, ref.coinId, "filling"); } catch { /* noop */ }
  }
  return "archived";
}