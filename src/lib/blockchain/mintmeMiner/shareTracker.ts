/**
 * MintMe share receipts. Accepted pool shares become unsigned advisory receipts
 * (`mintme-share-proof`) so connected peers can see contribution. Share weights
 * do not determine rewards: payoutPolicy defines an equal connected-peer split.
 * This does not move MINTME by itself. Peer reports are unverified and must never
 * authorize payouts. The controller logs in only with community receiving metadata.
 */
export const MINTME_SHARE_CHANNEL = "mintme-share-proof";

export interface ShareReceipt {
  minerPeerId: string;
  jobId: string;
  difficulty: number;
  acceptedAt: number;
}

export function isShareReceipt(v: unknown): v is ShareReceipt {
  const r = v as ShareReceipt | null;
  return !!r && typeof r.minerPeerId === "string" && typeof r.jobId === "string"
    && typeof r.difficulty === "number" && r.difficulty > 0 && typeof r.acceptedAt === "number";
}

export interface MeshLike {
  broadcast(channel: string, payload: unknown): void;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

export class ShareTracker {
  private seen = new Set<string>();
  readonly local: ShareReceipt[] = [];
  readonly fromPeers: ShareReceipt[] = [];
  private unsub: (() => void) | null = null;

  constructor(private readonly mesh: MeshLike | null, private readonly onChange: () => void) {
    this.unsub = mesh?.onMessage(MINTME_SHARE_CHANNEL, (peerId, payload) => {
      if (!isShareReceipt(payload) || payload.minerPeerId !== peerId) return;
      if (!this.remember(payload)) return;
      this.fromPeers.push(payload);
      this.onChange();
    }) ?? null;
  }

  recordLocal(receipt: ShareReceipt): void {
    if (!this.remember(receipt)) return;
    this.local.push(receipt);
    this.mesh?.broadcast(MINTME_SHARE_CHANNEL, receipt);
    this.onChange();
  }

  dispose(): void { this.unsub?.(); this.unsub = null; }

  private remember(r: ShareReceipt): boolean {
    const key = `${r.minerPeerId}:${r.jobId}:${r.acceptedAt}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }
}
