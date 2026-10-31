import type { SwarmTransaction } from "../types";
import { MINTME_PAYOUT_THRESHOLD_UNITS } from "./payoutPolicy";
import {
  availableCommunityUnits, buildCommunityPayoutTx, communityProposalId, infinityTieDecision,
  nextCommunityRound, type InfinityTieBreak, type MintMeCommunityVote,
} from "./communityPayout";

export const MINTME_COMMUNITY_CHANNEL = "mintme-community-payout-v3";
/** Members must have been online together this long before Infinity acts. */
export const INFINITY_HEARTBEAT_WINDOW_MS = 30 * 60_000;
const SWEEP_HOPS = 2;

type Message = { kind: "propose"; round: number; availableUnits: string }
  | { kind: "vote"; vote: MintMeCommunityVote }
  | { kind: "sweep"; id: string; round: number; hops: number }
  | { kind: "reading"; id: string; voterId: string; units: string; hops: number }
  | { kind: "settled"; tx: SwarmTransaction };

export interface CommunityPayoutDeps {
  transport: {
    broadcast(channel: string, message: unknown): void;
    onMessage(channel: string, handler: (peerId: string, message: unknown) => void): () => void;
  };
  connectedPeerCount(): number;
  /** What the pool holds, read independently by this node. */
  readVaultUnits(): Promise<bigint | null>;
  ledger: { transactions(): SwarmTransaction[]; accept(tx: SwarmTransaction): Promise<boolean> };
  /** This member's native wallet id; null for guests/signed-out (node does not answer). */
  memberId(): string | null;
  now?(): number;
  heartbeatWindowMs?: number;
  sweepWaitMs?: number;
}

/**
 * Infinity's autonomous MintMe task: heartbeat timer → validate pool → ask peers →
 * majority pays; an even split triggers Infinity's mesh-wide tie-break.
 */
export class MintMeCommunityPayout {
  private votes = new Map<string, Map<string, MintMeCommunityVote>>();
  private answered = new Set<string>();
  private settled = new Set<string>();
  private sweeps = new Map<string, Map<string, string>>();
  private seenSweep = new Set<string>();
  private togetherSince: number | null = null;
  private unsubscribe?: () => void;
  private vaultCache: { at: number; units: bigint | null } | null = null;

  constructor(private readonly deps: CommunityPayoutDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }

  start(): void {
    this.stop();
    this.unsubscribe = this.deps.transport.onMessage(MINTME_COMMUNITY_CHANNEL, (_peer, message) => {
      void this.receive(message).catch(() => {});
    });
  }

  stop(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.votes.clear(); this.answered.clear(); this.sweeps.clear(); this.seenSweep.clear();
  }

  /** Heartbeat: time this node has been online with at least one peer. */
  heartbeat(): boolean {
    if (this.deps.connectedPeerCount() < 1) { this.togetherSince = null; return false; }
    this.togetherSince ??= this.now();
    return this.now() - this.togetherSince >= (this.deps.heartbeatWindowMs ?? INFINITY_HEARTBEAT_WINDOW_MS);
  }

  private async view(): Promise<{ round: number; units: bigint } | null> {
    if (!this.vaultCache || this.now() - this.vaultCache.at > 30_000) {
      this.vaultCache = { at: this.now(), units: await this.deps.readVaultUnits() };
    }
    if (this.vaultCache.units === null) return null;
    const txs = this.deps.ledger.transactions();
    return { round: nextCommunityRound(txs), units: availableCommunityUnits(this.vaultCache.units, txs) };
  }

  async tick(): Promise<void> {
    if (!this.heartbeat()) return;
    const view = await this.view();
    if (!view || view.units < MINTME_PAYOUT_THRESHOLD_UNITS) return;
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "propose", round: view.round, availableUnits: view.units.toString() });
    await this.answer(view.round, view.units, true);
  }

  private async answer(round: number, units: bigint, agree: boolean): Promise<void> {
    const voterId = this.deps.memberId();
    if (!voterId) return;
    const proposalId = communityProposalId(round, units);
    if (this.answered.has(proposalId)) return;
    this.answered.add(proposalId);
    const vote: MintMeCommunityVote = { proposalId, round, availableUnits: units.toString(), voterId, agree };
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "vote", vote });
    await this.collect(vote);
  }

  async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const message = value as Message;
    if (message.kind === "propose") {
      if (!Number.isSafeInteger(message.round) || !/^\d+$/.test(String(message.availableUnits))) return;
      const proposed = BigInt(message.availableUnits);
      if (proposed < MINTME_PAYOUT_THRESHOLD_UNITS || !this.heartbeat()) return;
      const view = await this.view();
      if (!view || view.round !== message.round) return;
      await this.answer(message.round, proposed, view.units >= proposed);
    } else if (message.kind === "vote") {
      const v = message.vote;
      if (v && typeof v.voterId === "string" && typeof v.agree === "boolean") await this.collect(v);
    } else if (message.kind === "sweep") {
      await this.onSweep(message);
    } else if (message.kind === "reading") {
      this.onReading(message);
    } else if (message.kind === "settled") {
      await this.record(message.tx);
    }
  }

  private async collect(vote: MintMeCommunityVote): Promise<void> {
    if (vote.round !== nextCommunityRound(this.deps.ledger.transactions())) return;
    let set = this.votes.get(vote.proposalId);
    if (!set) {
      if (this.votes.size >= 64) this.votes.clear();
      set = new Map(); this.votes.set(vote.proposalId, set);
    }
    if (set.has(vote.voterId)) return;
    set.set(vote.voterId, vote);
    const meshSize = this.deps.connectedPeerCount() + 1;
    const all = [...set.values()];
    const tx = buildCommunityPayoutTx(all, Math.floor(meshSize / 2) + 1);
    if (tx) return this.record(tx);
    const yes = all.filter(v => v.agree).length;
    if (all.length >= meshSize && yes * 2 === all.length && yes >= 2) await this.tieBreak(vote.proposalId, all);
  }

  /** Infinity's trip across the mesh: gather pool readings (2 hops), then cast the deciding answer. */
  private async tieBreak(proposalId: string, votes: MintMeCommunityVote[]): Promise<void> {
    if (this.sweeps.has(proposalId)) return;
    const readings = new Map<string, string>();
    this.sweeps.set(proposalId, readings);
    const own = await this.view(), me = this.deps.memberId();
    if (own && me) readings.set(me, own.units.toString());
    this.seenSweep.add(proposalId);
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "sweep", id: proposalId, round: votes[0].round, hops: SWEEP_HOPS });
    await new Promise(r => setTimeout(r, this.deps.sweepWaitMs ?? 4_000));
    const list = [...readings].map(([voterId, units]) => ({ voterId, units }));
    const tieBreak: InfinityTieBreak = { readings: list, decision: infinityTieDecision(list, BigInt(votes[0].availableUnits)) };
    const tx = tieBreak.decision ? buildCommunityPayoutTx(votes, 2, tieBreak) : null;
    if (tx) await this.record(tx);
  }

  private async onSweep(m: Extract<Message, { kind: "sweep" }>): Promise<void> {
    if (typeof m.id !== "string" || this.seenSweep.has(m.id)) return;
    this.seenSweep.add(m.id);
    if (m.hops > 1) this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { ...m, hops: m.hops - 1 });
    const view = await this.view(), me = this.deps.memberId();
    if (!view || !me || view.round !== m.round) return;
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "reading", id: m.id, voterId: me, units: view.units.toString(), hops: SWEEP_HOPS });
  }

  private onReading(m: Extract<Message, { kind: "reading" }>): void {
    if (typeof m.voterId !== "string" || !/^\d+$/.test(String(m.units))) return;
    const target = this.sweeps.get(m.id);
    if (target) { target.set(m.voterId, m.units); return; }
    const key = `${m.id}:${m.voterId}`;
    if (this.seenSweep.has(key) || m.hops <= 1) return;
    this.seenSweep.add(key);
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { ...m, hops: m.hops - 1 });
  }

  private async record(tx: SwarmTransaction): Promise<void> {
    if (!tx || typeof tx.id !== "string" || this.settled.has(tx.id)) return;
    if (!await this.deps.ledger.accept(tx)) return;
    this.settled.add(tx.id);
    this.votes.clear();
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "settled", tx });
  }
}

/** Live wiring: mesh transport, public MintMe RPC pool read, SWARM ledger, member id. */
export async function createMeshCommunityPayout(mesh: CommunityPayoutDeps["transport"] & { getConnectedPeers(): string[] }) {
  const [{ getSwarmChain }, auth, { getMintMeCommunityVaultAddress }, { FallbackProvider, JsonRpcProvider }, { MINTME_NETWORK }] = await Promise.all([
    import("../chain"), import("@/lib/auth"), import("./communityCustody"), import("ethers"), import("../wallets/mintmeNetwork"),
  ]);
  const chain = getSwarmChain();
  return new MintMeCommunityPayout({
    transport: mesh,
    connectedPeerCount: () => mesh.getConnectedPeers().length,
    async readVaultUnits() {
      const vault = getMintMeCommunityVaultAddress();
      if (!vault) return null;
      const providers = MINTME_NETWORK.rpcUrls.map(url => new JsonRpcProvider(url));
      const provider = new FallbackProvider(providers, undefined, { quorum: Math.min(2, providers.length) });
      try {
        const height = await provider.getBlockNumber();
        return await provider.getBalance(vault, Math.max(0, height - 12));
      } catch { return null; } finally { provider.destroy(); }
    },
    ledger: {
      transactions: () => [...chain.getChain().flatMap(b => b.transactions ?? []), ...chain.getPendingTransactions()],
      accept: tx => chain.acceptMintMeCommunityPayout(tx),
    },
    memberId: () => auth.getCurrentUser()?.id ?? null,
  });
}
