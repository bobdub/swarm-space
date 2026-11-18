/**
 * Credit gossip — moves credit updates between peers as soon as they happen.
 *
 * Before this module:
 *   • a credit transfer was sent once, only to directly connected peers, and
 *     silently dropped if the mesh wasn't online at that instant;
 *   • SWARM mining rewards (token_mint) and credit ledger entries
 *     (credit_sync) only reached other peers when a chain sync on reconnect
 *     happened to carry a longer chain.
 *
 * Now every update is:
 *   1. pushed to all connected peers immediately,
 *   2. relayed onward by each peer that hasn't seen it (bounded hops, dedup
 *      by id) so it reaches recipients that aren't direct neighbours, and
 *   3. kept for a while and replayed to each newly connected peer, so an
 *      update made while offline, or while the recipient was offline, is
 *      delivered the moment a connection exists — no polling interval.
 */
import type { CreditTransaction } from "@/types";
import type { SwarmTransaction } from "@/lib/blockchain/types";

export const CREDIT_CHANNEL = "credits";
export const CHAIN_TX_CHANNEL = "chain-tx";
export const MAX_HOPS = 6;
export const MAX_REMEMBERED = 200;
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Only gossip local chain entries this fresh (chain-sync merges of history are not re-announced). */
export const LOCAL_TX_FRESH_MS = 10 * 60 * 1000;
/** Chain transaction types that carry credit/reward balance changes. */
export const GOSSIPED_CHAIN_TX_TYPES: ReadonlySet<string> = new Set(["token_mint", "credit_sync"]);

const STORAGE_KEY = "swarm-credit-gossip-v1";

export interface CreditTransferPayload {
  type: "credit-transfer";
  transaction: CreditTransaction;
  timestamp: number;
  hops?: number;
}

export interface ChainTxPayload {
  type: "chain-tx";
  tx: SwarmTransaction;
  hops?: number;
}

type GossipPayload = CreditTransferPayload | ChainTxPayload;

interface Remembered {
  channel: string;
  payload: GossipPayload;
  at: number;
}

export interface GossipMesh {
  getConnectedPeerIds(): string[];
  send(channel: string, peerId: string, payload: unknown): unknown;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  onPeersChange(handler: (...args: unknown[]) => void): () => void;
}

export interface CreditGossipDeps {
  /** Apply an incoming credit transfer locally (recipient check is the handler's job). */
  onCreditTransfer(transaction: CreditTransaction): void | Promise<void>;
  /** Add a peer's chain transaction to the local ledger. Return false to reject (it won't be relayed). */
  acceptChainTx(tx: SwarmTransaction): boolean | Promise<boolean>;
  /** Subscribe to transactions appended to the local ledger. */
  subscribeLocalChainTx?(listener: (tx: SwarmTransaction) => void): () => void;
  now?(): number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function payloadId(payload: GossipPayload): string | null {
  if (payload.type === "credit-transfer") {
    const id = payload.transaction?.id;
    return typeof id === "string" && id ? `credit:${id}` : null;
  }
  const id = payload.tx?.id;
  return typeof id === "string" && id ? `chain:${id}` : null;
}

function isCreditPayload(value: unknown): value is CreditTransferPayload {
  const v = value as CreditTransferPayload | null;
  return !!v && v.type === "credit-transfer" && !!v.transaction && typeof v.transaction.id === "string"
    && typeof v.transaction.toUserId === "string" && typeof v.transaction.amount === "number";
}

function isChainPayload(value: unknown): value is ChainTxPayload {
  const v = value as ChainTxPayload | null;
  return !!v && v.type === "chain-tx" && !!v.tx && typeof v.tx.id === "string"
    && typeof v.tx.type === "string" && GOSSIPED_CHAIN_TX_TYPES.has(v.tx.type);
}

export class CreditGossip {
  private remembered = new Map<string, Remembered>();
  private knownPeers = new Set<string>();
  private unsubs: Array<() => void> = [];
  private readonly now: () => number;
  private readonly storage: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(private mesh: GossipMesh, private deps: CreditGossipDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
    this.load();
  }

  start(): () => void {
    this.unsubs.push(
      this.mesh.onMessage(CREDIT_CHANNEL, (from, payload) => { void this.receive(CREDIT_CHANNEL, from, payload); }),
      this.mesh.onMessage(CHAIN_TX_CHANNEL, (from, payload) => { void this.receive(CHAIN_TX_CHANNEL, from, payload); }),
      this.mesh.onPeersChange(() => this.syncPeers()),
    );
    if (this.deps.subscribeLocalChainTx) {
      this.unsubs.push(this.deps.subscribeLocalChainTx((tx) => this.publishLocalChainTx(tx)));
    }
    this.syncPeers();
    return () => this.stop();
  }

  stop(): void {
    for (const u of this.unsubs.splice(0)) { try { u(); } catch { /* ignore */ } }
  }

  /** Announce a credit transfer made on this device. Delivered now if peers exist, else on next connect. */
  publishCreditTransfer(transaction: CreditTransaction): void {
    this.publish(CREDIT_CHANNEL, { type: "credit-transfer", transaction, timestamp: this.now(), hops: 0 });
  }

  /** Announce a ledger entry created on this device. */
  publishLocalChainTx(tx: SwarmTransaction): void {
    if (!GOSSIPED_CHAIN_TX_TYPES.has(tx.type)) return;
    const ts = Date.parse(tx.timestamp);
    if (Number.isFinite(ts) && this.now() - ts > LOCAL_TX_FRESH_MS) return;
    this.publish(CHAIN_TX_CHANNEL, { type: "chain-tx", tx, hops: 0 });
  }

  hasSeen(id: string): boolean {
    return this.remembered.has(id);
  }

  private publish(channel: string, payload: GossipPayload): void {
    const id = payloadId(payload);
    if (!id || this.remembered.has(id)) return;
    this.remember(id, channel, payload);
    this.sendToPeers(channel, payload, this.mesh.getConnectedPeerIds());
  }

  private async receive(channel: string, from: string, raw: unknown): Promise<void> {
    const payload = channel === CREDIT_CHANNEL
      ? (isCreditPayload(raw) ? raw : null)
      : (isChainPayload(raw) ? raw : null);
    if (!payload) return;
    const id = payloadId(payload);
    if (!id || this.remembered.has(id)) return;
    // Remember before applying so our own ledger listener doesn't re-announce it.
    this.remember(id, channel, payload);

    if (payload.type === "chain-tx") {
      let accepted = false;
      try { accepted = await this.deps.acceptChainTx(payload.tx); } catch { accepted = false; }
      if (!accepted) return;
    } else {
      try { await this.deps.onCreditTransfer(payload.transaction); } catch (err) {
        console.warn("[CreditGossip] credit transfer handler failed:", err);
      }
    }

    const hops = (payload.hops ?? 0) + 1;
    if (hops >= MAX_HOPS) return;
    const relay = { ...payload, hops } as GossipPayload;
    this.remembered.get(id)!.payload = relay;
    this.sendToPeers(channel, relay, this.mesh.getConnectedPeerIds().filter((p) => p !== from));
  }

  /** Replay remembered updates to peers we haven't talked to yet. */
  private syncPeers(): void {
    const current = new Set(this.mesh.getConnectedPeerIds());
    const fresh = [...current].filter((p) => !this.knownPeers.has(p));
    this.knownPeers = current;
    if (fresh.length === 0) return;
    this.prune();
    for (const entry of this.remembered.values()) {
      this.sendToPeers(entry.channel, entry.payload, fresh);
    }
  }

  private sendToPeers(channel: string, payload: GossipPayload, peerIds: string[]): void {
    for (const peerId of peerIds) {
      try { void this.mesh.send(channel, peerId, payload); } catch { /* peer went away */ }
    }
  }

  private remember(id: string, channel: string, payload: GossipPayload): void {
    this.remembered.set(id, { channel, payload, at: this.now() });
    this.prune();
    this.save();
  }

  private prune(): void {
    const cutoff = this.now() - REPLAY_WINDOW_MS;
    for (const [id, entry] of this.remembered) {
      if (entry.at < cutoff) this.remembered.delete(id);
    }
    while (this.remembered.size > MAX_REMEMBERED) {
      const oldest = this.remembered.keys().next().value as string;
      this.remembered.delete(oldest);
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as Array<[string, Remembered]>;
      for (const [id, entry] of entries) {
        if (entry && typeof entry.at === "number" && entry.payload) this.remembered.set(id, entry);
      }
      this.prune();
    } catch { /* corrupt cache — start fresh */ }
  }

  private save(): void {
    if (!this.storage) return;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.remembered])); } catch { /* quota */ }
  }
}

function safeLocalStorage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

// ── App singleton ─────────────────────────────────────────────────────

let instance: CreditGossip | null = null;
let starting: Promise<CreditGossip | null> | null = null;
const queuedCredits: CreditTransaction[] = [];

/**
 * Start credit gossip on the SWARM mesh. Idempotent. `onCreditTransfer`
 * applies transfers addressed to the current user.
 */
export function startCreditGossip(onCreditTransfer: CreditGossipDeps["onCreditTransfer"]): Promise<CreditGossip | null> {
  if (instance) return Promise.resolve(instance);
  if (starting) return starting;
  starting = (async () => {
    try {
      const [{ getSwarmMeshStandalone }, { getSwarmChain }] = await Promise.all([
        import("@/lib/p2p/swarmMesh.standalone"),
        import("@/lib/blockchain/chain"),
      ]);
      const mesh = getSwarmMeshStandalone();
      const chain = getSwarmChain();
      const gossip = new CreditGossip(mesh, {
        onCreditTransfer,
        acceptChainTx: async (tx) => {
          await chain.whenReady();
          if (chain.hasTransaction(tx.id)) return true;
          chain.addTransaction(tx);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: tx }));
          }
          return true;
        },
        subscribeLocalChainTx: (listener) => chain.onTransactionAdded(listener),
      });
      gossip.start();
      instance = gossip;
      for (const tx of queuedCredits.splice(0)) gossip.publishCreditTransfer(tx);
      return gossip;
    } catch (err) {
      console.warn("[CreditGossip] mesh unavailable:", err);
      starting = null;
      return null;
    }
  })();
  return starting;
}

/** Announce a local credit transfer to the mesh (queued until gossip starts). */
export function publishCreditTransfer(transaction: CreditTransaction): void {
  if (instance) instance.publishCreditTransfer(transaction);
  else queuedCredits.push(transaction);
}
