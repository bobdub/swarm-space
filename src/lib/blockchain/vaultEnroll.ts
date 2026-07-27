/**
 * vaultEnroll — idempotent per-item enrolment of completed content into
 * the owning peer's Sync Vault. Falls back to an Archive coin when no
 * real wallet coin is free, so nothing is ever silently dropped.
 */
import { enrollVaultEntry } from "./syncVault";

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
  // Archive-first: unknown owner => global archive vault; known peer =>
  // that peer's archive vault. Media coin lives inside the vault until
  // the wrap sweep engraves a wallet coin onto it.
  const hasOwner = !!input.ownerPeerId && input.ownerPeerId !== "self";
  const vaultKey = hasOwner ? input.ownerPeerId : "archive:global";
  const result = await enrollVaultEntry(vaultKey, {
    contentHash: input.contentHash,
    mime: input.mime,
    ref: input.ref,
    name: input.name,
    size: input.size,
    completedAt: input.completedAt,
  });
  if (result === "skipped") return "skipped";
  return "archived";
}