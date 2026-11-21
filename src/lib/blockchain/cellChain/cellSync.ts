/**
 * Passing a cell chain between its members, the way the Swarm mesh passes
 * the shared chain.
 *
 * The messages mirror the mesh's: a live `block` (stamp within 2 minutes of
 * the mesh clock, added if it extends our tip, endorsed, passed on), signed
 * `endorse`ments, `sync-request` / `sync-response` with catch-up marks and
 * pages (chainCatchup.ts), and pending `tx` gossip. Every message names the
 * cell's chain id.
 *
 * Members only: on connecting, each side proves which account it is by
 * signing a fresh challenge with its vault identity key. Chain data goes only
 * to proven members, or to an account the owner invited, and anything from
 * anyone else is dropped.
 */
import { base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { networkNow } from "@/lib/time/networkClock";
import type { BlockSigner } from "../blockHeader";
import { CADENCE_SPACING_MS, FUTURE_LIMIT_MS, planCatchup, type ChainMark } from "../chainCatchup";
import { claimHeight, signEndorsement, verifyEndorsement, type Endorsement, type EndorsementSigner } from "../endorsements";
import type { SwarmBlock, SwarmTransaction } from "../types";
import { CELL_ROSTER_TX, type CellChain } from "./cellChain";
import type { CellChains } from "./cellChains";
import { canonical, type SignedRosterRecord, type TextSigner } from "./roster";

export const CELL_CHAIN_CHANNEL = "cell-chain";

/** What a session needs from the cell engine's connections. */
export interface CellTransport {
  selfPeerId(): string;
  peers(): string[];
  send(peerId: string, payload: unknown): void;
  onMessage(handler: (from: string, payload: unknown) => void): () => void;
  onPeersChange(handler: (peers: string[]) => void): () => void;
}

export interface CellSigners {
  text: TextSigner;
  block: BlockSigner;
  endorse: EndorsementSigner;
}

export interface CellSessionOptions {
  /** The owner's account, when the device knows it: a genesis naming anyone else is refused. */
  expectedOwner?: string;
  signers: () => Promise<CellSigners | null>;
  /** Whether this device mines the cell (the cell engine's mining switch). */
  miningEnabled?: () => boolean;
  now?: () => number;
  /** Where endorsement claims are saved (one agreement per height). */
  claimStore?: Pick<Storage, "getItem" | "setItem"> | null;
}

type Msg = { t: string; chain?: string; cell?: string; [k: string]: unknown };

function helloText(cell: string, nonce: string, from: string, to: string): string {
  return canonical({ v: 1, type: "cell-hello", cell, nonce, from, to });
}

async function verifyText(publicKey: string, signature: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(signature), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class CellSession {
  /** Peers that proved their account: peerId → userId. */
  private verified = new Map<string, string>();
  private challenges = new Map<string, string>();
  private marks = new Map<string, ChainMark>();
  private seenBlocks = new Set<string>();
  private seenTx = new Set<string>();
  private seenEndorsements = new Set<string>();
  /** Signed agreements per block hash: the next block records its parent's. */
  private agreements = new Map<string, Map<string, Endorsement>>();
  private unsubscribe: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private mining = false;
  private now: () => number;

  constructor(
    readonly cellId: string,
    private chains: CellChains,
    private transport: CellTransport,
    private opts: CellSessionOptions,
  ) {
    this.now = opts.now ?? networkNow;
  }

  start(): void {
    this.unsubscribe.push(this.transport.onMessage((from, payload) => { void this.handle(from, payload as Msg); }));
    this.unsubscribe.push(this.transport.onPeersChange((peers) => this.greet(peers)));
    this.greet(this.transport.peers());
    this.timer = setInterval(() => { void this.tick(); }, CADENCE_SPACING_MS / 3);
  }

  stop(): void {
    for (const u of this.unsubscribe.splice(0)) { try { u(); } catch { /* ignore */ } }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The proven account behind a connected peer, if any. */
  accountOf(peerId: string): string | undefined {
    return this.verified.get(peerId);
  }

  // ── Who may receive cell data ──

  private async chain(): Promise<CellChain | null> {
    return this.chains.chain(this.cellId);
  }

  private async allowed(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    const chain = await this.chain();
    if (!chain) return false;
    const roster = chain.getRoster();
    if (roster.isMember(userId) || roster.hasOpenInvite(userId)) return true;
    return chain.getPendingTransactions().some((tx) => {
      const s = tx.type === CELL_ROSTER_TX ? tx.meta?.roster as SignedRosterRecord | undefined : undefined;
      return s?.record.kind === "invite" && s.record.invitee === userId;
    });
  }

  private async allowedPeers(except?: string): Promise<string[]> {
    const out: string[] = [];
    for (const peer of this.transport.peers()) {
      if (peer !== except && await this.allowed(this.verified.get(peer))) out.push(peer);
    }
    return out;
  }

  private async sendAllowed(payload: Msg, except?: string): Promise<void> {
    for (const peer of await this.allowedPeers(except)) this.transport.send(peer, payload);
  }

  // ── Handshake ──

  private greet(peers: string[]): void {
    const live = new Set(peers);
    for (const peer of [...this.verified.keys()]) if (!live.has(peer)) this.verified.delete(peer);
    for (const peer of peers) {
      if (this.verified.has(peer) || this.challenges.has(peer)) continue;
      const nonce = randomNonce();
      this.challenges.set(peer, nonce);
      this.transport.send(peer, { t: "hello", cell: this.cellId, nonce });
    }
  }

  private async answerHello(from: string, msg: Msg): Promise<void> {
    const signers = await this.opts.signers();
    if (!signers || typeof msg.nonce !== "string" || msg.nonce.length > 64) return;
    const text = helloText(this.cellId, msg.nonce, this.transport.selfPeerId(), from);
    this.transport.send(from, {
      t: "proof", cell: this.cellId, nonce: msg.nonce,
      userId: signers.text.userId, publicKey: signers.text.publicKey, signature: await signers.text.signText(text),
    });
  }

  private async checkProof(from: string, msg: Msg): Promise<void> {
    const nonce = this.challenges.get(from);
    if (!nonce || msg.nonce !== nonce) return;
    const { userId, publicKey, signature } = msg as { userId?: unknown; publicKey?: unknown; signature?: unknown };
    if (typeof userId !== "string" || typeof publicKey !== "string" || typeof signature !== "string") return;
    if (await computeUserId(publicKey).catch(() => null) !== userId) return;
    if (!await verifyText(publicKey, signature, helloText(this.cellId, nonce, from, this.transport.selfPeerId()))) return;
    this.challenges.delete(from);
    this.verified.set(from, userId);
    await this.introduce(from, userId);
  }

  /** A proven peer: hand an invitee the cell, and catch up with members. */
  private async introduce(peer: string, userId: string): Promise<void> {
    const chain = await this.chain();
    if (!chain) {
      // We don't have the cell yet: ask for it. Only a valid genesis for this cell is taken.
      this.transport.send(peer, { t: "sync-request", cell: this.cellId, since: null });
      return;
    }
    if (!await this.allowed(userId)) return;
    const genesis = this.chains.genesis(this.cellId);
    if (genesis) this.transport.send(peer, { t: "genesis", cell: this.cellId, chain: chain.chainId, genesis });
    for (const tx of chain.getPendingTransactions()) this.transport.send(peer, { t: "tx", chain: chain.chainId, tx });
    this.transport.send(peer, { t: "sync-request", chain: chain.chainId, since: this.marks.get(peer) ?? null });
  }

  // ── Messages ──

  private async handle(from: string, msg: Msg): Promise<void> {
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    try {
      if (msg.t === "hello") return void await (msg.cell === this.cellId ? this.answerHello(from, msg) : undefined);
      if (msg.t === "proof") return void await (msg.cell === this.cellId ? this.checkProof(from, msg) : undefined);
      const sender = this.verified.get(from);
      if (!sender) return;
      if (msg.t === "genesis") return void await this.takeGenesis(from, msg);
      const chain = await this.chain();
      if (msg.t === "sync-request") return void await this.answerSync(from, sender, msg, chain);
      if (!chain || msg.chain !== chain.chainId || !await this.allowed(sender)) return;
      switch (msg.t) {
        case "sync-response": await this.takeSync(from, msg, chain); break;
        case "block": await this.takeBlock(from, msg.block as SwarmBlock, chain); break;
        case "endorse": await this.takeEndorsement(from, msg.endorsement, chain); break;
        case "tx": await this.takeTx(from, msg.tx as SwarmTransaction, chain); break;
      }
    } catch (err) {
      console.warn("[CellSync] message failed", msg.t, err);
    }
  }

  private async takeGenesis(from: string, msg: Msg): Promise<void> {
    if (this.chains.genesis(this.cellId)) return;
    const genesis = msg.genesis as SignedRosterRecord | undefined;
    if (!genesis || (this.opts.expectedOwner && genesis.record?.kind === "genesis" && genesis.record.owner !== this.opts.expectedOwner)) return;
    if (!await this.chains.setGenesis(this.cellId, genesis)) return;
    const chain = await this.chain();
    if (chain) this.transport.send(from, { t: "sync-request", chain: chain.chainId, since: null });
  }

  private async answerSync(from: string, sender: string, msg: Msg, chain: CellChain | null): Promise<void> {
    if (!chain || !await this.allowed(sender)) return;
    if (msg.chain === undefined) {
      // A peer without the cell yet: an invitee gets the genesis first.
      const genesis = this.chains.genesis(this.cellId);
      if (genesis) this.transport.send(from, { t: "genesis", cell: this.cellId, chain: chain.chainId, genesis });
      return;
    }
    if (msg.chain !== chain.chainId) return;
    const since = msg.since as ChainMark | null | undefined;
    for (const page of planCatchup(chain.getChain(), since)) {
      this.transport.send(from, { t: "sync-response", chain: chain.chainId, ...page });
    }
    // Records and transfers waiting for a block travel with the chain (an invitee's invite among them).
    for (const tx of chain.getPendingTransactions()) this.transport.send(from, { t: "tx", chain: chain.chainId, tx });
  }

  private async takeSync(from: string, msg: Msg, chain: CellChain): Promise<void> {
    const blocks = msg.blocks as SwarmBlock[] | undefined;
    const fromIndex = Number(msg.fromIndex);
    const tip = msg.tip as ChainMark | null | undefined;
    if (tip && Number.isInteger(tip.index) && typeof tip.hash === "string") this.marks.set(from, tip);
    if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isInteger(fromIndex) || fromIndex < 0) return;
    const local = chain.getChain();
    let candidate: SwarmBlock[];
    if (fromIndex === 0) {
      candidate = blocks;
    } else {
      const attachAt = local[fromIndex - 1];
      if (!attachAt || blocks[0]?.previousHash !== attachAt.hash) {
        this.transport.send(from, { t: "sync-request", chain: chain.chainId, since: null });
        return;
      }
      candidate = [...local.slice(0, fromIndex), ...blocks];
    }
    const appended = candidate.length === local.length + 1 && await chain.appendPeerBlock(candidate[candidate.length - 1]);
    if (!appended) await chain.adoptPeerChain(candidate);
    await this.acceptOpenInvite(chain);
  }

  /** An invite for this device's account sits on the chain: accept it. */
  private async acceptOpenInvite(chain: CellChain): Promise<void> {
    const signers = await this.opts.signers();
    const me = signers?.text.userId;
    if (!me || !chain.getRoster().hasOpenInvite(me)) return;
    for (const block of [...chain.getChain()].reverse()) {
      for (const tx of block.transactions) {
        const s = tx.type === CELL_ROSTER_TX ? tx.meta?.roster as SignedRosterRecord | undefined : undefined;
        if (s?.record.kind === "invite" && s.record.invitee === me) return void await this.acceptInviteIfMine(tx, chain);
      }
    }
  }

  private async takeBlock(from: string, block: SwarmBlock, chain: CellChain): Promise<void> {
    if (!block || typeof block.hash !== "string" || typeof block.index !== "number") return;
    if (this.seenBlocks.has(block.hash)) return;
    this.remember(this.seenBlocks, block.hash);
    // A live block was mined moments ago: its stamp must sit near the mesh clock.
    const stamped = Date.parse(String(block.timestamp ?? ""));
    if (!Number.isFinite(stamped) || Math.abs(stamped - this.now()) > FUTURE_LIMIT_MS) return;
    const extendsTip = block.previousHash === chain.getLatestBlock().hash;
    if (await chain.appendPeerBlock(block)) {
      await this.endorse(block, true, chain);
      await this.sendAllowed({ t: "block", chain: chain.chainId, block }, from);
      return;
    }
    // It built on our tip and still failed our checks: say so, signed.
    if (extendsTip && chain.getLatestBlock().hash === block.previousHash) {
      await this.endorse(block, false, chain);
      return;
    }
    if (block.index > chain.getLatestBlock().index) {
      this.transport.send(from, { t: "sync-request", chain: chain.chainId, since: this.marks.get(from) ?? null });
    }
  }

  private async takeEndorsement(from: string, e: unknown, chain: CellChain): Promise<void> {
    const x = e as Endorsement | undefined;
    if (!x || typeof x.blockHash !== "string" || typeof x.voter !== "string") return;
    const key = `${x.blockHash}:${x.voter}`;
    if (this.seenEndorsements.has(key)) return;
    if (!await verifyEndorsement(x, chain.chainId)) return;
    this.remember(this.seenEndorsements, key);
    const producer = chain.getChain().find((b) => b.hash === x.blockHash)?.producer?.userId;
    if (x.voter !== producer) this.keepAgreement(x);
    await this.sendAllowed({ t: "endorse", chain: chain.chainId, endorsement: x }, from);
  }

  private async takeTx(from: string, tx: SwarmTransaction, chain: CellChain): Promise<void> {
    if (!tx || typeof tx.id !== "string" || this.seenTx.has(tx.id)) return;
    this.remember(this.seenTx, tx.id);
    if (!await chain.queue(tx)) return;
    await this.sendAllowed({ t: "tx", chain: chain.chainId, tx }, from);
    await this.acceptInviteIfMine(tx, chain);
  }

  /** An invite for this device's account arrived: accept it (entering the cell was the user's ask to join). */
  private async acceptInviteIfMine(tx: SwarmTransaction, chain: CellChain): Promise<void> {
    const s = tx.type === CELL_ROSTER_TX ? tx.meta?.roster as SignedRosterRecord | undefined : undefined;
    if (s?.record.kind !== "invite") return;
    const signers = await this.opts.signers();
    if (!signers || s.record.invitee !== signers.text.userId || chain.getRoster().isMember(signers.text.userId)) return;
    const accept = await this.chains.accept(this.cellId, s, signers.text, Math.round(this.now()));
    if (accept) await this.share(chain, accept);
  }

  /** Gossip a roster record this device signed. */
  async share(chain: CellChain, s: SignedRosterRecord): Promise<void> {
    const tx = chain.getPendingTransactions().find((p) => p.type === CELL_ROSTER_TX && (p.meta?.roster as SignedRosterRecord | undefined)?.signature === s.signature);
    if (!tx) return;
    this.remember(this.seenTx, tx.id);
    await this.sendAllowed({ t: "tx", chain: chain.chainId, tx });
  }

  // ── Endorsing and mining ──

  private keepAgreement(e: Endorsement): void {
    if (!e.agree) return;
    const byVoter = this.agreements.get(e.blockHash) ?? new Map<string, Endorsement>();
    if (!byVoter.has(e.voter)) byVoter.set(e.voter, e);
    this.agreements.set(e.blockHash, byVoter);
    while (this.agreements.size > 64) {
      const oldest = this.agreements.keys().next().value;
      if (oldest === undefined) break;
      this.agreements.delete(oldest);
    }
  }

  private async endorse(block: SwarmBlock, agree: boolean, chain: CellChain): Promise<void> {
    const signers = await this.opts.signers();
    if (!signers || !chain.getRoster().isMember(signers.endorse.userId)) return;
    if (block.producer?.userId === signers.endorse.userId) return;
    if (agree && !claimHeight(block.index, block.hash, this.opts.claimStore, chain.chainId)) return;
    const e = await signEndorsement(block, agree, signers.endorse, Math.round(this.now()), chain.chainId);
    this.remember(this.seenEndorsements, `${e.blockHash}:${e.voter}`);
    this.keepAgreement(e);
    await this.sendAllowed({ t: "endorse", chain: chain.chainId, endorsement: e });
  }

  /** One mining attempt per beat, while the mining switch is on. */
  async tick(): Promise<SwarmBlock | null> {
    if (this.mining || !this.opts.miningEnabled?.()) return null;
    this.mining = true;
    try {
      const chain = await this.chain();
      const signers = await this.opts.signers();
      if (!chain || !signers || !chain.getRoster().isMember(signers.block.userId)) return null;
      const witnesses = [...(this.agreements.get(chain.getLatestBlock().hash)?.values() ?? [])];
      const block = await chain.mine(signers.block, witnesses);
      if (!block) return null;
      this.remember(this.seenBlocks, block.hash);
      await this.sendAllowed({ t: "block", chain: chain.chainId, block });
      return block;
    } finally {
      this.mining = false;
    }
  }

  private remember(set: Set<string>, key: string): void {
    set.add(key);
    if (set.size > 5_000) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }
}
