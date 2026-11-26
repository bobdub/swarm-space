/**
 * What this device did with donations peers sent it, so the donor board can
 * say why a peer's gift is missing instead of leaving people guessing.
 * In memory only; it resets when the app reloads.
 */
export interface PeerGiftOutcome {
  txId: string;
  from: string;
  /** e.g. "1,700 SWARM", "250 Credits". */
  what: string;
  /** null when taken in; otherwise why it was refused. */
  refused: string | null;
  at: number;
}

const MAX = 50;
const log: PeerGiftOutcome[] = [];

export function recordPeerGift(outcome: Omit<PeerGiftOutcome, "at">, now = Date.now()): void {
  const i = log.findIndex((o) => o.txId === outcome.txId);
  if (i >= 0) log.splice(i, 1);
  log.push({ ...outcome, at: now });
  if (log.length > MAX) log.shift();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("peer-gift-outcome"));
}

export interface PeerGiftSummary {
  heard: number;
  taken: number;
  refused: number;
  /** The newest refusal, if any. */
  lastRefusal: PeerGiftOutcome | null;
}

export function peerGiftSummary(): PeerGiftSummary {
  const refused = log.filter((o) => o.refused);
  return { heard: log.length, taken: log.length - refused.length, refused: refused.length, lastRefusal: refused[refused.length - 1] ?? null };
}

/** For tests. */
export function clearPeerGiftLog(): void {
  log.length = 0;
}
