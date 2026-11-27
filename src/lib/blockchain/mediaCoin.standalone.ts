/**
 * ═══════════════════════════════════════════════════════════════════════
 * Media Coin Courier Engine — Standalone
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Self-contained apart from the shared byte limits in meshUploadLimits.ts
 * (a constants-only module), so the engine and the upload form can never
 * disagree on how large a coin may be.
 *
 * A Media Coin carries one piece of content on its own, without the
 * torrent swarm: send, unpack, display.
 *
 *   1. MINT  — File → encrypted chunks → Merkle root. The chunks are
 *      written once to a chunk store keyed by merkleRoot + index.
 *   2. OFFER — `coin-pass-offer` {coinId, merkleRoot, size, isSupport}
 *      goes to one connected peer. The receiver checks the merkleRoot:
 *        refused list  → "refused"      (0 bytes)
 *        already held  → "already-held" (0 bytes; it takes the coin on)
 *        otherwise     → "accept" (with the chunk indices it already has)
 *   3. STREAM — accepted coins send their chunks one at a time, waiting
 *      while the link's buffered amount is above 128 KB and while too
 *      many chunks are unacknowledged. A dropped link resumes from the
 *      chunks the receiver acknowledged.
 *   4. VERIFY — every chunk hash, then the final Merkle root, before the
 *      receiver unpacks and passes the coin on.
 *   5. LOOP  — each holder appends itself to the route and offers the coin
 *      to a connected peer it has not visited, until it returns home.
 *
 * Content identity is the merkleRoot, never the coinId: every hollow coin
 * gets its own coinId when mined, so one piece of content can ride many
 * coins (the original and any Support Coins) and is stored only once.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { MEDIA_COIN_PASS_MAX_BYTES } from "@/lib/media/meshUploadLimits";

export { MEDIA_COIN_PASS_MAX_BYTES };

// ── Inline Crypto Helpers ─────────────────────────────────────────────

function ab2b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const BLOCK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + BLOCK, bytes.length)));
  }
  return btoa(binary);
}

function b642ab(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function ab2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(data: string): Promise<string> {
  return ab2hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
}

function genId(prefix = "mc"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Types ──────────────────────────────────────────────────────────────

/** The content manifest engraved in a coin. */
export interface MediaCoinManifest {
  /** The coin carrying this copy of the manifest (changes per coin). */
  coinId: string;
  tokenId: string;
  name: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  /** Ordered SHA-256 hashes of each (encrypted, base64) chunk. */
  chunkHashes: string[];
  /** Content identity: Merkle root over chunkHashes. */
  merkleRoot: string;
  codec?: string;
  duration?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  /** The post this content belongs to, when it was posted. */
  postId?: string;
  /** Who first minted the content (stays the same on Support Coins). */
  creatorId: string;
  mintedAt: number;
  /** AES-GCM key (base64). Rides only direct offers, never broadcasts. */
  encryptionKey?: string;
  encryptionIvPrefix?: string;
  /** Set on a Support Coin: who engraved the content into their own coin. */
  supporter?: { id: string; name?: string };
}

/** Route a travelling coin carries: whose loop it is and who has held it. */
export interface MediaCoinRoute {
  /** Home of this coin's loop: the peer that launched this coinId. */
  creatorId: string;
  /** Peer ids that have held this coin, launcher first, in visit order. */
  hops: string[];
  /** Hand-offs left before the coin heads home. */
  ttl: number;
}

/** A coin whose content arrived whole and verified. */
export interface MediaCoinUnpacked {
  manifest: MediaCoinManifest;
  route: MediaCoinRoute;
  fromPeerId: string;
  /** Plaintext file bytes (decrypted), read from the chunk store on demand. */
  readBytes(): Promise<Uint8Array | null>;
}

/** A coin offered for content this node already held (0 bytes moved). */
export interface MediaCoinAlreadyHeld {
  manifest: MediaCoinManifest;
  route: MediaCoinRoute;
  fromPeerId: string;
}

export interface MediaCoinLoopComplete {
  coinId: string;
  merkleRoot: string;
  route: MediaCoinRoute;
}

export type MediaCoinOfferReply = "accept" | "already-held" | "refused";

/** Thin adapter — same interface TorrentSwarm uses. */
export interface MeshTransportAdapter {
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  broadcast(channel: string, payload: unknown): void;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
  /** Bytes queued on the link to a peer; the sender waits while it is high. */
  getBufferedAmount?(peerId: string): number;
  localPeerId: string;
}

/**
 * Where chunks and manifests live: written once per merkleRoot. The app
 * uses the IndexedDB content store; the default keeps them in memory.
 */
export interface MediaCoinChunkStore {
  getManifest(merkleRoot: string): Promise<MediaCoinManifest | null>;
  putManifest(manifest: MediaCoinManifest, complete: boolean): Promise<void>;
  isComplete(merkleRoot: string): Promise<boolean>;
  putChunk(merkleRoot: string, index: number, data: string): Promise<void>;
  getChunk(merkleRoot: string, index: number): Promise<string | null>;
  heldIndices(merkleRoot: string): Promise<number[]>;
  deleteContent(merkleRoot: string): Promise<void>;
}

export class MemoryChunkStore implements MediaCoinChunkStore {
  private manifests = new Map<string, { manifest: MediaCoinManifest; complete: boolean }>();
  private chunks = new Map<string, Map<number, string>>();
  async getManifest(root: string) { return this.manifests.get(root)?.manifest ?? null; }
  async putManifest(manifest: MediaCoinManifest, complete: boolean) {
    const prev = this.manifests.get(manifest.merkleRoot);
    this.manifests.set(manifest.merkleRoot, { manifest: prev?.manifest ?? manifest, complete: complete || Boolean(prev?.complete) });
  }
  async isComplete(root: string) { return Boolean(this.manifests.get(root)?.complete); }
  async putChunk(root: string, index: number, data: string) {
    if (!this.chunks.has(root)) this.chunks.set(root, new Map());
    this.chunks.get(root)!.set(index, data);
  }
  async getChunk(root: string, index: number) { return this.chunks.get(root)?.get(index) ?? null; }
  async heldIndices(root: string) { return Array.from(this.chunks.get(root)?.keys() ?? []).sort((a, b) => a - b); }
  async deleteContent(root: string) { this.manifests.delete(root); this.chunks.delete(root); }
}

/** A plaintext source the minter reads twice (hash pass, then store pass). */
export interface MediaCoinSource {
  name: string;
  type: string;
  size: number;
  /** Yields the plaintext in order; called once per pass. */
  pieces(): AsyncIterable<Uint8Array>;
}

export interface MediaCoinEngineOptions {
  store?: MediaCoinChunkStore;
  /** Device-local refusal list, checked at offer time. */
  isRefused?: (merkleRoot: string) => boolean;
}

// ── Constants ──────────────────────────────────────────────────────────

const CHANNEL = "media-coin";
/** Default hand-offs before a travelling coin heads home. */
export const MEDIA_COIN_LOOP_TTL = 16;
/** The sender waits while more than this is queued on the link. */
export const MEDIA_COIN_BUFFER_HIGH_WATER = 128 * 1024;
/** Chunks sent but not yet acknowledged before the sender waits. */
export const MEDIA_COIN_ACK_WINDOW = 8;
const BUFFER_POLL_MS = 25;
const OFFER_REPLY_MS = 20_000;
const ACK_STALL_MS = 30_000;
const DONE_MS = 60_000;
const SEEN_CAP = 500;
/** Unfinished incoming passes kept at once (their chunks stay stored for resume). */
const MAX_INCOMING = 32;
const HOLD_RETRY_MS = 5_000;

/** Adaptive chunk size: 256 KB for small files up to 1 MB for large ones. */
export function mediaCoinChunkSizeFor(totalBytes: number): number {
  if (totalBytes <= 16 * 1024 * 1024) return 256 * 1024;
  if (totalBytes <= 128 * 1024 * 1024) return 512 * 1024;
  return 1024 * 1024;
}

// ── Message Protocol ──────────────────────────────────────────────────

type MsgType =
  | "coin-pass-offer"       // sender → receiver: manifest, route, merkleRoot, size, isSupport
  | "coin-pass-offer-reply" // receiver → sender: accept | already-held | refused
  | "coin-chunk"            // sender → receiver: one chunk, keyed by merkleRoot + index
  | "coin-chunk-ack"        // receiver → sender: that chunk is verified and stored
  | "coin-pass-done";       // receiver → sender: Merkle root verified, coin unpacked

interface MediaCoinMessage {
  type: MsgType;
  coinId: string;
  payload: unknown;
  msgId?: string;
}

interface OfferPayload {
  offerId: string;
  merkleRoot: string;
  size: number;
  isSupport: boolean;
  manifest: MediaCoinManifest;
  route: MediaCoinRoute;
}

// ── Merkle Tree ───────────────────────────────────────────────────────

async function buildMerkleRoot(hashes: string[]): Promise<string> {
  if (hashes.length === 0) return "";
  if (hashes.length === 1) return hashes[0];
  let layer = [...hashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(await sha256hex(layer[i] + (layer[i + 1] ?? layer[i])));
    }
    layer = next;
  }
  return layer[0];
}

async function buildMerkleProof(hashes: string[], targetIndex: number): Promise<{ hash: string; position: "left" | "right" }[]> {
  if (hashes.length <= 1) return [];
  const proof: { hash: string; position: "left" | "right" }[] = [];
  let layer = [...hashes];
  let idx = targetIndex;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      if (i === idx || i + 1 === idx) {
        proof.push(idx % 2 === 0 ? { hash: right, position: "right" } : { hash: left, position: "left" });
      }
      next.push(await sha256hex(left + right));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

async function verifyMerkleProof(chunkHash: string, proof: { hash: string; position: "left" | "right" }[], merkleRoot: string): Promise<boolean> {
  let current = chunkHash;
  for (const step of proof) {
    current = step.position === "right" ? await sha256hex(current + step.hash) : await sha256hex(step.hash + current);
  }
  return current === merkleRoot;
}

// ── Chunk crypto ──────────────────────────────────────────────────────

function chunkIv(ivPrefixB64: string, index: number): Uint8Array {
  const iv = new Uint8Array(12);
  iv.set(new Uint8Array(b642ab(ivPrefixB64)).subarray(0, 4), 0);
  new DataView(iv.buffer).setUint32(4, index);
  return iv;
}

async function importCoinKey(manifest: MediaCoinManifest): Promise<CryptoKey | null> {
  if (!manifest.encryptionKey || !manifest.encryptionIvPrefix) return null;
  return crypto.subtle.importKey("raw", b642ab(manifest.encryptionKey), { name: "AES-GCM" }, false, ["decrypt"]);
}

/** Decrypt one stored chunk of a coin's content (plaintext when unencrypted). */
export async function decryptMediaCoinChunk(
  manifest: MediaCoinManifest,
  index: number,
  data: string,
  key?: CryptoKey | null,
): Promise<Uint8Array> {
  const k = key === undefined ? await importCoinKey(manifest) : key;
  const buf = b642ab(data);
  if (!k || !manifest.encryptionIvPrefix) return new Uint8Array(buf);
  const iv = chunkIv(manifest.encryptionIvPrefix, index);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, k, buf));
}

/** Plaintext of a coin's content, one decrypted chunk at a time. */
export async function* readMediaCoinPlaintext(
  manifest: MediaCoinManifest,
  store: MediaCoinChunkStore,
): AsyncGenerator<Uint8Array> {
  const key = await importCoinKey(manifest);
  for (let i = 0; i < manifest.totalChunks; i++) {
    const data = await store.getChunk(manifest.merkleRoot, i);
    if (data == null) throw new Error(`chunk ${i} of ${manifest.merkleRoot.slice(0, 12)} missing`);
    yield await decryptMediaCoinChunk(manifest, i, data, key);
  }
}

/** Re-cut a stream of plaintext pieces into fixed-size chunks. */
async function* rechunk(pieces: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  let buf = new Uint8Array(0);
  for await (const piece of pieces) {
    if (!piece.byteLength) continue;
    const merged = new Uint8Array(buf.byteLength + piece.byteLength);
    merged.set(buf, 0);
    merged.set(piece, buf.byteLength);
    buf = merged;
    while (buf.byteLength >= size) {
      yield buf.slice(0, size);
      buf = buf.slice(size);
    }
  }
  if (buf.byteLength) yield buf;
}

/** Wrap bytes or a File/Blob as a MediaCoinSource read slice by slice. */
export function mediaCoinSourceOf(file: File | Blob | { name: string; type: string; data: Uint8Array }, name?: string): MediaCoinSource {
  if ("data" in file) {
    const data = file.data;
    return {
      name: file.name, type: file.type, size: data.byteLength,
      async *pieces() { for (let i = 0; i < data.byteLength; i += 1024 * 1024) yield data.subarray(i, Math.min(i + 1024 * 1024, data.byteLength)); },
    };
  }
  const blob = file as Blob;
  return {
    name: name ?? (file as File).name ?? "file",
    type: blob.type,
    size: blob.size,
    async *pieces() {
      for (let i = 0; i < blob.size; i += 1024 * 1024) {
        yield new Uint8Array(await blob.slice(i, Math.min(i + 1024 * 1024, blob.size)).arrayBuffer());
      }
    },
  };
}

export interface MintOptions {
  encrypt?: boolean;
  /** Real mined wallet coin id to engrave onto; generated when absent. */
  coinId?: string;
  postId?: string;
  codec?: string;
  duration?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  /** Override the adaptive chunk size (tests). */
  chunkSize?: number;
  onProgress?: (p: { phase: "hashing" | "storing"; percent: number }) => void;
}

/**
 * Mint content into a chunk store. Two passes over the source keep memory
 * at one chunk: the first hashes the encrypted chunks (AES-GCM is fixed
 * for a fixed key and IV), the second stores them under the Merkle root.
 */
export async function mintMediaCoinContent(
  source: MediaCoinSource,
  creatorId: string,
  store: MediaCoinChunkStore,
  options: MintOptions = {},
): Promise<MediaCoinManifest> {
  if (source.size > MEDIA_COIN_PASS_MAX_BYTES) {
    throw new Error(`media coin content is limited to ${MEDIA_COIN_PASS_MAX_BYTES} bytes`);
  }
  const chunkSize = options.chunkSize ?? mediaCoinChunkSizeFor(source.size);
  let key: CryptoKey | null = null;
  let keyB64: string | undefined;
  let ivPrefix: string | undefined;
  if (options.encrypt) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    keyB64 = ab2b64(await crypto.subtle.exportKey("raw", key));
    ivPrefix = ab2b64(crypto.getRandomValues(new Uint8Array(4)));
  }
  const encode = async (plain: Uint8Array, index: number): Promise<string> => {
    if (!key || !ivPrefix) return ab2b64(plain);
    const iv = chunkIv(ivPrefix, index);
    return ab2b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource));
  };
  const totalChunks = Math.max(1, Math.ceil(source.size / chunkSize));
  const pct = (i: number) => Math.round(((i + 1) / totalChunks) * 100);

  // Pass 1: hashes → Merkle root.
  const chunkHashes: string[] = [];
  let index = 0;
  let bytes = 0;
  for await (const plain of rechunk(source.pieces(), chunkSize)) {
    chunkHashes.push(await sha256hex(await encode(plain, index)));
    bytes += plain.byteLength;
    options.onProgress?.({ phase: "hashing", percent: pct(index) });
    index++;
  }
  if (index === 0) {
    chunkHashes.push(await sha256hex(await encode(new Uint8Array(0), 0)));
    index = 1;
  }
  if (bytes !== source.size) throw new Error("media coin source changed size while minting");
  const merkleRoot = await buildMerkleRoot(chunkHashes);
  const manifest: MediaCoinManifest = {
    coinId: options.coinId ?? genId("media-coin"),
    tokenId: genId("nft"),
    name: source.name,
    mimeType: source.type || "application/octet-stream",
    totalSize: source.size,
    chunkSize,
    totalChunks: index,
    chunkHashes,
    merkleRoot,
    codec: options.codec,
    duration: options.duration,
    mediaWidth: options.mediaWidth,
    mediaHeight: options.mediaHeight,
    postId: options.postId,
    creatorId,
    mintedAt: Date.now(),
    encryptionKey: keyB64,
    encryptionIvPrefix: ivPrefix,
  };

  // Pass 2: store each chunk, checking it still matches pass 1.
  await store.putManifest(manifest, false);
  index = 0;
  const pieces = source.size === 0 ? (async function* () { yield new Uint8Array(0); })() : rechunk(source.pieces(), chunkSize);
  for await (const plain of pieces) {
    const data = await encode(plain, index);
    if ((await sha256hex(data)) !== chunkHashes[index]) throw new Error("media coin source changed while minting");
    await store.putChunk(merkleRoot, index, data);
    options.onProgress?.({ phase: "storing", percent: pct(index) });
    index++;
  }
  await store.putManifest(manifest, true);
  return manifest;
}

// ═══════════════════════════════════════════════════════════════════════
// MEDIA COIN ENGINE
// ═══════════════════════════════════════════════════════════════════════

interface Incoming {
  offerId: string;
  coinId: string;
  from: string;
  manifest: MediaCoinManifest;
  route: MediaCoinRoute;
  received: Set<number>;
  finalizing: boolean;
}

type SendOutcome = "done" | "refused" | "failed";
type OfferReply = { reply: MediaCoinOfferReply | "timeout"; have?: number[] };

export class MediaCoinEngine {
  private transport: MeshTransportAdapter;
  readonly store: MediaCoinChunkStore;
  private isRefused: (root: string) => boolean;

  /** Every coin this node knows: coinId → its manifest (roots may repeat). */
  private coins = new Map<string, MediaCoinManifest>();
  /** Coins waiting for a peer to hand off to; they stay until a hand-off lands. */
  private held = new Map<string, MediaCoinRoute>();
  private sending = new Set<string>();
  /** Peers that refused a root; never offered it again this session. */
  private refusedBy = new Map<string, Set<string>>();
  /** Chunks a peer acknowledged, keyed `${root}|${peer}`, for resume. */
  private acked = new Map<string, Set<number>>();
  private incoming = new Map<string, Incoming>();
  private passedRoutes = new Set<string>();
  private seenMsgs = new Set<string>();
  private replyWaiters = new Map<string, (r: OfferReply) => void>();
  private ackWaiters = new Map<string, (v: void) => void>();
  private doneWaiters = new Map<string, (ok: boolean) => void>();

  private unpackListeners = new Set<(u: MediaCoinUnpacked) => void | Promise<void>>();
  private heldListeners = new Set<(h: MediaCoinAlreadyHeld) => void | Promise<void>>();
  private loopListeners = new Set<(l: MediaCoinLoopComplete) => void>();

  private unsub: (() => void) | null = null;
  private holdTimer: ReturnType<typeof setInterval> | null = null;

  constructor(transport: MeshTransportAdapter, options: MediaCoinEngineOptions = {}) {
    this.transport = transport;
    this.store = options.store ?? new MemoryChunkStore();
    this.isRefused = options.isRefused ?? (() => false);
  }

  get localPeerId(): string {
    return this.transport.localPeerId;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.transport.onMessage(CHANNEL, (peerId, payload) => {
      void this.handleMessage(peerId, payload as MediaCoinMessage);
    });
    this.holdTimer = setInterval(() => this.retryHeld(), HOLD_RETRY_MS);
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.seenMsgs.clear();
    for (const w of this.replyWaiters.values()) w({ reply: "timeout" });
    this.replyWaiters.clear();
    for (const w of this.ackWaiters.values()) w();
    this.ackWaiters.clear();
    for (const w of this.doneWaiters.values()) w(false);
    this.doneWaiters.clear();
  }

  // ── Mint & launch ────────────────────────────────────────────────

  /** Mint content into this engine's store and register its coin. */
  async mint(
    file: File | Blob | { name: string; type: string; data: Uint8Array } | MediaCoinSource,
    creatorId: string,
    options: MintOptions = {},
  ): Promise<MediaCoinManifest> {
    const source = "pieces" in file ? file : mediaCoinSourceOf(file);
    const manifest = await mintMediaCoinContent(source, creatorId, this.store, options);
    this.coins.set(manifest.coinId, manifest);
    return manifest;
  }

  /**
   * Register a coin for content already in the store under a coinId of
   * its own (a Support Coin, or a launch queued before the mesh was up).
   */
  async adoptCoin(coinId: string, merkleRoot: string, supporter?: { id: string; name?: string }): Promise<MediaCoinManifest | null> {
    const existing = this.coins.get(coinId);
    if (existing) return existing.merkleRoot === merkleRoot ? existing : null;
    const base = await this.store.getManifest(merkleRoot);
    if (!base || !(await this.store.isComplete(merkleRoot))) return null;
    const manifest: MediaCoinManifest = base.coinId === coinId
      ? { ...base }
      : { ...base, coinId, tokenId: genId("nft"), mintedAt: Date.now(), ...(supporter ? { supporter } : {}) };
    this.coins.set(coinId, manifest);
    return manifest;
  }

  /**
   * Start a coin's loop from this node. The content must be held whole.
   * Returns false when it is not, or is too large to carry.
   */
  async launch(coinId: string, ttl = MEDIA_COIN_LOOP_TTL): Promise<boolean> {
    const manifest = this.coins.get(coinId);
    if (!manifest || manifest.totalSize > MEDIA_COIN_PASS_MAX_BYTES) return false;
    if (!(await this.store.isComplete(manifest.merkleRoot))) return false;
    if (this.isRefused(manifest.merkleRoot)) return false;
    const local = this.transport.localPeerId;
    this.forward(coinId, { creatorId: local, hops: [local], ttl });
    return true;
  }

  /** Drop every trace of a piece of content (Delete Sync). */
  async forget(merkleRoot: string): Promise<void> {
    for (const [coinId, m] of Array.from(this.coins)) {
      if (m.merkleRoot !== merkleRoot) continue;
      this.coins.delete(coinId);
      this.held.delete(coinId);
    }
    for (const [id, entry] of Array.from(this.incoming)) {
      if (entry.manifest.merkleRoot === merkleRoot) this.incoming.delete(id);
    }
    await this.store.deleteContent(merkleRoot);
  }

  onUnpack(cb: (u: MediaCoinUnpacked) => void | Promise<void>): () => void {
    this.unpackListeners.add(cb);
    return () => this.unpackListeners.delete(cb);
  }

  onAlreadyHeld(cb: (h: MediaCoinAlreadyHeld) => void | Promise<void>): () => void {
    this.heldListeners.add(cb);
    return () => this.heldListeners.delete(cb);
  }

  onLoopComplete(cb: (l: MediaCoinLoopComplete) => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }

  getHeldCoinIds(): string[] {
    return Array.from(this.held.keys());
  }

  getManifest(coinId: string): MediaCoinManifest | undefined {
    return this.coins.get(coinId);
  }

  getAllManifests(): MediaCoinManifest[] {
    return Array.from(this.coins.values());
  }

  async hasContent(merkleRoot: string): Promise<boolean> {
    return this.store.isComplete(merkleRoot);
  }

  async readBytes(merkleRoot: string): Promise<Uint8Array | null> {
    const manifest = await this.store.getManifest(merkleRoot);
    if (!manifest || !(await this.store.isComplete(merkleRoot))) return null;
    const parts: Uint8Array[] = [];
    for await (const p of readMediaCoinPlaintext(manifest, this.store)) parts.push(p);
    const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }

  // ── Sending ──────────────────────────────────────────────────────

  private nextHop(route: MediaCoinRoute, merkleRoot: string): string | null {
    const local = this.transport.localPeerId;
    const refused = this.refusedBy.get(merkleRoot);
    const connected = this.transport.getConnectedPeerIds().filter((p) => p !== local && !refused?.has(p));
    if (route.ttl > 0) {
      const fresh = connected.find((p) => !route.hops.includes(p));
      if (fresh) return fresh;
    }
    if (local !== route.creatorId && connected.includes(route.creatorId)) return route.creatorId;
    return null;
  }

  /** Hand the coin on; it stays held until a hand-off lands. */
  private forward(coinId: string, route: MediaCoinRoute): void {
    this.held.set(coinId, route);
    if (this.sending.has(coinId)) return;
    const manifest = this.coins.get(coinId);
    if (!manifest) { this.held.delete(coinId); return; }
    const next = this.nextHop(route, manifest.merkleRoot);
    if (!next) return;
    this.sending.add(coinId);
    void this.sendCoin(coinId, route, next)
      .catch((): SendOutcome => "failed")
      .then((outcome) => {
        this.sending.delete(coinId);
        if (this.held.get(coinId) !== route) return;
        if (outcome === "done") this.held.delete(coinId);
        // A refusal does not end the coin: offer it to the next peer now.
        else if (outcome === "refused") this.forward(coinId, route);
      });
  }

  private retryHeld(): void {
    for (const [coinId, route] of Array.from(this.held)) this.forward(coinId, route);
  }

  private send(peerId: string, type: MsgType, coinId: string, payload: unknown): Promise<boolean> {
    return this.transport.send(CHANNEL, peerId, { type, coinId, payload, msgId: genId("msg") } as MediaCoinMessage)
      .catch(() => false);
  }

  private waitFor<T>(map: Map<string, (v: T) => void>, key: string, ms: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => { map.delete(key); resolve(fallback); }, ms);
      map.set(key, (v: T) => { clearTimeout(timer); map.delete(key); resolve(v); });
    });
  }

  private connected(peerId: string): boolean {
    return this.transport.getConnectedPeerIds().includes(peerId);
  }

  /** Wait while the link to a peer has more than the high-water mark queued. */
  private async waitForBuffer(peerId: string): Promise<boolean> {
    const started = Date.now();
    while ((this.transport.getBufferedAmount?.(peerId) ?? 0) > MEDIA_COIN_BUFFER_HIGH_WATER) {
      if (!this.connected(peerId) || Date.now() - started > ACK_STALL_MS) return false;
      await sleep(BUFFER_POLL_MS);
    }
    return true;
  }

  private async sendCoin(coinId: string, route: MediaCoinRoute, peerId: string): Promise<SendOutcome> {
    const manifest = this.coins.get(coinId);
    if (!manifest) return "failed";
    const root = manifest.merkleRoot;
    const offerId = genId("offer");
    const offer: OfferPayload = {
      offerId,
      merkleRoot: root,
      size: manifest.totalSize,
      isSupport: Boolean(manifest.supporter),
      manifest,
      route,
    };
    const replyP = this.waitFor<OfferReply>(this.replyWaiters, offerId, OFFER_REPLY_MS, { reply: "timeout" });
    // Listen for "done" before offering: a receiver already holding every
    // chunk finishes straight after its reply.
    const donePromise = this.waitFor(this.doneWaiters, offerId, DONE_MS + ACK_STALL_MS * Math.ceil(manifest.totalChunks / MEDIA_COIN_ACK_WINDOW), false);
    if (!(await this.send(peerId, "coin-pass-offer", coinId, offer))) {
      this.replyWaiters.get(offerId)?.({ reply: "timeout" });
      this.doneWaiters.get(offerId)?.(false);
      return "failed";
    }
    const { reply, have } = await replyP;
    if (reply !== "accept") this.doneWaiters.get(offerId)?.(false);
    if (reply === "timeout") return "failed";
    if (reply === "refused") {
      if (!this.refusedBy.has(root)) this.refusedBy.set(root, new Set());
      this.refusedBy.get(root)!.add(peerId);
      return "refused";
    }
    if (reply === "already-held") return "done";

    // Accepted: stream what the receiver lacks, paced.
    const ackKey = `${root}|${peerId}`;
    const acked = this.acked.get(ackKey) ?? new Set<number>();
    this.acked.set(ackKey, acked);
    for (const i of have ?? []) acked.add(i);
    const inflight = new Set<number>();
    this.onAckFor.set(offerId, (index) => { acked.add(index); inflight.delete(index); });
    try {
      for (let i = 0; i < manifest.totalChunks; i++) {
        if (acked.has(i)) continue;
        while (inflight.size >= MEDIA_COIN_ACK_WINDOW) {
          const before = inflight.size;
          await this.waitFor<void>(this.ackWaiters, offerId, ACK_STALL_MS, undefined);
          if (inflight.size >= before) return "failed"; // stalled: resume from the acks later
        }
        if (!(await this.waitForBuffer(peerId))) return "failed";
        const data = await this.store.getChunk(root, i);
        if (data == null) return "failed";
        inflight.add(i);
        if (!(await this.send(peerId, "coin-chunk", coinId, { offerId, merkleRoot: root, index: i, data }))) return "failed";
        this.emitTransfer(root, peerId, "out", acked.size + inflight.size, manifest.totalChunks);
      }
      const ok = await donePromise;
      if (ok) this.acked.delete(ackKey);
      return ok ? "done" : "failed";
    } finally {
      this.onAckFor.delete(offerId);
      this.doneWaiters.get(offerId)?.(false);
    }
  }

  private onAckFor = new Map<string, (index: number) => void>();

  // ── Receiving ────────────────────────────────────────────────────

  private async handleMessage(peerId: string, msg: MediaCoinMessage): Promise<void> {
    if (!msg || typeof msg.type !== "string" || typeof msg.coinId !== "string") return;
    if (msg.msgId) {
      if (this.seenMsgs.has(msg.msgId)) return;
      this.seenMsgs.add(msg.msgId);
      if (this.seenMsgs.size > SEEN_CAP) {
        const first = this.seenMsgs.values().next().value;
        if (first) this.seenMsgs.delete(first);
      }
    }
    const p = (msg.payload ?? {}) as Record<string, unknown>;
    switch (msg.type) {
      case "coin-pass-offer":
        return this.onOffer(peerId, msg.coinId, p as unknown as OfferPayload);
      case "coin-pass-offer-reply": {
        const offerId = p.offerId as string;
        const reply = p.reply as MediaCoinOfferReply;
        if (reply !== "accept" && reply !== "already-held" && reply !== "refused") return;
        const have = Array.isArray(p.have) ? (p.have as unknown[]).filter((n): n is number => Number.isInteger(n)) : [];
        this.replyWaiters.get(offerId)?.({ reply, have });
        return;
      }
      case "coin-chunk":
        return this.onChunk(peerId, p);
      case "coin-chunk-ack": {
        const offerId = p.offerId as string;
        if (Number.isInteger(p.index)) this.onAckFor.get(offerId)?.(p.index as number);
        this.ackWaiters.get(offerId)?.();
        return;
      }
      case "coin-pass-done":
        this.doneWaiters.get(p.offerId as string)?.(p.ok === true);
        return;
      // Anything else (including the retired whole-coin "coin-pass"
      // bursts and announce/fetch messages) is ignored.
    }
  }

  private reply(peerId: string, coinId: string, offerId: string, reply: MediaCoinOfferReply, have?: number[]): void {
    void this.send(peerId, "coin-pass-offer-reply", coinId, { offerId, reply, ...(have ? { have } : {}) });
  }

  private async validOffer(coinId: string, o: OfferPayload): Promise<boolean> {
    const m = o?.manifest;
    const r = o?.route;
    if (!o || typeof o.offerId !== "string" || !m || !r) return false;
    if (m.coinId !== coinId || m.merkleRoot !== o.merkleRoot) return false;
    if (!Array.isArray(r.hops) || typeof r.creatorId !== "string" || typeof r.ttl !== "number") return false;
    if (!Number.isFinite(m.totalSize) || m.totalSize < 0 || m.totalSize > MEDIA_COIN_PASS_MAX_BYTES) return false;
    if (!Array.isArray(m.chunkHashes) || m.chunkHashes.length !== m.totalChunks || m.totalChunks < 1) return false;
    return (await buildMerkleRoot(m.chunkHashes)) === m.merkleRoot;
  }

  private async onOffer(peerId: string, coinId: string, offer: OfferPayload): Promise<void> {
    if (typeof offer?.offerId !== "string") return;
    if (!(await this.validOffer(coinId, offer))) {
      this.reply(peerId, coinId, offer.offerId, "refused");
      return;
    }
    const { manifest, route, merkleRoot: root } = offer;
    if (this.isRefused(root)) {
      this.reply(peerId, coinId, offer.offerId, "refused");
      return;
    }
    const local = this.transport.localPeerId;
    const nextRoute: MediaCoinRoute = { creatorId: route.creatorId, hops: [...route.hops, local], ttl: Math.max(0, route.ttl - 1) };

    // Home again: the loop is complete.
    if (local === route.creatorId && route.hops.length > 1) {
      this.reply(peerId, coinId, offer.offerId, "already-held");
      this.held.delete(coinId);
      const done: MediaCoinLoopComplete = { coinId, merkleRoot: root, route: nextRoute };
      for (const cb of this.loopListeners) cb(done);
      return;
    }

    const routeKey = `${coinId}|${route.hops.join(",")}`;
    if (this.passedRoutes.has(routeKey)) {
      this.reply(peerId, coinId, offer.offerId, "already-held");
      return;
    }

    if (await this.store.isComplete(root)) {
      this.markPassed(routeKey);
      this.reply(peerId, coinId, offer.offerId, "already-held");
      this.coins.set(coinId, manifest);
      const held: MediaCoinAlreadyHeld = { manifest, route: nextRoute, fromPeerId: peerId };
      for (const cb of this.heldListeners) {
        try { await cb(held); } catch { /* listener errors never stop the coin */ }
      }
      // It already holds the content, so it carries the coin on itself.
      this.forward(coinId, nextRoute);
      return;
    }

    // A newer offer of the same coin from the same peer replaces an older one.
    for (const [id, other] of Array.from(this.incoming)) {
      if (other.coinId === coinId && other.from === peerId) this.incoming.delete(id);
    }
    await this.store.putManifest(manifest, false);
    const have = await this.store.heldIndices(root);
    const entry: Incoming = {
      offerId: offer.offerId, coinId, from: peerId, manifest, route,
      received: new Set(have.filter((i) => i >= 0 && i < manifest.totalChunks)), finalizing: false,
    };
    this.incoming.set(offer.offerId, entry);
    while (this.incoming.size > MAX_INCOMING) {
      const oldest = this.incoming.keys().next().value;
      if (!oldest) break;
      this.incoming.delete(oldest);
    }
    this.reply(peerId, coinId, offer.offerId, "accept", Array.from(entry.received));
    if (entry.received.size >= manifest.totalChunks) await this.finalize(entry);
  }

  private markPassed(routeKey: string): void {
    this.passedRoutes.add(routeKey);
    if (this.passedRoutes.size > SEEN_CAP) {
      const first = this.passedRoutes.values().next().value;
      if (first) this.passedRoutes.delete(first);
    }
  }

  private async onChunk(peerId: string, p: Record<string, unknown>): Promise<void> {
    const entry = this.incoming.get(p.offerId as string);
    if (!entry || entry.from !== peerId) return;
    const { manifest } = entry;
    const index = p.index as number;
    if (p.merkleRoot !== manifest.merkleRoot || !Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) return;
    if (typeof p.data !== "string") return;
    if ((await sha256hex(p.data)) !== manifest.chunkHashes[index]) {
      console.warn(`[MediaCoin] chunk ${index} of ${manifest.merkleRoot.slice(0, 12)} failed its hash; dropped`);
      return;
    }
    if (this.incoming.get(entry.offerId) !== entry) return; // superseded or forgotten meanwhile
    if (!entry.received.has(index)) {
      await this.store.putChunk(manifest.merkleRoot, index, p.data);
      entry.received.add(index);
    }
    void this.send(peerId, "coin-chunk-ack", entry.coinId, { offerId: entry.offerId, merkleRoot: manifest.merkleRoot, index });
    this.emitTransfer(manifest.merkleRoot, peerId, "in", entry.received.size, manifest.totalChunks);
    if (entry.received.size >= manifest.totalChunks) await this.finalize(entry);
  }

  /** Final verification, then unpack and pass the coin on. */
  private async finalize(entry: Incoming): Promise<void> {
    if (entry.finalizing) return;
    entry.finalizing = true;
    const { manifest, from, coinId } = entry;
    const root = manifest.merkleRoot;
    const hashes: string[] = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      const data = await this.store.getChunk(root, i);
      hashes.push(data == null ? "" : await sha256hex(data));
    }
    this.incoming.delete(entry.offerId);
    if (hashes.some((h, i) => h !== manifest.chunkHashes[i]) || (await buildMerkleRoot(hashes)) !== root) {
      console.warn(`[MediaCoin] ${root.slice(0, 12)} from ${from.slice(0, 8)} failed Merkle verification`);
      void this.send(from, "coin-pass-done", coinId, { offerId: entry.offerId, ok: false });
      return;
    }
    await this.store.putManifest(manifest, true);
    this.markPassed(`${coinId}|${entry.route.hops.join(",")}`);
    void this.send(from, "coin-pass-done", coinId, { offerId: entry.offerId, ok: true });
    const local = this.transport.localPeerId;
    const route: MediaCoinRoute = { creatorId: entry.route.creatorId, hops: [...entry.route.hops, local], ttl: Math.max(0, entry.route.ttl - 1) };
    this.coins.set(coinId, manifest);
    const unpacked: MediaCoinUnpacked = { manifest, route, fromPeerId: from, readBytes: () => this.readBytes(root) };
    for (const cb of this.unpackListeners) {
      try { await cb(unpacked); } catch (err) { console.warn(`[MediaCoin] unpack listener failed for ${root.slice(0, 12)}`, err); }
    }
    if (this.isRefused(root)) return; // deleted while unpacking
    this.forward(coinId, route);
  }

  private emitTransfer(merkleRoot: string, peerId: string, direction: "in" | "out", chunks: number, total: number): void {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("media-coin-transfer", { detail: { merkleRoot, peerId, direction, chunks, total } }));
    } catch { /* non-browser runtime */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MERKLE UTILITIES — Exported for external verification
// ═══════════════════════════════════════════════════════════════════════

export { buildMerkleRoot, buildMerkleProof, verifyMerkleProof };

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON FACTORY
// ═══════════════════════════════════════════════════════════════════════

let _instance: MediaCoinEngine | null = null;

export function getMediaCoinEngine(transport: MeshTransportAdapter, options?: MediaCoinEngineOptions): MediaCoinEngine {
  if (!_instance) _instance = new MediaCoinEngine(transport, options);
  return _instance;
}

export function getActiveMediaCoinEngine(): MediaCoinEngine | null {
  return _instance;
}

export function resetMediaCoinEngine(): void {
  _instance?.stop();
  _instance = null;
}
