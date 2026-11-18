/**
 * Wallet recipient search — find a SWARM wallet by @username or display name
 * instead of a raw wallet id. Candidates come from the same sources as
 * @mentions (swarm library + synced local users, blocked/ignored excluded),
 * minus the network entity and the sender, and resolve to the existing
 * ledger identity through the shared native wallet resolver.
 */
import { resolveMentionCandidates, type MentionCandidate } from "@/lib/mentions";
import { resolveNativeWalletRecipient } from "./nativeAddress";
import type { User } from "@/types";

export interface WalletRecipientCandidate {
  userId: string;
  username: string;
  displayName: string;
  avatarRef?: string;
}

/** Inputs that the raw-address resolver handles: 0x alias or swarm: id. */
export function looksLikeWalletAddress(input: string): boolean {
  const value = input.trim();
  return /^0x[\da-f]{40}$/i.test(value) || value.startsWith("swarm:");
}

/** Strip a leading @ and whitespace; returns "" when nothing searchable remains. */
export function normalizeRecipientQuery(input: string): string {
  return input.trim().replace(/^@+/, "").trim();
}

function toCandidate(c: MentionCandidate): WalletRecipientCandidate {
  return { userId: c.userId, username: c.username, displayName: c.displayName || c.username, avatarRef: c.avatarRef };
}

/** Username / display-name prefix search over known members, best match first. */
export async function searchWalletRecipients(input: string, senderId: string, limit = 6): Promise<WalletRecipientCandidate[]> {
  const query = normalizeRecipientQuery(input);
  if (!query || looksLikeWalletAddress(input)) return [];
  const lower = query.toLowerCase();
  const found = (await resolveMentionCandidates(query, Infinity))
    .filter(c => !c.isEntity && c.userId && c.userId !== senderId)
    .map(toCandidate);
  // An exact handle beats prefix matches so "@sam" never hides behind "@samantha".
  found.sort((a, b) => Number(b.username.toLowerCase() === lower) - Number(a.username.toLowerCase() === lower));
  return found.slice(0, limit);
}

/**
 * Resolve free text to a wallet owner: an exact @username (or unique match)
 * first, then the raw id / swarm: / 0x alias fallback.
 */
export async function resolveWalletRecipientInput(input: string, senderId: string): Promise<User> {
  const query = normalizeRecipientQuery(input);
  if (!query) throw new Error("Enter a username or SWARM wallet address.");
  // A pasted wallet id that belongs to a known account wins over name matches.
  if (!input.trim().startsWith("@") && !looksLikeWalletAddress(input)) {
    const direct = await resolveNativeWalletRecipient(input.trim()).catch(() => null);
    if (direct) return direct;
  }
  if (!looksLikeWalletAddress(input)) {
    const matches = await searchWalletRecipients(input, senderId, Infinity);
    const exact = matches.filter(m => m.username.toLowerCase() === query.toLowerCase());
    const pick = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    if (pick) return resolveNativeWalletRecipient(pick.userId);
    if (exact.length > 1 || matches.length > 1) throw new Error(`More than one member matches @${query}. Pick one from the list.`);
  }
  try {
    return await resolveNativeWalletRecipient(input.trim().startsWith("@") ? query : input);
  } catch {
    throw new Error(!looksLikeWalletAddress(input)
      ? `No synced member found for @${query}. Sync with them first or paste their SWARM wallet address.`
      : "SWARM wallet recipient not found. Sync with this user first.");
  }
}
