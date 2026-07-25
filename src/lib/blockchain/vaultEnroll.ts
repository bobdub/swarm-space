/**
 * vaultEnroll — idempotent per-item enrolment of completed content into
 * the owning peer's Sync Vault. Falls back to an Archive coin when no
 * real wallet coin is free, so nothing is ever silently dropped.
 */
import { getAll } from "@/lib/store";
import type { SwarmCoin } from "./types";
import {
  ensureArchiveCoin,
  ensureVault,
  findVaultEntry,
  getOrRolloverReceiverCoin,
  allocateVaultCoin,
  recordVaultEntry,
} from "./syncVault";

export interface EnrollInput {
  contentHash: string;
  ownerPeerId: string; // "self" for local-owned
  isSelf: boolean;
  name: string;
  mime: string;
  size: number;
  ref: string;
}

async function walletCoins(): Promise<SwarmCoin[]> {
  try {
    const all = await getAll<SwarmCoin>("swarmCoins");
    return all.filter((c) => c.status === "wallet" && c.fillState !== "spent");
  } catch {
    return [];
  }
}

export async function enrollContent(input: EnrollInput): Promise<"skipped" | "enrolled" | "archived"> {
  const existing = await findVaultEntry(input.contentHash);
  if (existing) return "skipped";

  await ensureVault(input.ownerPeerId);
  const coins = await walletCoins();
  let ref = input.isSelf
    ? (await allocateVaultCoin(input.ownerPeerId, "canonical", coins))
      ?? (await getOrRolloverReceiverCoin(input.ownerPeerId, coins))
    : await getOrRolloverReceiverCoin(input.ownerPeerId, coins);

  const archived = !ref;
  if (!ref) ref = await ensureArchiveCoin(input.ownerPeerId);

  await recordVaultEntry(input.ownerPeerId, input.contentHash, {
    coinId: ref.coinId,
    offset: ref.fillBytes,
    length: Math.max(0, input.size | 0),
    mime: input.mime,
    ref: input.ref,
    name: input.name,
    pending: archived,
  });
  return archived ? "archived" : "enrolled";
}