/**
 * MintMe share receipts. Accepted pool shares become signed-free mesh receipts
 * (`mintme-share-proof`) so connected peers can see contribution. The split is
 * share-weight accounting (80 miner / 15 connected peers / 5 community vault);
 * it does not move MINTME by itself — pool payouts land at the login address.
 */
export const MINTME_SHARE_CHANNEL = "mintme-share-proof";
export const MINTME_SPLIT = { miner: 0.8, peers: 0.15, vault: 0.05 } as const;

export interface ShareReceipt {
  minerPeerId: string;
  jobId: string;
  difficulty: number;
  acceptedAt: number;
}

export interface SplitResult {
  miner: number;
  perPeer: number;
  peersTotal: number;
  vault: number;
}

/** Split a difficulty-weighted amount. With no connected peers, their part goes to the vault. */
export function splitShareWeight(weight: number, connectedPeers: number): SplitResult {
  const w = Number.isFinite(weight) && weight > 0 ? weight : 0;
  const miner = w * MINTME_SPLIT.miner;
  const peersTotal = connectedPeers > 0 ? w * MINTME_SPLIT.peers : 0;
  const vault = w - miner - peersTotal;
  return { miner, perPeer: connectedPeers > 0 ? peersTotal / connectedPeers : 0, peersTotal, vault };
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
