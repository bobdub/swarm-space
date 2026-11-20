import type { SwarmTransaction } from "../types";
import {
  INFINITY_POOL_ALLOCATION_ENABLED, allocationDay, buildAllocationTx, nextAllocationRound, planAllocation, type AllocationVote,
} from "./poolAllocation";

export const ALLOCATION_CHANNEL = "infinity-pool-allocation-v1";

type Message = { kind: "propose"; round: number; day: number; units: string; proposalId: string }
  | { kind: "vote"; vote: AllocationVote }
  | { kind: "settled"; tx: SwarmTransaction };

export interface AllocationDeps {
  transport: {
    broadcast(channel: string, message: unknown): void;
    onMessage(channel: string, handler: (peerId: string, message: unknown) => void): () => void;
  };
  ledger: { transactions(): SwarmTransaction[]; accept(tx: SwarmTransaction): Promise<boolean> };
  /** Signed-in member id; null for guests (node does not answer). */
  memberId(): string | null;
  /** True once this node has been connected 2 h+ (Infinity's deep tier). */
  deepTier(): boolean;
  now?(): number;
}

/**
 * Infinity proposes a vault allocation; members connected 2 h+ each check it
 * against their own ledger and answer. 3+ yes and a strict majority settles.
 */
export class InfinityPoolAllocation {
  private votes = new Map<string, Map<string, AllocationVote>>();
  private answered = new Set<string>();
  private settled = new Set<string>();
  private unsubscribe?: () => void;

  constructor(private readonly deps: AllocationDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }
  private active() { return INFINITY_POOL_ALLOCATION_ENABLED && this.deps.deepTier() && !!this.deps.memberId(); }

  start(): void {
    this.stop();
    this.unsubscribe = this.deps.transport.onMessage(ALLOCATION_CHANNEL, (_peer, message) => {
      void this.receive(message).catch(() => {});
    });
  }

  stop(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.votes.clear(); this.answered.clear();
  }

  async tick(): Promise<void> {
    if (!this.active()) return;
    const plan = planAllocation(this.deps.ledger.transactions(), allocationDay(this.now()));
    if (!plan) return;
    this.deps.transport.broadcast(ALLOCATION_CHANNEL, {
      kind: "propose", round: plan.round, day: plan.day, units: plan.units.toString(), proposalId: plan.proposalId,
    });
    await this.answer(plan.round, plan.day, plan.units.toString(), plan.proposalId, true);
  }

  private async answer(round: number, day: number, units: string, proposalId: string, agree: boolean): Promise<void> {
    const voterId = this.deps.memberId();
    if (!voterId || this.answered.has(proposalId)) return;
    this.answered.add(proposalId);
    const vote: AllocationVote = { proposalId, round, day, units, voterId, agree };
    this.deps.transport.broadcast(ALLOCATION_CHANNEL, { kind: "vote", vote });
    await this.collect(vote);
  }

  async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const message = value as Message;
    if (message.kind === "propose") {
      if (!this.active() || !Number.isSafeInteger(message.round) || !Number.isSafeInteger(message.day)) return;
      if (typeof message.units !== "string" || typeof message.proposalId !== "string") return;
      // Only answer for today; a proposal from a skewed clock is simply not answered.
      if (message.day !== allocationDay(this.now())) return;
      const own = planAllocation(this.deps.ledger.transactions(), message.day);
      const agree = !!own && own.proposalId === message.proposalId && own.units.toString() === message.units && own.round === message.round;
      await this.answer(message.round, message.day, message.units, message.proposalId, agree);
    } else if (message.kind === "vote") {
      const v = message.vote;
      if (v && typeof v.voterId === "string" && typeof v.agree === "boolean" && typeof v.proposalId === "string") await this.collect(v);
    } else if (message.kind === "settled") {
      await this.record(message.tx);
    }
  }

  private async collect(vote: AllocationVote): Promise<void> {
    if (vote.round !== nextAllocationRound(this.deps.ledger.transactions())) return;
    let set = this.votes.get(vote.proposalId);
    if (!set) {
      if (this.votes.size >= 64) this.votes.clear();
      set = new Map(); this.votes.set(vote.proposalId, set);
    }
    if (set.has(vote.voterId)) return;
    set.set(vote.voterId, vote);
    const tx = buildAllocationTx([...set.values()], this.deps.ledger.transactions());
    if (tx) await this.record(tx);
  }

  private async record(tx: SwarmTransaction): Promise<void> {
    if (!tx || typeof tx.id !== "string" || this.settled.has(tx.id)) return;
    if (!await this.deps.ledger.accept(tx)) return;
    this.settled.add(tx.id);
    this.votes.clear();
    this.deps.transport.broadcast(ALLOCATION_CHANNEL, { kind: "settled", tx });
  }
}

/** Live wiring: mesh transport, SWARM ledger, member id, Infinity's agent tier. */
export async function createMeshPoolAllocation(mesh: AllocationDeps["transport"]) {
  const [{ getSwarmChain }, auth, agent, { tierAtLeast }] = await Promise.all([
    import("../chain"), import("@/lib/auth"), import("@/lib/brain/agent/infinityAgent"), import("@/lib/brain/agent/connectionClock"),
  ]);
  const chain = getSwarmChain();
  return new InfinityPoolAllocation({
    transport: mesh,
    ledger: {
      transactions: () => [...chain.getChain().flatMap((b) => b.transactions ?? []), ...chain.getPendingTransactions()],
      accept: (tx) => chain.acceptInfinityVaultAllocation(tx),
    },
    memberId: () => auth.getCurrentUser()?.id ?? null,
    deepTier: () => tierAtLeast(agent.getAgentStatus().tier, "deep"),
  });
}
