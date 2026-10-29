import type { SwarmTransaction } from "../types";
import { MINTME_PAYOUT_THRESHOLD_UNITS } from "./payoutPolicy";
import {
  availableCommunityUnits, buildCommunityPayoutTx, nextCommunityRound, signCommunityVote,
  verifyCommunityVote, type MintMeCommunityVote,
} from "./communityPayout";

export const MINTME_COMMUNITY_CHANNEL = "mintme-community-payout-v2";

type Message = { kind: "propose"; round: number; availableUnits: string }
  | { kind: "vote"; vote: MintMeCommunityVote }
  | { kind: "settled"; tx: SwarmTransaction };

export interface CommunityPayoutDeps {
  transport: {
    broadcast(channel: string, message: unknown): void;
    onMessage(channel: string, handler: (peerId: string, message: unknown) => void): () => void;
  };
  connectedPeerCount(): number;
  /** What the community vault holds, read independently by this node. */
  readVaultUnits(): Promise<bigint | null>;
  ledger: { transactions(): SwarmTransaction[]; accept(tx: SwarmTransaction): Promise<boolean> };
  /** Signed-in member's identity keys; null while locked (node simply does not vote). */
  signer(): Promise<{ publicKey: string; privateKey: string } | null>;
}

/** Node A sees 25+, proposes; node B checks its own view and agrees; majority pays. */
export class MintMeCommunityPayout {
  private votes = new Map<string, Map<string, MintMeCommunityVote>>();
  private signed = new Set<string>();
  private settled = new Set<string>();
  private unsubscribe?: () => void;
  private vaultCache: { at: number; units: bigint | null } | null = null;

  constructor(private readonly deps: CommunityPayoutDeps) {}

  start(): void {
    this.stop();
    this.unsubscribe = this.deps.transport.onMessage(MINTME_COMMUNITY_CHANNEL, (_peer, message) => {
      void this.receive(message).catch(() => {});
    });
  }

  stop(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.votes.clear(); this.signed.clear();
  }

  private async available(): Promise<{ round: number; units: bigint } | null> {
    if (!this.vaultCache || Date.now() - this.vaultCache.at > 30_000) {
      this.vaultCache = { at: Date.now(), units: await this.deps.readVaultUnits() };
    }
    if (this.vaultCache.units === null) return null;
    const txs = this.deps.ledger.transactions();
    return { round: nextCommunityRound(txs), units: availableCommunityUnits(this.vaultCache.units, txs) };
  }

  /** Called periodically and when peers change. */
  async tick(): Promise<void> {
    if (this.deps.connectedPeerCount() < 1) return;
    const view = await this.available();
    if (!view || view.units < MINTME_PAYOUT_THRESHOLD_UNITS) return;
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "propose", round: view.round, availableUnits: view.units.toString() });
    await this.vote(view.round, view.units);
  }

  private async vote(round: number, units: bigint): Promise<void> {
    const keys = await this.deps.signer();
    if (!keys) return;
    const vote = await signCommunityVote(round, units, keys.publicKey, keys.privateKey);
    if (this.signed.has(vote.proposalId)) return;
    this.signed.add(vote.proposalId);
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "vote", vote });
    await this.collect(vote);
  }

  async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const message = value as Message;
    if (message.kind === "propose") {
      if (!Number.isSafeInteger(message.round) || typeof message.availableUnits !== "string" || !/^\d+$/.test(message.availableUnits)) return;
      const proposed = BigInt(message.availableUnits);
      const view = await this.available();
      // Agree only when my own view of the pool says the same round holds at least this much.
      if (!view || view.round !== message.round || proposed < MINTME_PAYOUT_THRESHOLD_UNITS || view.units < proposed) return;
      await this.vote(message.round, proposed);
    } else if (message.kind === "vote") {
      if (await verifyCommunityVote(message.vote)) await this.collect(message.vote);
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
    set.set(vote.voterId, vote);
    const meshSize = this.deps.connectedPeerCount() + 1;
    const tx = await buildCommunityPayoutTx([...set.values()], Math.floor(meshSize / 2) + 1);
    if (tx) await this.record(tx);
  }

  private async record(tx: SwarmTransaction): Promise<void> {
    if (!tx || typeof tx.id !== "string" || this.settled.has(tx.id)) return;
    if (!await this.deps.ledger.accept(tx)) return;
    this.settled.add(tx.id);
    this.votes.clear();
    this.deps.transport.broadcast(MINTME_COMMUNITY_CHANNEL, { kind: "settled", tx });
  }
}

/** Live wiring: mesh transport, public MintMe RPC vault read, SWARM ledger, signed-in identity. */
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
    async signer() {
      const user = auth.getCurrentUser();
      const privateKey = user ? await auth.getCachedPrivateKey() : null;
      return user && privateKey ? { publicKey: user.publicKey, privateKey } : null;
    },
  });
}
