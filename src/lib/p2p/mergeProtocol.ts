/**
 * Account merge handshake over a direct mesh link (channel `account-merge`).
 *
 * Pure pull: an incoming offer is only remembered in memory. Nothing toasts,
 * notifies or plays a sound; the acceptor sees it only when they open
 * Settings → Security → Merge Account (which also probes connected peers).
 *
 *   initiator (A)                         acceptor (B)
 *   merge:offer  ───────────────────────▶ (held silently)
 *                ◀─────────────────────── merge:probe (B opened the panel)
 *                ◀─────────────────────── merge:accept-code {proof = HMAC(code, …)}
 *   merge:paired {proof'} ──────────────▶ (B checks A also knew the code)
 *   merge:summary ◀────────────────────▶ merge:summary
 *   merge:select-master ◀──────────────▶ merge:select-master (mirrored)
 *   merge:authorized ◀─────────────────▶ merge:authorized (local password)
 *   merge:execute ─────────────────────▶ retiring side runs the sweep
 *   merge:union ◀──────────────────────── signed attestation + data
 *   merge:ack ──────────────────────────▶ master's signed acknowledgement
 *                ◀─────────────────────── merge:complete (tombstoned)
 *
 * The code never crosses the wire: each side proves knowledge of it with an
 * HMAC over the session, its identity and a fresh nonce. Three wrong codes or
 * three minutes end the session.
 */

import type { AccountMergedAttestation } from "@/types";
import type { MasterMergeAck, MergeAccountSummary, MergeIdentityRef, MergeUnionBundle } from "../blockchain/accountMerge";

export const MERGE_CHANNEL = "account-merge";
export const MERGE_CODE_TTL_MS = 3 * 60 * 1000;
export const MERGE_MAX_CODE_ATTEMPTS = 3;
/** After pairing, an idle session ends after this long. */
export const MERGE_SESSION_IDLE_MS = 15 * 60 * 1000;
export const MERGE_ACK_TIMEOUT_MS = 90 * 1000;
const UNION_PART_BYTES = 48 * 1024;

// ── Code + proofs ──────────────────────────────────────────────────────

/** Cryptographically random 6-digit code (rejection sampling, no modulo bias). */
export function generateMergeCode(random: (buf: Uint32Array) => Uint32Array = (b) => crypto.getRandomValues(b)): string {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  for (;;) {
    const n = random(buf)[0];
    if (n < limit) return String(n % 1_000_000).padStart(6, "0");
  }
}

export function formatMergeCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3, 6)}`;
}

export function normalizeMergeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mergeCodeProof(code: string, parts: { sessionId: string; role: "initiator" | "acceptor"; userId: string; nonce: string }): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`swarm-merge-code-v1:${code}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = new TextEncoder().encode(`${parts.sessionId}|${parts.role}|${parts.userId}|${parts.nonce}`);
  return hex(await crypto.subtle.sign("HMAC", key, msg));
}

/** Constant-time string comparison for hex proofs. */
export function proofsEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
}

// ── Wire messages ──────────────────────────────────────────────────────

export interface MergePeerIdentity {
  userId: string;
  username: string;
  displayName?: string;
  discriminator?: string | null;
  publicKey: string;
}

export type MergeMessage =
  | { kind: "merge:offer"; sessionId: string; from: MergePeerIdentity; expiresAt: number }
  | { kind: "merge:probe" }
  | { kind: "merge:decline"; sessionId: string }
  | { kind: "merge:cancel"; sessionId: string; reason?: string }
  | { kind: "merge:accept-code"; sessionId: string; from: MergePeerIdentity; nonce: string; proof: string }
  | { kind: "merge:code-rejected"; sessionId: string; attemptsLeft: number }
  | { kind: "merge:paired"; sessionId: string; proof: string }
  | { kind: "merge:summary"; sessionId: string; summary: MergeAccountSummary }
  | { kind: "merge:select-master"; sessionId: string; masterUserId: string; seq: number }
  | { kind: "merge:authorized"; sessionId: string; userId: string; masterUserId: string }
  | { kind: "merge:execute"; sessionId: string }
  | { kind: "merge:progress"; sessionId: string; step: string }
  | { kind: "merge:union-part"; sessionId: string; index: number; total: number; posts: MergeUnionBundle["posts"] }
  | { kind: "merge:union"; sessionId: string; parts: number; bundle: Omit<MergeUnionBundle, "posts"> }
  | { kind: "merge:ack"; sessionId: string; ack: MasterMergeAck; result: { postsReattributed: number; contactsAdded: number } }
  | { kind: "merge:complete"; sessionId: string; tombstoned: boolean }
  | { kind: "merge:failed"; sessionId: string; error: string };

// ── Session state ──────────────────────────────────────────────────────

export type MergePhase =
  | "idle"
  | "offering" // A: showing the code, waiting
  | "entering-code" // B: accepted, typing the code
  | "verifying" // B: proof sent
  | "paired" // both: comparison, master selection, passwords
  | "executing"
  | "done"
  | "failed"
  | "cancelled"
  | "expired"
  | "declined";

export interface MergeOffer {
  sessionId: string;
  peerId: string;
  from: MergePeerIdentity;
  expiresAt: number;
}

export interface MergeSessionView {
  sessionId: string;
  role: "initiator" | "acceptor";
  phase: MergePhase;
  remotePeerId: string;
  remote: MergePeerIdentity | null;
  /** Only on the initiator. */
  code: string | null;
  expiresAt: number;
  attemptsLeft: number;
  localSummary: MergeAccountSummary | null;
  remoteSummary: MergeAccountSummary | null;
  masterUserId: string | null;
  localAuthorized: boolean;
  remoteAuthorized: boolean;
  progress: string[];
  error: string | null;
  /** Retiring side, after completion. */
  retired: { masterId: string; masterUsername: string; tombstoned: boolean; attestation?: AccountMergedAttestation } | null;
  /** Master side, after completion. */
  absorbed: { postsReattributed: number; contactsAdded: number } | null;
}

export interface MergeTransport {
  send(channel: string, peerId: string, payload: unknown): Promise<boolean> | boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
}

/** Side effects the controller delegates (ledger, storage, keys). */
export interface MergeExecutor {
  localIdentity(): MergePeerIdentity | null;
  verifyIdentity(identity: MergePeerIdentity): Promise<boolean>;
  buildSummary(): Promise<MergeAccountSummary>;
  unlock(password: string): Promise<string>;
  sweep(master: MergeIdentityRef, onStep: (step: string) => void): Promise<{ txs: MergeUnionBundle["txs"]; creditTxId: string | null; swarm: number; credits: number; mintme: number; mintmeOnChain: MergeUnionBundle["mintmeOnChain"] }>;
  collect(retiringId: string): Promise<Omit<MergeUnionBundle, "attestation" | "txs" | "mintmeOnChain">>;
  attest(input: { retiringId: string; masterId: string; transfers: AccountMergedAttestation["transfers"]; privateKey: string; publicKey: string }): Promise<AccountMergedAttestation>;
  acceptOnMaster(input: { bundle: MergeUnionBundle; privateKey: string; retiring: { userId: string; username: string } }): Promise<{ ack: MasterMergeAck; postsReattributed: number; contactsAdded: number }>;
  retire(input: { privateKey: string; attestation: AccountMergedAttestation; ack: MasterMergeAck; masterUsername: string }): Promise<{ tombstoned: boolean }>;
}

type Listener = () => void;

function isIdentity(v: unknown): v is MergePeerIdentity {
  const i = v as MergePeerIdentity;
  return !!i && typeof i === "object" && typeof i.userId === "string" && i.userId.length > 0 && i.userId.length <= 128
    && typeof i.username === "string" && i.username.length <= 128 && typeof i.publicKey === "string" && i.publicKey.length <= 1024;
}

function chunkPosts(posts: MergeUnionBundle["posts"]): Array<MergeUnionBundle["posts"]> {
  const parts: Array<MergeUnionBundle["posts"]> = [];
  let current: MergeUnionBundle["posts"] = [];
  let size = 0;
  for (const post of posts) {
    const bytes = JSON.stringify(post).length;
    if (current.length > 0 && size + bytes > UNION_PART_BYTES) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(post);
    size += bytes;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * One merge session at a time per device. React subscribes to `snapshot()`.
 */
export class MergeController {
  private transport: MergeTransport | null = null;
  private executor: MergeExecutor | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private offers = new Map<string, MergeOffer>();
  private session: MergeSessionView | null = null;
  private enteredCode: string | null = null;
  private acceptNonce: string | null = null;
  private selectSeq = 0;
  private privateKey: string | null = null;
  private unionParts = new Map<number, MergeUnionBundle["posts"]>();
  private pendingAck: ((ack: MasterMergeAck | null) => void) | null = null;
  private lastActivity = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  attach(transport: MergeTransport, executor: MergeExecutor): void {
    this.detach();
    this.transport = transport;
    this.executor = executor;
    this.unsubscribe = transport.onMessage(MERGE_CHANNEL, (peerId, payload) => {
      void this.handle(peerId, payload).catch((err) => console.warn("[merge] message failed", err));
    });
    if (typeof setInterval === "function") this.timer = setInterval(() => this.tick(), 1000);
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.transport = null;
  }

  isAttached(): boolean {
    return this.transport !== null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): { session: MergeSessionView | null; offers: MergeOffer[] } {
    const now = this.now();
    const connected = new Set(this.transport?.getConnectedPeerIds() ?? []);
    const offers = [...this.offers.values()].filter((o) => o.expiresAt > now && connected.has(o.peerId));
    return { session: this.session, offers };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* listener error */ }
    }
  }

  private update(patch: Partial<MergeSessionView>): void {
    if (!this.session) return;
    this.session = { ...this.session, ...patch };
    this.lastActivity = this.now();
    this.emit();
  }

  private send(peerId: string, msg: MergeMessage): void {
    try { void this.transport?.send(MERGE_CHANNEL, peerId, msg); } catch { /* peer gone */ }
  }

  private sendRemote(msg: MergeMessage): void {
    if (this.session) this.send(this.session.remotePeerId, msg);
  }

  /** Expire codes and idle sessions. Exposed for tests. */
  tick(): void {
    const now = this.now();
    let changed = false;
    for (const [id, offer] of this.offers) {
      if (offer.expiresAt <= now) { this.offers.delete(id); changed = true; }
    }
    const s = this.session;
    if (s && (s.phase === "offering" || s.phase === "entering-code" || s.phase === "verifying") && s.expiresAt <= now) {
      this.session = { ...s, phase: "expired", code: null };
      this.enteredCode = null;
      changed = true;
    } else if (s && s.phase === "paired" && now - this.lastActivity > MERGE_SESSION_IDLE_MS) {
      this.sendRemote({ kind: "merge:cancel", sessionId: s.sessionId, reason: "idle" });
      this.session = { ...s, phase: "expired" };
      this.privateKey = null;
      changed = true;
    }
    if (changed) this.emit();
  }

  private blankSession(role: "initiator" | "acceptor", sessionId: string, remotePeerId: string, remote: MergePeerIdentity | null, expiresAt: number): MergeSessionView {
    return {
      sessionId, role, phase: "idle", remotePeerId, remote, code: null, expiresAt,
      attemptsLeft: MERGE_MAX_CODE_ATTEMPTS, localSummary: null, remoteSummary: null,
      masterUserId: null, localAuthorized: false, remoteAuthorized: false,
      progress: [], error: null, retired: null, absorbed: null,
    };
  }

  private busy(): boolean {
    const p = this.session?.phase;
    return p === "executing";
  }

  // ── Initiator (Device A) ──────────────────────────────────────────

  initiate(peerId: string): string {
    if (!this.transport || !this.executor) throw new Error("The mesh is not running yet.");
    if (this.busy()) throw new Error("A merge is already running.");
    const me = this.executor.localIdentity();
    if (!me) throw new Error("Sign in first.");
    if (!this.transport.getConnectedPeerIds().includes(peerId)) throw new Error("That device is no longer connected.");
    this.resetSecrets();
    const sessionId = crypto.randomUUID();
    const expiresAt = this.now() + MERGE_CODE_TTL_MS;
    this.session = { ...this.blankSession("initiator", sessionId, peerId, null, expiresAt), phase: "offering", code: generateMergeCode() };
    this.lastActivity = this.now();
    this.send(peerId, { kind: "merge:offer", sessionId, from: me, expiresAt });
    this.emit();
    return sessionId;
  }

  // ── Acceptor (Device B) ───────────────────────────────────────────

  /** Opening the panel asks connected peers to re-send any open offer. */
  probe(): void {
    for (const peerId of this.transport?.getConnectedPeerIds() ?? []) this.send(peerId, { kind: "merge:probe" });
  }

  accept(sessionId: string): void {
    const offer = this.offers.get(sessionId);
    if (!offer || offer.expiresAt <= this.now()) throw new Error("That merge offer has expired.");
    if (this.busy()) throw new Error("A merge is already running.");
    this.resetSecrets();
    this.session = { ...this.blankSession("acceptor", sessionId, offer.peerId, offer.from, offer.expiresAt), phase: "entering-code" };
    this.lastActivity = this.now();
    this.emit();
  }

  decline(sessionId: string): void {
    const offer = this.offers.get(sessionId);
    if (!offer) return;
    this.offers.delete(sessionId);
    this.send(offer.peerId, { kind: "merge:decline", sessionId });
    this.emit();
  }

  async submitCode(input: string): Promise<void> {
    const s = this.session;
    const me = this.executor?.localIdentity();
    if (!s || s.role !== "acceptor" || (s.phase !== "entering-code" && s.phase !== "verifying") || !me) return;
    const code = normalizeMergeCode(input);
    if (code.length !== 6) throw new Error("Enter all six digits.");
    this.enteredCode = code;
    this.acceptNonce = randomNonce();
    const proof = await mergeCodeProof(code, { sessionId: s.sessionId, role: "acceptor", userId: me.userId, nonce: this.acceptNonce });
    this.update({ phase: "verifying", error: null });
    this.sendRemote({ kind: "merge:accept-code", sessionId: s.sessionId, from: me, nonce: this.acceptNonce, proof });
  }

  // ── Both sides after pairing ──────────────────────────────────────

  selectMaster(masterUserId: string): void {
    const s = this.session;
    if (!s || s.phase !== "paired" || !s.localSummary || !s.remoteSummary) return;
    if (masterUserId !== s.localSummary.userId && masterUserId !== s.remoteSummary.userId) return;
    this.selectSeq += 1;
    this.privateKey = null;
    this.update({ masterUserId, localAuthorized: false, remoteAuthorized: false, error: null });
    this.sendRemote({ kind: "merge:select-master", sessionId: s.sessionId, masterUserId, seq: this.selectSeq });
  }

  async authorize(password: string): Promise<void> {
    const s = this.session;
    if (!s || s.phase !== "paired" || !s.masterUserId || !this.executor) return;
    const key = await this.executor.unlock(password);
    this.privateKey = key;
    this.update({ localAuthorized: true, error: null });
    this.sendRemote({ kind: "merge:authorized", sessionId: s.sessionId, userId: s.localSummary?.userId ?? "", masterUserId: s.masterUserId });
  }

  canExecute(): boolean {
    const s = this.session;
    return !!s && s.phase === "paired" && !!s.masterUserId && s.localAuthorized && s.remoteAuthorized && !!this.privateKey;
  }

  isLocalMaster(): boolean {
    const s = this.session;
    return !!s?.masterUserId && s.masterUserId === s.localSummary?.userId;
  }

  async execute(): Promise<void> {
    const s = this.session;
    if (!s || !this.canExecute()) return;
    if (this.isLocalMaster()) {
      this.update({ phase: "executing", progress: ["Asked the retiring device to start"] });
      this.sendRemote({ kind: "merge:execute", sessionId: s.sessionId });
      return;
    }
    await this.runRetiring();
  }

  cancel(reason = "cancelled"): void {
    const s = this.session;
    if (!s || this.busy()) return;
    if (s.phase !== "done" && s.phase !== "failed") this.sendRemote({ kind: "merge:cancel", sessionId: s.sessionId, reason });
    this.session = null;
    this.resetSecrets();
    this.emit();
  }

  /** Forget a finished session (done / failed / expired). */
  clear(): void {
    if (this.busy()) return;
    this.session = null;
    this.resetSecrets();
    this.emit();
  }

  private resetSecrets(): void {
    this.enteredCode = null;
    this.acceptNonce = null;
    this.privateKey = null;
    this.selectSeq = 0;
    this.unionParts.clear();
    this.pendingAck?.(null);
    this.pendingAck = null;
  }

  private async sendSummary(): Promise<void> {
    const s = this.session;
    if (!s || !this.executor) return;
    try {
      const summary = await this.executor.buildSummary();
      this.update({ localSummary: summary });
      this.sendRemote({ kind: "merge:summary", sessionId: s.sessionId, summary });
    } catch (err) {
      this.update({ error: err instanceof Error ? err.message : "Could not read this account." });
    }
  }

  // ── Retiring side execution ───────────────────────────────────────

  private step(text: string): void {
    const s = this.session;
    if (!s) return;
    this.update({ progress: [...s.progress, text] });
    this.sendRemote({ kind: "merge:progress", sessionId: s.sessionId, step: text });
  }

  private fail(error: string): void {
    const s = this.session;
    if (!s) return;
    this.privateKey = null;
    this.update({ phase: "failed", error });
    this.sendRemote({ kind: "merge:failed", sessionId: s.sessionId, error });
  }

  private async runRetiring(): Promise<void> {
    const s = this.session;
    const ex = this.executor;
    const key = this.privateKey;
    const me = ex?.localIdentity();
    if (!s || !ex || !key || !me || !s.remote || !s.remoteSummary || !s.localSummary) return;
    if (s.masterUserId !== s.remoteSummary.userId) return;
    this.update({ phase: "executing", progress: [], error: null });
    this.step("Merge started on the retiring device");
    const master: MergeIdentityRef = {
      userId: s.remote.userId,
      username: s.remote.username,
      displayName: s.remote.displayName,
      publicKey: s.remote.publicKey,
      coldAddress: s.remoteSummary.coldAddress,
    };
    let attestation: AccountMergedAttestation;
    try {
      const sweep = await ex.sweep(master, (step) => this.step(step));
      this.step("Signing the account_merged attestation");
      attestation = await ex.attest({
        retiringId: me.userId,
        masterId: master.userId,
        transfers: {
          swarm: sweep.swarm,
          credits: sweep.credits,
          mintme: sweep.mintme,
          txIds: [...sweep.txs.map((t) => t.id), ...(sweep.creditTxId ? [sweep.creditTxId] : [])],
        },
        privateKey: key,
        publicKey: me.publicKey,
      });
      this.step("Exporting posts, favorites and contacts");
      const data = await ex.collect(me.userId);
      const parts = chunkPosts(data.posts);
      parts.forEach((posts, index) => this.sendRemote({ kind: "merge:union-part", sessionId: s.sessionId, index, total: parts.length, posts }));
      const ackPromise = new Promise<MasterMergeAck | null>((resolve) => {
        this.pendingAck = resolve;
        setTimeout(() => resolve(null), MERGE_ACK_TIMEOUT_MS);
      });
      this.sendRemote({
        kind: "merge:union",
        sessionId: s.sessionId,
        parts: parts.length,
        bundle: { attestation, txs: sweep.txs, mintmeOnChain: sweep.mintmeOnChain, favorites: data.favorites, connections: data.connections, library: data.library },
      });
      this.step("Waiting for the master account to accept");
      const ack = await ackPromise;
      this.pendingAck = null;
      if (!ack) {
        this.fail("The master device did not acknowledge in time. Balances already sent stay with the master; this account was NOT retired. Reconnect and run the merge again to finish.");
        return;
      }
      this.step("Signing account_tombstone and retiring the recovery vault");
      const retired = await ex.retire({ privateKey: key, attestation, ack, masterUsername: master.username });
      this.privateKey = null;
      this.update({ phase: "done", retired: { masterId: master.userId, masterUsername: master.username, tombstoned: retired.tombstoned, attestation } });
      this.sendRemote({ kind: "merge:complete", sessionId: s.sessionId, tombstoned: retired.tombstoned });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : "The merge stopped unexpectedly.");
    }
  }

  // ── Incoming ──────────────────────────────────────────────────────

  async handle(fromPeer: string, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object" || !this.executor) return;
    const msg = payload as MergeMessage;
    const me = this.executor.localIdentity();
    if (!me) return;

    if (msg.kind === "merge:probe") {
      const s = this.session;
      if (s?.role === "initiator" && s.phase === "offering" && s.remotePeerId === fromPeer && s.expiresAt > this.now()) {
        this.send(fromPeer, { kind: "merge:offer", sessionId: s.sessionId, from: me, expiresAt: s.expiresAt });
      }
      return;
    }

    if (msg.kind === "merge:offer") {
      if (typeof msg.sessionId !== "string" || !isIdentity(msg.from) || typeof msg.expiresAt !== "number") return;
      if (msg.from.userId === me.userId) return;
      // Never trust a peer's clock beyond our own TTL.
      const expiresAt = Math.min(msg.expiresAt, this.now() + MERGE_CODE_TTL_MS);
      if (expiresAt <= this.now()) return;
      if (!(await this.executor.verifyIdentity(msg.from))) return;
      for (const [id, o] of this.offers) if (o.peerId === fromPeer) this.offers.delete(id);
      this.offers.set(msg.sessionId, { sessionId: msg.sessionId, peerId: fromPeer, from: msg.from, expiresAt });
      this.emit(); // silent: only an open panel re-renders
      return;
    }

    const s = this.session;
    if (!s || typeof (msg as { sessionId?: unknown }).sessionId !== "string" || (msg as { sessionId: string }).sessionId !== s.sessionId) {
      if (msg.kind === "merge:cancel" && typeof msg.sessionId === "string" && this.offers.delete(msg.sessionId)) this.emit();
      return;
    }
    if (fromPeer !== s.remotePeerId) return;

    switch (msg.kind) {
      case "merge:decline":
        if (s.role === "initiator" && s.phase === "offering") this.update({ phase: "declined", code: null });
        return;
      case "merge:cancel":
        if (s.phase === "executing") return;
        this.privateKey = null;
        this.update({ phase: "cancelled", code: null, error: msg.reason === "idle" ? "The other device ended the idle session." : null });
        return;
      case "merge:accept-code": {
        if (s.role !== "initiator" || s.phase !== "offering" || !s.code) return;
        if (s.expiresAt <= this.now()) { this.tick(); return; }
        if (!isIdentity(msg.from) || typeof msg.nonce !== "string" || msg.nonce.length > 128 || typeof msg.proof !== "string") return;
        if (msg.from.userId === me.userId || !(await this.executor.verifyIdentity(msg.from))) return;
        const expected = await mergeCodeProof(s.code, { sessionId: s.sessionId, role: "acceptor", userId: msg.from.userId, nonce: msg.nonce });
        if (!proofsEqual(expected, msg.proof)) {
          const attemptsLeft = s.attemptsLeft - 1;
          this.send(fromPeer, { kind: "merge:code-rejected", sessionId: s.sessionId, attemptsLeft });
          if (attemptsLeft <= 0) {
            this.update({ phase: "cancelled", attemptsLeft, code: null, error: "Too many wrong codes. Start again." });
            this.send(fromPeer, { kind: "merge:cancel", sessionId: s.sessionId, reason: "attempts" });
          } else {
            this.update({ attemptsLeft });
          }
          return;
        }
        const proof = await mergeCodeProof(s.code, { sessionId: s.sessionId, role: "initiator", userId: me.userId, nonce: msg.nonce });
        this.update({ phase: "paired", remote: msg.from, code: null });
        this.send(fromPeer, { kind: "merge:paired", sessionId: s.sessionId, proof });
        await this.sendSummary();
        return;
      }
      case "merge:code-rejected":
        if (s.role !== "acceptor" || s.phase !== "verifying") return;
        this.enteredCode = null;
        this.update({ phase: "entering-code", attemptsLeft: Math.max(0, Number(msg.attemptsLeft) || 0), error: "That code did not match. Check the other screen." });
        return;
      case "merge:paired": {
        if (s.role !== "acceptor" || s.phase !== "verifying" || !this.enteredCode || !this.acceptNonce || !s.remote) return;
        const expected = await mergeCodeProof(this.enteredCode, { sessionId: s.sessionId, role: "initiator", userId: s.remote.userId, nonce: this.acceptNonce });
        this.enteredCode = null;
        if (typeof msg.proof !== "string" || !proofsEqual(expected, msg.proof)) {
          this.update({ phase: "failed", error: "The other device could not prove it showed this code. Nothing was shared." });
          this.sendRemote({ kind: "merge:cancel", sessionId: s.sessionId, reason: "proof" });
          return;
        }
        this.update({ phase: "paired", error: null });
        await this.sendSummary();
        return;
      }
      case "merge:summary": {
        // The initiator sends its summary right behind `paired`, so it can
        // land while we are still checking the initiator's proof. Holding it
        // is harmless: a failed proof ends the session.
        if ((s.phase !== "paired" && s.phase !== "verifying") || !s.remote) return;
        const summary = msg.summary;
        if (!summary || summary.userId !== s.remote.userId) return;
        this.update({ remoteSummary: summary });
        return;
      }
      case "merge:select-master": {
        if (s.phase !== "paired" || !s.localSummary || !s.remoteSummary || typeof msg.seq !== "number") return;
        if (msg.masterUserId !== s.localSummary.userId && msg.masterUserId !== s.remoteSummary.userId) return;
        // Last writer wins; a simultaneous tie goes to the initiator's choice.
        const remoteWins = msg.seq > this.selectSeq || (msg.seq === this.selectSeq && s.role === "acceptor");
        if (!remoteWins) return;
        this.selectSeq = msg.seq;
        this.privateKey = null;
        this.update({ masterUserId: msg.masterUserId, localAuthorized: false, remoteAuthorized: false });
        return;
      }
      case "merge:authorized":
        if (s.phase !== "paired" || msg.masterUserId !== s.masterUserId || msg.userId !== s.remote?.userId) return;
        this.update({ remoteAuthorized: true });
        return;
      case "merge:execute":
        if (s.phase !== "paired" || this.isLocalMaster() || !this.canExecute()) return;
        await this.runRetiring();
        return;
      case "merge:progress":
        if (typeof msg.step !== "string") return;
        // The retiring side may press Execute itself: follow it into execution.
        if (s.phase === "paired" && this.isLocalMaster() && this.canExecute()) {
          this.update({ phase: "executing", progress: [msg.step.slice(0, 200)] });
          return;
        }
        if (s.phase !== "executing") return;
        this.update({ progress: [...s.progress, msg.step.slice(0, 200)] });
        return;
      case "merge:union-part":
        if (s.phase !== "executing" || !this.isLocalMaster() || !Array.isArray(msg.posts)) return;
        if (!Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= 1000) return;
        this.unionParts.set(msg.index, msg.posts);
        return;
      case "merge:union": {
        if (s.phase !== "executing" || !this.isLocalMaster() || !this.privateKey || !s.remote) return;
        const parts = Number(msg.parts) || 0;
        const posts: MergeUnionBundle["posts"] = [];
        for (let i = 0; i < parts; i++) {
          const part = this.unionParts.get(i);
          if (!part) {
            this.fail("Some posts did not arrive. Nothing was retired; run the merge again.");
            return;
          }
          posts.push(...part);
        }
        this.unionParts.clear();
        try {
          this.update({ progress: [...(this.session?.progress ?? []), "Verifying attestation and absorbing data"] });
          const result = await this.executor.acceptOnMaster({
            bundle: { ...msg.bundle, posts } as MergeUnionBundle,
            privateKey: this.privateKey,
            retiring: { userId: s.remote.userId, username: s.remote.username },
          });
          this.update({ absorbed: { postsReattributed: result.postsReattributed, contactsAdded: result.contactsAdded } });
          this.sendRemote({ kind: "merge:ack", sessionId: s.sessionId, ack: result.ack, result: { postsReattributed: result.postsReattributed, contactsAdded: result.contactsAdded } });
        } catch (err) {
          this.fail(err instanceof Error ? err.message : "Could not accept the merge.");
        }
        return;
      }
      case "merge:ack":
        if (s.phase !== "executing" || this.isLocalMaster()) return;
        this.pendingAck?.(msg.ack ?? null);
        return;
      case "merge:complete":
        if (s.phase !== "executing" || !this.isLocalMaster()) return;
        this.privateKey = null;
        this.update({ phase: "done", progress: [...s.progress, msg.tombstoned ? "Retiring account tombstoned" : "Retiring account closed"] });
        return;
      case "merge:failed":
        if (s.phase !== "executing" && s.phase !== "paired") return;
        this.privateKey = null;
        this.update({ phase: "failed", error: typeof msg.error === "string" ? msg.error.slice(0, 400) : "The other device stopped the merge." });
        return;
      default:
        return;
    }
  }
}

let shared: MergeController | null = null;

/** App-wide controller, attached lazily to the standalone mesh. */
export function getMergeController(): MergeController {
  if (!shared) shared = new MergeController();
  return shared;
}

export async function ensureMergeAttached(): Promise<MergeController> {
  const controller = getMergeController();
  if (controller.isAttached()) return controller;
  const [{ getSwarmMeshStandalone }, merge, { getCurrentUser }, { computeUserId }] = await Promise.all([
    import("./swarmMesh.standalone"),
    import("../blockchain/accountMerge"),
    import("../auth"),
    import("../crypto"),
  ]);
  const mesh = getSwarmMeshStandalone();
  let cachedDiscriminator: { userId: string; value: string | null } | null = null;
  controller.attach(mesh, {
    localIdentity: () => {
      const me = getCurrentUser();
      if (!me?.publicKey) return null;
      return {
        userId: me.id,
        username: me.username,
        displayName: me.displayName,
        publicKey: me.publicKey,
        discriminator: cachedDiscriminator?.userId === me.id ? cachedDiscriminator.value : null,
      };
    },
    verifyIdentity: async (identity) => {
      try { return (await computeUserId(identity.publicKey)) === identity.userId; } catch { return false; }
    },
    buildSummary: async () => {
      const summary = await merge.buildAccountSummary();
      cachedDiscriminator = { userId: summary.userId, value: summary.discriminator };
      return summary;
    },
    unlock: (password) => merge.unlockForMerge(password),
    sweep: async (master, onStep) => {
      const r = await merge.sweepAssetsToMaster(master, onStep);
      return { txs: r.txs, creditTxId: r.creditTxId, swarm: r.swarm, credits: r.credits, mintme: r.mintme, mintmeOnChain: r.mintmeOnChain };
    },
    collect: (retiringId) => merge.collectUnionData(retiringId),
    attest: (input) => merge.signMergeAttestation(input),
    acceptOnMaster: async (input) => {
      const r = await merge.acceptMergeOnMaster(input);
      return { ack: r.ack, postsReattributed: r.postsReattributed, contactsAdded: r.contactsAdded };
    },
    retire: async (input) => {
      const r = await merge.retireMergedAccount(input);
      return { tombstoned: r.tombstoned };
    },
  });
  // Prime our #discriminator so offers carry it.
  void merge.buildAccountSummary().then((s) => { cachedDiscriminator = { userId: s.userId, value: s.discriminator }; }).catch(() => undefined);
  return controller;
}
