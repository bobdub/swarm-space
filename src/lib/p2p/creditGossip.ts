/**
 * Credit gossip — moves credit updates between peers as soon as they happen.
 *
 * Before this module:
 *   • a credit transfer was sent once, only to directly connected peers, and
 *     silently dropped if the mesh wasn't online at that instant;
 *   • SWARM mining rewards (token_mint) and credit ledger entries
 *     (credit_sync) only reached other peers when a chain sync on reconnect
 *     happened to carry a longer chain;
 *   • a Market Vault donation (pool_donate) never left the donor's device
 *     unless that device itself mined it into a block, so the shared donor
 *     leaderboard on every other peer never saw it.
 *
 * Now every update is:
 *   1. pushed to all connected peers immediately,
 *   2. relayed onward by each peer that hasn't seen it (bounded hops, dedup
 *      by id) so it reaches recipients that aren't direct neighbours, and
 *   3. kept for a while and replayed to each newly connected peer, so an
 *      update made while offline, or while the recipient was offline, is
 *      delivered the moment a connection exists — no polling interval.
 */
import { isVaultDonationRecord } from "@/lib/blockchain/wallets/tipSignature";
import type { CreditTransaction } from "@/types";
import type { SwarmTransaction } from "@/lib/blockchain/types";
import { isSelfIssuedSwarmMint } from "@/lib/blockchain/issuance";
import { recordPeerGift } from "./peerGiftLog";

export const CREDIT_CHANNEL = "credits";
export const CHAIN_TX_CHANNEL = "chain-tx";
export const MAX_HOPS = 6;
export const MAX_REMEMBERED = 200;
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Only gossip local chain entries this fresh (chain-sync merges of history are not re-announced). */
export const LOCAL_TX_FRESH_MS = 10 * 60 * 1000;
/** How often still-unmined local donations are offered again to every connected peer. */
export const UNMINED_REOFFER_MS = 2 * 60 * 1000;
/** Chain transaction types that carry credit/reward balance changes, plus member vault donations. */
export const GOSSIPED_CHAIN_TX_TYPES: ReadonlySet<string> = new Set(["token_mint", "credit_sync", "pool_donate", "custom_token_transfer"]);

/**
 * A chain entry peers should hear about. A `pool_donate` from "system" is the
 * old local mining-tax top-up: the block reward now carries the pool's share,
 * so relaying it would credit the pool twice on every peer.
 */
export function isGossipedChainTx(tx: Pick<SwarmTransaction, "type" | "from"> & Partial<Pick<SwarmTransaction, "to" | "meta">> | null | undefined): boolean {
  if (!tx || !GOSSIPED_CHAIN_TX_TYPES.has(tx.type)) return false;
  if (tx.type === "pool_donate" && (!tx.from || tx.from === "system")) return false;
  // Of the token records, only a member's Credits or token gift to the Market Vault travels.
  if (tx.type === "custom_token_transfer" && !isVaultDonationRecord(tx as SwarmTransaction)) return false;
  return true;
}

/** A gift to the Market Vault that may travel before it is mined, once its donor has signed it. */
function isVaultGift(tx: SwarmTransaction): boolean {
  return (tx.type === "pool_donate" && !!tx.from && tx.from !== "system") || isVaultDonationRecord(tx);
}

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
  /**
   * Local ledger entries still waiting for a block, offered to each newly
   * connected peer whatever their age, so any miner can include them. Only
   * entries that pass `isGossipedChainTx` are sent.
   */
  unminedLocalChainTxs?(): SwarmTransaction[] | Promise<SwarmTransaction[]>;
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
    && typeof v.tx.type === "string" && isGossipedChainTx(v.tx);
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
    if (this.deps.unminedLocalChainTxs) {
      // A peer may refuse a donation it can't check yet (say its ledger hasn't
      // caught up with the donor's balance). Keep offering until it is mined.
      const timer = setInterval(() => { void this.offerUnmined(); }, UNMINED_REOFFER_MS);
      this.unsubs.push(() => clearInterval(timer));
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
    if (!isGossipedChainTx(tx)) return;
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
    if (!id) return;
    if (this.remembered.has(id)) {
      // Already relayed. Still offer a credit transfer for local delivery:
      // the recipient may have signed in since we first saw it. The handler
      // dedupes by transaction id, so this never double-credits.
      if (payload.type === "credit-transfer") await this.deliverCredit(payload.transaction);
      return;
    }
    // Remember before applying so our own ledger listener doesn't re-announce it.
    this.remember(id, channel, payload);

    if (payload.type === "chain-tx") {
      let accepted = false;
      try { accepted = await this.deps.acceptChainTx(payload.tx); } catch { accepted = false; }
      if (!accepted) {
        // Forget a refused entry so the next offer is checked again: what this
        // ledger could not verify now (an unsynced balance) may check out later.
        this.remembered.delete(id);
        this.save();
        return;
      }
    } else {
      await this.deliverCredit(payload.transaction);
    }

    const hops = (payload.hops ?? 0) + 1;
    if (hops >= MAX_HOPS) return;
    const relay = { ...payload, hops } as GossipPayload;
    this.remembered.get(id)!.payload = relay;
    this.sendToPeers(channel, relay, this.mesh.getConnectedPeerIds().filter((p) => p !== from));
  }

  /**
   * Offer every remembered credit transfer to the local handler again, e.g.
   * after a different account signs in on this device.
   */
  async redeliverCredits(): Promise<void> {
    for (const entry of [...this.remembered.values()]) {
      if (entry.payload.type === "credit-transfer") await this.deliverCredit(entry.payload.transaction);
    }
  }

  private async deliverCredit(transaction: CreditTransaction): Promise<void> {
    try { await this.deps.onCreditTransfer(transaction); } catch (err) {
      console.warn("[CreditGossip] credit transfer handler failed:", err);
    }
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
    void this.offerUnmined(fresh);
  }

  /**
   * Offer local entries still waiting for a block to `peerIds` (default: every
   * connected peer), however old they are: until one is mined, the peers that
   * could mine it may never have seen it. Call again once the local ledger has
   * finished loading, since peers met before that only saw an empty list.
   */
  async offerUnmined(peerIds: string[] = this.mesh.getConnectedPeerIds()): Promise<void> {
    if (peerIds.length === 0) return;
    let unmined: SwarmTransaction[] = [];
    try { unmined = (await this.deps.unminedLocalChainTxs?.()) ?? []; } catch { unmined = []; }
    for (const tx of unmined) {
      if (!isGossipedChainTx(tx)) continue;
      this.sendToPeers(CHAIN_TX_CHANNEL, { type: "chain-tx", tx, hops: 0 }, peerIds);
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
          // New coins come only from block rewards: a peer's self-issued mint is unverifiable.
          if (isSelfIssuedSwarmMint(tx)) return false;
          if (chain.hasTransaction(tx.id)) return true;
          if (tx.type === "pool_donate" || tx.type === "custom_token_transfer") {
            const problem = tx.type === "pool_donate"
              ? await peerDonationProblem(tx, (id) => chain.getSpendableBalance(id))
              : await peerVaultGiftProblem(tx);
            const ticker = tx.type === "pool_donate" ? "SWARM" : String(tx.meta?.ticker ?? (String(tx.meta?.currency).toUpperCase() === "CREDITS" ? "Credits" : "tokens"));
            recordPeerGift({ txId: tx.id, from: tx.from, what: `${fmt(tx.amount ?? 0)} ${ticker}`, refused: problem });
            if (problem) {
              console.warn(`[CreditGossip] Refused a peer's vault donation ${tx.id}: ${problem}`);
              return false;
            }
          }
          chain.addTransaction(tx);
          if (tx.type === "pool_donate") {
            // Keep the Market Vault balance in step with the donation we just learned about.
            void import("@/lib/blockchain/storage").then((m) => m.derivePoolFromChain()).catch(() => { /* non-fatal */ });
          }
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: tx }));
          }
          return true;
        },
        subscribeLocalChainTx: (listener) => chain.onTransactionAdded(listener),
        // Vault donations wait in pending until someone mines them; offer them to every new peer.
        unminedLocalChainTxs: () => signedUnminedDonations(chain),
      });
      gossip.start();
      // Pending entries load from IndexedDB without passing through
      // onTransactionAdded: offer them once the ledger is in memory.
      void chain.whenReady().then(() => gossip.offerUnmined()).catch(() => { /* non-fatal */ });
      if (typeof window !== "undefined") {
        // Transfers that arrived while another account (or none) was active.
        window.addEventListener("user-login", () => { void gossip.redeliverCredits(); });
      }
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

/**
 * A peer's vault donation spends the donor's SWARM, so it is accepted only
 * when the donor signed it and the local ledger shows they hold the amount:
 * the same bar a native SWARM tip has to clear.
 */
export async function acceptablePeerDonation(tx: SwarmTransaction, spendable: (userId: string) => number): Promise<boolean> {
  return (await peerDonationProblem(tx, spendable)) === null;
}

/** Why a peer's vault SWARM donation can't be taken in, or null when it can. */
export async function peerDonationProblem(tx: SwarmTransaction, spendable: (userId: string) => number): Promise<string | null> {
  const { verifyPoolDonation } = await import("@/lib/blockchain/wallets/tipSignature");
  if (!await verifyPoolDonation(tx)) return tx.signature ? "its signature doesn't match the donor" : "it isn't signed yet (the donor needs the new version, unlocked)";
  const have = spendable(tx.from);
  const need = tx.amount ?? 0;
  return have >= need ? null : `the donor has ${fmt(have)} spendable SWARM on this ledger, needs ${fmt(need)}`;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * A peer's Credits or token gift to the Market Vault: signed by the donor.
 * A token gift also needs the donor's recorded balance of that token on this
 * ledger. Credits live on each member's device, so peers can check only the
 * signature, as they already do when a block carrying it is mined.
 */
export async function acceptablePeerVaultGift(
  tx: SwarmTransaction,
  tokenBalance?: (userId: string, currency: string) => number,
): Promise<boolean> {
  return (await peerVaultGiftProblem(tx, tokenBalance)) === null;
}

/** Why a peer's Credits or token gift to the vault can't be taken in, or null when it can. */
export async function peerVaultGiftProblem(
  tx: SwarmTransaction,
  tokenBalance?: (userId: string, currency: string) => number,
): Promise<string | null> {
  const { verifyVaultDonation } = await import("@/lib/blockchain/wallets/tipSignature");
  if (!await verifyVaultDonation(tx)) return tx.signature ? "its signature doesn't match the donor" : "it isn't signed yet (the donor needs the new version, unlocked)";
  const currency = String(tx.meta?.currency ?? "");
  if (currency.toUpperCase() === "CREDITS") return null;
  const balance = tokenBalance ?? (await import("@/lib/blockchain/deposits/customTokens")).recordedBalanceForCurrency;
  const have = balance(tx.from, currency);
  const need = tx.amount ?? 0;
  return have >= need ? null : `the donor holds ${fmt(have)} of that token on this ledger, needs ${fmt(need)}`;
}

/**
 * Unmined vault donations peers can verify. A donation made before donations
 * were signed is signed now by its own donor, on the donor's device, when the
 * wallet is unlocked; nobody else's unsigned donation is ever offered.
 */
export async function signedUnminedDonations(chain: {
  getPendingTransactions(): SwarmTransaction[];
  replacePendingTransaction(tx: SwarmTransaction): boolean;
}): Promise<SwarmTransaction[]> {
  const donations = chain.getPendingTransactions().filter((tx) => isGossipedChainTx(tx) && isVaultGift(tx));
  if (donations.length === 0) return [];
  const [{ getCurrentUser, getCachedPrivateKey }, { signWalletTip, verifyPoolDonation, verifyVaultDonation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/blockchain/wallets/tipSignature"),
  ]);
  const verify = (tx: SwarmTransaction) => (tx.type === "pool_donate" ? verifyPoolDonation(tx) : verifyVaultDonation(tx));
  const me = getCurrentUser();
  const out: SwarmTransaction[] = [];
  for (const tx of donations) {
    if (await verify(tx)) { out.push(tx); continue; }
    if (!me || tx.from !== me.id || tx.signature) continue;
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) continue;
    const signed = await signWalletTip({ ...tx, publicKey: me.publicKey }, privateKey);
    if (await verify(signed) && chain.replacePendingTransaction(signed)) out.push(signed);
  }
  return out;
}

/** Announce a local credit transfer to the mesh (queued until gossip starts). */
export function publishCreditTransfer(transaction: CreditTransaction): void {
  if (instance) instance.publishCreditTransfer(transaction);
  else queuedCredits.push(transaction);
}
