/**
 * ═══════════════════════════════════════════════════════════════════════
 * Media-as-Coin Streaming Engine — Standalone
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Zero imports from other project modules. Fully self-contained.
 *
 * Wraps media files into SWARM NFT coins with progressive chunk
 * structures, relays them across the mesh, and serves them as
 * instantly playable streams in the live feed.
 *
 * Flow:
 *   1. MINT — File → progressive chunks → Merkle tree → NFT coin
 *   2. RELAY — Coin propagates via mesh; priority-first replication
 *   3. SERVE — Feed player pulls chunks progressively for instant playback
 *   4. REWARD — Peers earn hosting credits for serving chunks
 *   5. LOOP — `launch()` hands the whole coin (manifest + every chunk's
 *      bytes) to one connected peer. Each peer verifies and unpacks it,
 *      appends itself to the route, and passes it to a connected peer not
 *      yet visited, until the coin loops back to its creator.
 *
 * This module uses the same MeshTransportAdapter interface as
 * TorrentSwarm so it can ride on any active mesh instance.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Inline Crypto Helpers ─────────────────────────────────────────────

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const BLOCK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + BLOCK, bytes.length))
    );
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
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return ab2hex(buf);
}

function genId(prefix = "mc"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Types ──────────────────────────────────────────────────────────────

/** A progressive media chunk stored inside a coin */
export interface MediaChunk {
  index: number;
  hash: string;
  data: string; // base64
  size: number;
  /** Is this part of the "priority" head used for instant playback? */
  priority: boolean;
}

/** Merkle tree node */
interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

/** The NFT media manifest embedded in the SWARM coin */
export interface MediaCoinManifest {
  coinId: string;
  /** NFT token ID for this media */
  tokenId: string;
  /** Original filename */
  name: string;
  /** MIME type (video/mp4, audio/ogg, etc.) */
  mimeType: string;
  /** Total bytes */
  totalSize: number;
  /** Chunk size in bytes */
  chunkSize: number;
  /** Total chunk count */
  totalChunks: number;
  /** Number of "priority" head chunks (first N seconds) */
  priorityChunks: number;
  /** Ordered SHA-256 hashes per chunk — sequential hash map */
  chunkHashes: string[];
  /** Merkle root over all chunk hashes */
  merkleRoot: string;
  /** Codec hint (e.g. "avc1.42E01E, mp4a.40.2") */
  codec?: string;
  /** Duration in seconds (if known) */
  duration?: number;
  /** Creator peer ID */
  creatorId: string;
  /** Minted timestamp */
  mintedAt: number;
  /** Optional AES-GCM key (base64) for encrypted content */
  encryptionKey?: string;
  /** Optional IV prefix for encrypted chunks */
  encryptionIvPrefix?: string;
}

/** Progress during minting or playback */
export interface MediaCoinProgress {
  coinId: string;
  phase: "minting" | "relaying" | "buffering" | "playing" | "complete";
  chunksReady: number;
  totalChunks: number;
  percent: number;
  bytesReady: number;
  bytesTotal: number;
  /** Seconds of playable content buffered (estimate) */
  bufferedSeconds: number;
  /** Total duration if known */
  totalDuration?: number;
}

/** Reward event emitted when a peer serves chunks */
export interface MediaHostReward {
  peerId: string;
  coinId: string;
  chunksServed: number;
  timestamp: number;
}

/** Route a travelling coin carries: who made it and who has unpacked it. */
export interface MediaCoinRoute {
  creatorId: string;
  /** Peer ids that have held this coin, creator first, in visit order. */
  hops: string[];
  /** Hand-offs left before the coin heads home to its creator. */
  ttl: number;
}

/** A coin that arrived whole and was verified, ready to be stored locally. */
export interface MediaCoinUnpacked {
  manifest: MediaCoinManifest;
  route: MediaCoinRoute;
  fromPeerId: string;
  /** Plaintext file bytes (decrypted when the coin was encrypted). */
  bytes: Uint8Array;
}

/** A coin that came back to its creator. */
export interface MediaCoinLoopComplete {
  coinId: string;
  route: MediaCoinRoute;
}

/** Thin adapter — same interface as TorrentSwarm uses */
export interface MeshTransportAdapter {
  send(
    channel: string,
    peerId: string,
    payload: unknown
  ): Promise<boolean>;
  broadcast(channel: string, payload: unknown): void;
  onMessage(
    channel: string,
    handler: (peerId: string, payload: unknown) => void
  ): () => void;
  getConnectedPeerIds(): string[];
  localPeerId: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const CHUNK_SIZE = 1_048_576; // 1 MiB
const PRIORITY_SECONDS = 5; // first 5s are priority-replicated
const CHANNEL = "media-coin";
const MAX_PIPELINE = 4;
const POLL_MS = 1_500;
const STALL_MS = 30_000;
const SEEN_CAP = 500;
/** Default hand-offs before a travelling coin heads home. */
export const MEDIA_COIN_LOOP_TTL = 16;
/** Largest file a coin will carry whole between peers (bigger stays torrent-only). */
export const MEDIA_COIN_PASS_MAX_BYTES = 100 * 1024 * 1024;
const HOLD_RETRY_MS = 5_000;

// ── Message Protocol ──────────────────────────────────────────────────

type MsgType =
  | "coin-announce" // broadcast a new MediaCoinManifest
  | "coin-have" // advertise which chunks we hold
  | "coin-request" // ask for a specific chunk
  | "coin-piece" // deliver a chunk
  | "coin-interested" // express interest in a coin
  | "coin-pass" // hand the whole coin to one peer: manifest + route
  | "coin-pass-piece"; // one chunk of a coin being handed over

interface MediaCoinMessage {
  type: MsgType;
  coinId: string;
  payload: unknown;
  msgId?: string;
}

// ── Merkle Tree Builder ───────────────────────────────────────────────

async function buildMerkleRoot(hashes: string[]): Promise<string> {
  if (hashes.length === 0) return "";
  if (hashes.length === 1) return hashes[0];

  let layer = [...hashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left; // duplicate last if odd
      next.push(await sha256hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

/** Builds a Merkle proof for a given chunk index */
async function buildMerkleProof(
  hashes: string[],
  targetIndex: number
): Promise<{ hash: string; position: "left" | "right" }[]> {
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
        if (idx % 2 === 0) {
          proof.push({ hash: right, position: "right" });
        } else {
          proof.push({ hash: left, position: "left" });
        }
      }
      next.push(await sha256hex(left + right));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verify a chunk hash against the Merkle root */
async function verifyMerkleProof(
  chunkHash: string,
  proof: { hash: string; position: "left" | "right" }[],
  merkleRoot: string
): Promise<boolean> {
  let current = chunkHash;
  for (const step of proof) {
    if (step.position === "right") {
      current = await sha256hex(current + step.hash);
    } else {
      current = await sha256hex(step.hash + current);
    }
  }
  return current === merkleRoot;
}

// ═══════════════════════════════════════════════════════════════════════
// PEER CHUNK TRACKER
// ═══════════════════════════════════════════════════════════════════════

interface PeerChunkState {
  peerId: string;
  haveChunks: Set<number>;
  inflight: Set<number>;
  lastSeen: number;
  failures: number;
  chunksServed: number; // how many chunks this peer gave us (for rewards)
}

// ═══════════════════════════════════════════════════════════════════════
// MEDIA COIN ENGINE
// ═══════════════════════════════════════════════════════════════════════

export class MediaCoinEngine {
  private transport: MeshTransportAdapter;

  // Storage
  private manifests = new Map<string, MediaCoinManifest>();
  private chunks = new Map<string, Map<number, MediaChunk>>(); // coinId → index → chunk
  private peerState = new Map<string, Map<string, PeerChunkState>>(); // coinId → peerId → state

  // Listeners
  private progressListeners = new Map<
    string,
    Set<(p: MediaCoinProgress) => void>
  >();
  private completionListeners = new Map<
    string,
    Set<(data: Uint8Array) => void>
  >();
  /** Fires when enough data is buffered for playback to start */
  private playableListeners = new Map<
    string,
    Set<(url: string) => void>
  >();

  // Timers
  private pollTimers = new Map<string, number>();
  private lastProgress = new Map<string, number>();
  private seenMsgs = new Set<string>();

  private unsub: (() => void) | null = null;

  // Loop state
  /** Coins waiting for a peer to hand off to (no eligible peer connected). */
  private held = new Map<string, MediaCoinRoute>();
  /** Incoming hand-offs being assembled, keyed by passId. */
  private incoming = new Map<string, { coinId: string; from: string; route?: MediaCoinRoute; manifest?: MediaCoinManifest; pieces: Map<number, MediaChunk> }>();
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  private unpackListeners = new Set<(u: MediaCoinUnpacked) => void | Promise<void>>();
  private loopListeners = new Set<(l: MediaCoinLoopComplete) => void>();

  constructor(transport: MeshTransportAdapter) {
    this.transport = transport;
  }

  get localPeerId(): string {
    return this.transport.localPeerId;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  start(): void {
    this.unsub = this.transport.onMessage(CHANNEL, (peerId, payload) => {
      this.handleMessage(peerId, payload as MediaCoinMessage);
    });
    this.holdTimer = setInterval(() => this.retryHeld(), HOLD_RETRY_MS);
    console.log("[MediaCoin] ✅ Engine started");
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = null;
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    this.seenMsgs.clear();
    console.log("[MediaCoin] ⏹️ Engine stopped");
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1️⃣ MINT — Create a Media Coin from raw file data
  // ═══════════════════════════════════════════════════════════════════

  async mint(
    file: File | { name: string; type: string; data: Uint8Array },
    creatorId: string,
    options?: {
      codec?: string;
      duration?: number;
      encrypt?: boolean;
      /** Real mined wallet coin id to engrave onto; generated when absent. */
      coinId?: string;
      onProgress?: (p: MediaCoinProgress) => void;
    }
  ): Promise<MediaCoinManifest> {
    const data =
      "data" in file
        ? file.data
        : new Uint8Array(await (file as File).arrayBuffer());
    const name = file.name;
    const mimeType = file.type || "application/octet-stream";

    const totalChunks = Math.max(1, Math.ceil(data.byteLength / CHUNK_SIZE));

    // Estimate priority chunks (first N seconds of media)
    const bytesPerSecond =
      options?.duration && options.duration > 0
        ? data.byteLength / options.duration
        : 500_000; // default ~500KB/s estimate
    const priorityBytes = PRIORITY_SECONDS * bytesPerSecond;
    const priorityChunks = Math.min(
      totalChunks,
      Math.max(1, Math.ceil(priorityBytes / CHUNK_SIZE))
    );

    // ── Optional encryption key ──────────────────────────────────────
    let encKey: CryptoKey | null = null;
    let encKeyB64: string | undefined;
    let encIvPrefix: string | undefined;

    if (options?.encrypt) {
      encKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const raw = await crypto.subtle.exportKey("raw", encKey);
      encKeyB64 = ab2b64(raw);
      encIvPrefix = ab2b64(crypto.getRandomValues(new Uint8Array(4)).buffer);
    }

    // ── Split into sequential chunks ─────────────────────────────────
    const coinId = options?.coinId ?? genId("media-coin");
    const chunkHashes: string[] = [];
    const chunkMap = new Map<number, MediaChunk>();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.byteLength);
      let slice = data.slice(start, end);

      // Encrypt if requested
      if (encKey) {
        const iv = new Uint8Array(12);
        // Deterministic IV per chunk: prefix + chunk index
        const prefixBytes = new Uint8Array(b642ab(encIvPrefix!));
        iv.set(prefixBytes.subarray(0, 4), 0);
        new DataView(iv.buffer).setUint32(4, i);
        const cipher = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          encKey,
          slice
        );
        slice = new Uint8Array(cipher);
      }

      const b64 = ab2b64(slice.buffer as ArrayBuffer);
      const hash = await sha256hex(b64);
      chunkHashes.push(hash);

      chunkMap.set(i, {
        index: i,
        hash,
        data: b64,
        size: end - start,
        priority: i < priorityChunks,
      });

      options?.onProgress?.({
        coinId,
        phase: "minting",
        chunksReady: i + 1,
        totalChunks,
        percent: Math.round(((i + 1) / totalChunks) * 100),
        bytesReady: end,
        bytesTotal: data.byteLength,
        bufferedSeconds: 0,
        totalDuration: options?.duration,
      });
    }

    // ── Merkle root ──────────────────────────────────────────────────
    const merkleRoot = await buildMerkleRoot(chunkHashes);

    const tokenId = genId("nft");
    const manifest: MediaCoinManifest = {
      coinId,
      tokenId,
      name,
      mimeType,
      totalSize: data.byteLength,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      priorityChunks,
      chunkHashes,
      merkleRoot,
      codec: options?.codec,
      duration: options?.duration,
      creatorId,
      mintedAt: Date.now(),
      encryptionKey: encKeyB64,
      encryptionIvPrefix: encIvPrefix,
    };

    this.manifests.set(coinId, manifest);
    this.chunks.set(coinId, chunkMap);

    console.log(
      `[MediaCoin] 🪙 Minted "${name}" → ${coinId} (${totalChunks} chunks, ${priorityChunks} priority, merkle: ${merkleRoot.slice(0, 12)}…)`
    );

    return manifest;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2️⃣ RELAY — Broadcast the coin across the SWARM mesh
  // ═══════════════════════════════════════════════════════════════════

  relay(manifest: MediaCoinManifest): void {
    // Store locally
    if (!this.manifests.has(manifest.coinId)) {
      this.manifests.set(manifest.coinId, manifest);
    }

    // Broadcast announce. The decryption key never rides a broadcast: it
    // travels only inside a direct coin hand-off (see launch()).
    const { encryptionKey: _key, encryptionIvPrefix: _iv, ...publicManifest } = manifest;
    const msg: MediaCoinMessage = {
      type: "coin-announce",
      coinId: manifest.coinId,
      payload: publicManifest,
      msgId: genId("msg"),
    };
    this.transport.broadcast(CHANNEL, msg);

    // Priority-first: immediately push priority chunks to all peers
    const chunkMap = this.chunks.get(manifest.coinId);
    if (chunkMap) {
      const peers = this.transport.getConnectedPeerIds();
      for (let i = 0; i < manifest.priorityChunks; i++) {
        const chunk = chunkMap.get(i);
        if (!chunk) continue;
        for (const peerId of peers) {
          void this.transport.send(CHANNEL, peerId, {
            type: "coin-piece",
            coinId: manifest.coinId,
            payload: { chunk, proof: null }, // proof skipped for priority push
            msgId: genId("msg"),
          } as MediaCoinMessage);
        }
      }
      console.log(
        `[MediaCoin] 🚀 Priority-pushed ${manifest.priorityChunks} chunks to ${peers.length} peers`
      );
    }

    console.log(`[MediaCoin] 📡 Relaying coin ${manifest.coinId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3️⃣ SERVE — Progressive playback retrieval for the feed
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start fetching a coin's media for progressive playback.
   * Returns immediately — use onPlayable / onProgress / onComplete listeners.
   */
  fetch(manifest: MediaCoinManifest): void {
    const { coinId } = manifest;
    if (this.pollTimers.has(coinId)) return; // already fetching

    if (!this.manifests.has(coinId)) {
      this.manifests.set(coinId, manifest);
    }
    if (!this.chunks.has(coinId)) {
      this.chunks.set(coinId, new Map());
    }
    if (!this.peerState.has(coinId)) {
      this.peerState.set(coinId, new Map());
    }

    // Check if we already have all chunks (we minted it)
    const existing = this.chunks.get(coinId)!;
    if (existing.size >= manifest.totalChunks) {
      this.emitPlayable(coinId);
      this.emitComplete(coinId);
      return;
    }

    // Express interest to all peers
    for (const peerId of this.transport.getConnectedPeerIds()) {
      void this.transport.send(CHANNEL, peerId, {
        type: "coin-interested",
        coinId,
        payload: null,
        msgId: genId("msg"),
      } as MediaCoinMessage);
    }

    this.lastProgress.set(coinId, Date.now());

    // Poll for chunks — sequential order for progressive playback
    const timer = window.setInterval(() => {
      // Stall detection
      const lp = this.lastProgress.get(coinId) ?? 0;
      if (Date.now() - lp > STALL_MS) {
        const have = this.chunks.get(coinId)?.size ?? 0;
        if (have < manifest.totalChunks) {
          console.log(
            `[MediaCoin] ⏸️ Stalled "${manifest.name}" (${have}/${manifest.totalChunks})`
          );
          // Re-broadcast interest instead of giving up
          for (const peerId of this.transport.getConnectedPeerIds()) {
            void this.transport.send(CHANNEL, peerId, {
              type: "coin-interested",
              coinId,
              payload: null,
            } as MediaCoinMessage);
          }
          this.lastProgress.set(coinId, Date.now());
        }
      }

      this.requestSequentialChunks(coinId);
    }, POLL_MS);
    this.pollTimers.set(coinId, timer);

    console.log(`[MediaCoin] ▶️ Fetching "${manifest.name}" for playback`);
  }

  // ── Sequential chunk requests (progressive playback order) ────────

  private requestSequentialChunks(coinId: string): void {
    const manifest = this.manifests.get(coinId);
    if (!manifest) return;

    const chunkMap = this.chunks.get(coinId)!;
    const peerMap = this.peerState.get(coinId) ?? new Map();

    // Find next missing chunks in sequential order
    const missing: number[] = [];
    for (let i = 0; i < manifest.totalChunks && missing.length < MAX_PIPELINE * 2; i++) {
      if (!chunkMap.has(i)) {
        missing.push(i);
      }
    }

    if (missing.length === 0) {
      // We have everything — complete
      clearInterval(this.pollTimers.get(coinId));
      this.pollTimers.delete(coinId);
      this.emitComplete(coinId);
      return;
    }

    // Request from peers that have the chunks
    let requested = 0;
    for (const idx of missing) {
      if (requested >= MAX_PIPELINE) break;

      // Find a peer that has this chunk
      for (const [peerId, ps] of peerMap) {
        if (ps.haveChunks.has(idx) && !ps.inflight.has(idx) && ps.inflight.size < MAX_PIPELINE) {
          ps.inflight.add(idx);
          void this.transport.send(CHANNEL, peerId, {
            type: "coin-request",
            coinId,
            payload: { index: idx },
            msgId: genId("msg"),
          } as MediaCoinMessage);
          requested++;
          break;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleMessage(peerId: string, msg: MediaCoinMessage): void {
    if (!msg.type || !msg.coinId) return;

    // Dedup
    if (msg.msgId) {
      if (this.seenMsgs.has(msg.msgId)) return;
      this.seenMsgs.add(msg.msgId);
      if (this.seenMsgs.size > SEEN_CAP) {
        const first = this.seenMsgs.values().next().value;
        if (first) this.seenMsgs.delete(first);
      }
    }

    switch (msg.type) {
      case "coin-announce":
        this.onAnnounce(peerId, msg);
        break;
      case "coin-have":
        this.onHave(peerId, msg);
        break;
      case "coin-interested":
        this.onInterested(peerId, msg);
        break;
      case "coin-request":
        this.onRequest(peerId, msg);
        break;
      case "coin-piece":
        this.onPiece(peerId, msg);
        break;
      case "coin-pass":
        void this.onPass(peerId, msg);
        break;
      case "coin-pass-piece":
        void this.onPassPiece(peerId, msg);
        break;
    }
  }

  private onAnnounce(peerId: string, msg: MediaCoinMessage): void {
    const manifest = msg.payload as MediaCoinManifest;
    if (this.manifests.has(manifest.coinId)) return;

    this.manifests.set(manifest.coinId, manifest);
    console.log(
      `[MediaCoin] 📢 Peer ${peerId.slice(0, 8)} announced coin "${manifest.name}"`
    );

    // Emit event for UI (feed discovery)
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("media-coin-announced", {
          detail: { peerId, manifest },
        })
      );
    }

    // Auto-fetch for playback
    this.fetch(manifest);
  }

  private onHave(peerId: string, msg: MediaCoinMessage): void {
    const { indices } = msg.payload as { indices: number[] };
    const ps = this.getOrCreatePeer(msg.coinId, peerId);
    for (const i of indices) ps.haveChunks.add(i);
    ps.lastSeen = Date.now();
  }

  private onInterested(peerId: string, msg: MediaCoinMessage): void {
    // Respond with what we have
    const chunkMap = this.chunks.get(msg.coinId);
    if (!chunkMap || chunkMap.size === 0) return;

    const indices = Array.from(chunkMap.keys());
    void this.transport.send(CHANNEL, peerId, {
      type: "coin-have",
      coinId: msg.coinId,
      payload: { indices },
      msgId: genId("msg"),
    } as MediaCoinMessage);
  }

  private onRequest(peerId: string, msg: MediaCoinMessage): void {
    const { index } = msg.payload as { index: number };
    const chunkMap = this.chunks.get(msg.coinId);
    const chunk = chunkMap?.get(index);
    if (!chunk) return;

    void this.transport.send(CHANNEL, peerId, {
      type: "coin-piece",
      coinId: msg.coinId,
      payload: { chunk },
      msgId: genId("msg"),
    } as MediaCoinMessage);

    // Track hosting reward
    const ps = this.getOrCreatePeer(msg.coinId, peerId);
    ps.chunksServed++;
    this.emitHostReward(peerId, msg.coinId, ps.chunksServed);
  }

  private async onPiece(
    peerId: string,
    msg: MediaCoinMessage
  ): Promise<void> {
    const { chunk } = msg.payload as { chunk: MediaChunk };
    if (!chunk || chunk.index == null) return;

    const manifest = this.manifests.get(msg.coinId);
    if (!manifest) return;

    // ── Verify chunk hash against manifest ───────────────────────────
    const computedHash = await sha256hex(chunk.data);
    if (computedHash !== manifest.chunkHashes[chunk.index]) {
      console.warn(
        `[MediaCoin] ❌ Chunk ${chunk.index} hash mismatch from ${peerId.slice(0, 8)} — discarding`
      );
      const ps = this.getOrCreatePeer(msg.coinId, peerId);
      ps.failures++;
      ps.inflight.delete(chunk.index);
      return;
    }

    // Store
    if (!this.chunks.has(msg.coinId)) {
      this.chunks.set(msg.coinId, new Map());
    }
    const chunkMap = this.chunks.get(msg.coinId)!;
    if (chunkMap.has(chunk.index)) return; // already have it

    chunkMap.set(chunk.index, chunk);
    this.lastProgress.set(msg.coinId, Date.now());

    // Clear inflight
    const ps = this.getOrCreatePeer(msg.coinId, peerId);
    ps.inflight.delete(chunk.index);
    ps.lastSeen = Date.now();

    // Re-broadcast that we now have this chunk (become a relay)
    this.transport.broadcast(CHANNEL, {
      type: "coin-have",
      coinId: msg.coinId,
      payload: { indices: [chunk.index] },
      msgId: genId("msg"),
    } as MediaCoinMessage);

    // Emit progress
    this.emitProgress(msg.coinId);

    // Check if priority chunks are ready → playable
    if (
      chunkMap.size >= manifest.priorityChunks &&
      !this.playableFired.has(msg.coinId)
    ) {
      this.emitPlayable(msg.coinId);
    }

    // Check completion
    if (chunkMap.size >= manifest.totalChunks) {
      clearInterval(this.pollTimers.get(msg.coinId));
      this.pollTimers.delete(msg.coinId);
      this.emitComplete(msg.coinId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSEMBLY — Build playable blob URL from chunks
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Assemble all received chunks (up to `upToIndex`) into a Blob URL.
   * Supports partial assembly for progressive playback.
   */
  assembleBlob(
    coinId: string,
    upToIndex?: number
  ): string | null {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return null;

    const limit = upToIndex ?? manifest.totalChunks;
    const buffers: ArrayBuffer[] = [];

    for (let i = 0; i < limit; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) break; // sequential — stop at first gap
      buffers.push(b642ab(chunk.data));
    }

    if (buffers.length === 0) return null;

    const blob = new Blob(buffers, { type: manifest.mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * Assemble with decryption for encrypted coins.
   */
  async assembleDecryptedBlob(
    coinId: string,
    upToIndex?: number
  ): Promise<string | null> {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return null;
    if (!manifest.encryptionKey || !manifest.encryptionIvPrefix) {
      return this.assembleBlob(coinId, upToIndex);
    }

    const keyBuf = b642ab(manifest.encryptionKey);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const ivPrefix = new Uint8Array(b642ab(manifest.encryptionIvPrefix));

    const limit = upToIndex ?? manifest.totalChunks;
    const buffers: ArrayBuffer[] = [];

    for (let i = 0; i < limit; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) break;

      const iv = new Uint8Array(12);
      iv.set(ivPrefix.subarray(0, 4), 0);
      new DataView(iv.buffer).setUint32(4, i);

      const cipherBuf = b642ab(chunk.data);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipherBuf
      );
      buffers.push(plain);
    }

    if (buffers.length === 0) return null;
    const blob = new Blob(buffers, { type: manifest.mimeType });
    return URL.createObjectURL(blob);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4️⃣ REWARDS — Track hosting contributions
  // ═══════════════════════════════════════════════════════════════════

  private rewardListeners = new Set<(r: MediaHostReward) => void>();

  onReward(cb: (r: MediaHostReward) => void): () => void {
    this.rewardListeners.add(cb);
    return () => this.rewardListeners.delete(cb);
  }

  private emitHostReward(
    peerId: string,
    coinId: string,
    chunksServed: number
  ): void {
    const reward: MediaHostReward = {
      peerId,
      coinId,
      chunksServed,
      timestamp: Date.now(),
    };
    for (const cb of this.rewardListeners) cb(reward);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("media-coin-host-reward", { detail: reward })
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT EMITTERS
  // ═══════════════════════════════════════════════════════════════════

  private playableFired = new Set<string>();

  onProgress(
    coinId: string,
    cb: (p: MediaCoinProgress) => void
  ): () => void {
    if (!this.progressListeners.has(coinId)) {
      this.progressListeners.set(coinId, new Set());
    }
    this.progressListeners.get(coinId)!.add(cb);
    return () => this.progressListeners.get(coinId)?.delete(cb);
  }

  onPlayable(coinId: string, cb: (blobUrl: string) => void): () => void {
    if (!this.playableListeners.has(coinId)) {
      this.playableListeners.set(coinId, new Set());
    }
    this.playableListeners.get(coinId)!.add(cb);
    return () => this.playableListeners.get(coinId)?.delete(cb);
  }

  onComplete(
    coinId: string,
    cb: (data: Uint8Array) => void
  ): () => void {
    if (!this.completionListeners.has(coinId)) {
      this.completionListeners.set(coinId, new Set());
    }
    this.completionListeners.get(coinId)!.add(cb);
    return () => this.completionListeners.get(coinId)?.delete(cb);
  }

  private emitProgress(coinId: string): void {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return;

    const ready = chunkMap.size;
    const bytesReady = Array.from(chunkMap.values()).reduce(
      (sum, c) => sum + c.size,
      0
    );
    const bufferedSeconds = manifest.duration
      ? (bytesReady / manifest.totalSize) * manifest.duration
      : 0;

    const fetching = this.pollTimers.has(coinId);
    const phase: MediaCoinProgress["phase"] =
      ready >= manifest.totalChunks
        ? "complete"
        : ready >= manifest.priorityChunks
          ? "playing"
          : fetching
            ? "buffering"
            : "relaying";

    const progress: MediaCoinProgress = {
      coinId,
      phase,
      chunksReady: ready,
      totalChunks: manifest.totalChunks,
      percent: Math.round((ready / manifest.totalChunks) * 100),
      bytesReady,
      bytesTotal: manifest.totalSize,
      bufferedSeconds,
      totalDuration: manifest.duration,
    };

    for (const cb of this.progressListeners.get(coinId) ?? []) cb(progress);
  }

  private emitPlayable(coinId: string): void {
    this.playableFired.add(coinId);
    const url = this.assembleBlob(coinId, this.manifests.get(coinId)?.priorityChunks);
    if (!url) return;

    for (const cb of this.playableListeners.get(coinId) ?? []) cb(url);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("media-coin-playable", { detail: { coinId, url } })
      );
    }
  }

  private emitComplete(coinId: string): void {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return;

    // Assemble full data
    const buffers: ArrayBuffer[] = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) return;
      buffers.push(b642ab(chunk.data));
    }

    const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    for (const cb of this.completionListeners.get(coinId) ?? []) cb(merged);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("media-coin-complete", {
          detail: { coinId, name: manifest.name, size: totalLen },
        })
      );
    }

    this.emitProgress(coinId);
    console.log(
      `[MediaCoin] ✅ Complete: "${manifest.name}" (${totalLen} bytes)`
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5️⃣ LOOP — Hand the whole coin peer to peer until it returns home
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start a coin's loop from its creator. The coin must be minted locally
   * (all chunks held). Returns false when the coin is too large to carry.
   */
  launch(coinId: string, ttl = MEDIA_COIN_LOOP_TTL): boolean {
    const manifest = this.manifests.get(coinId);
    if (!manifest || !this.hasAllChunks(coinId)) return false;
    if (manifest.totalSize > MEDIA_COIN_PASS_MAX_BYTES) return false;
    const local = this.transport.localPeerId;
    this.forward(coinId, { creatorId: local, hops: [local], ttl });
    return true;
  }

  onUnpack(cb: (u: MediaCoinUnpacked) => void | Promise<void>): () => void {
    this.unpackListeners.add(cb);
    return () => this.unpackListeners.delete(cb);
  }

  onLoopComplete(cb: (l: MediaCoinLoopComplete) => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }

  /** Coins currently waiting for a peer to hand off to. */
  getHeldCoinIds(): string[] {
    return Array.from(this.held.keys());
  }

  /** Pick the next holder: an unvisited peer, else home to the creator. */
  private nextHop(route: MediaCoinRoute): string | null {
    const local = this.transport.localPeerId;
    const connected = this.transport.getConnectedPeerIds().filter((p) => p !== local);
    if (route.ttl > 0) {
      const fresh = connected.filter((p) => !route.hops.includes(p));
      if (fresh.length) return fresh[0];
    }
    if (local !== route.creatorId && connected.includes(route.creatorId)) return route.creatorId;
    return null;
  }

  private forward(coinId: string, route: MediaCoinRoute): void {
    const next = this.nextHop(route);
    if (!next) {
      this.held.set(coinId, route);
      return;
    }
    this.held.delete(coinId);
    this.sendCoin(coinId, route, next);
  }

  private retryHeld(): void {
    for (const [coinId, route] of Array.from(this.held)) this.forward(coinId, route);
  }

  private sendCoin(coinId: string, route: MediaCoinRoute, peerId: string): void {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return;
    const passId = genId("pass");
    void this.transport.send(CHANNEL, peerId, {
      type: "coin-pass",
      coinId,
      payload: { passId, manifest, route },
      msgId: genId("msg"),
    } as MediaCoinMessage);
    for (let i = 0; i < manifest.totalChunks; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) continue;
      void this.transport.send(CHANNEL, peerId, {
        type: "coin-pass-piece",
        coinId,
        payload: { passId, chunk },
        msgId: genId("msg"),
      } as MediaCoinMessage);
    }
    console.log(`[MediaCoin] 🔁 Passed ${coinId} to ${peerId.slice(0, 8)} (hop ${route.hops.length})`);
  }

  private passEntry(passId: string, coinId: string, from: string) {
    let entry = this.incoming.get(passId);
    if (!entry) {
      entry = { coinId, from, pieces: new Map() };
      this.incoming.set(passId, entry);
    }
    return entry;
  }

  private async onPass(peerId: string, msg: MediaCoinMessage): Promise<void> {
    const { passId, manifest, route } = (msg.payload ?? {}) as { passId?: string; manifest?: MediaCoinManifest; route?: MediaCoinRoute };
    if (!passId || !manifest || !route || manifest.coinId !== msg.coinId) return;
    if (!Array.isArray(route.hops) || typeof route.creatorId !== "string") return;
    if (manifest.totalSize > MEDIA_COIN_PASS_MAX_BYTES) return;
    if (manifest.chunkHashes.length !== manifest.totalChunks) return;
    if ((await buildMerkleRoot(manifest.chunkHashes)) !== manifest.merkleRoot) return;
    const entry = this.passEntry(passId, msg.coinId, peerId);
    entry.manifest = manifest;
    entry.route = route;
    await this.tryCompletePass(passId);
  }

  private async onPassPiece(peerId: string, msg: MediaCoinMessage): Promise<void> {
    const { passId, chunk } = (msg.payload ?? {}) as { passId?: string; chunk?: MediaChunk };
    if (!passId || !chunk || chunk.index == null) return;
    const entry = this.passEntry(passId, msg.coinId, peerId);
    entry.pieces.set(chunk.index, chunk);
    await this.tryCompletePass(passId);
  }

  private async tryCompletePass(passId: string): Promise<void> {
    const entry = this.incoming.get(passId);
    if (!entry?.manifest || !entry.route) return;
    const { manifest, from } = entry;
    if (entry.pieces.size < manifest.totalChunks) return;
    this.incoming.delete(passId);

    // Every piece must match the hash the manifest's Merkle root commits to.
    for (let i = 0; i < manifest.totalChunks; i++) {
      const piece = entry.pieces.get(i);
      if (!piece || (await sha256hex(piece.data)) !== manifest.chunkHashes[i]) {
        console.warn(`[MediaCoin] ❌ Coin ${manifest.coinId} from ${from.slice(0, 8)} failed verification`);
        return;
      }
    }

    const local = this.transport.localPeerId;
    const route: MediaCoinRoute = {
      creatorId: entry.route.creatorId,
      hops: [...entry.route.hops, local],
      ttl: Math.max(0, entry.route.ttl - 1),
    };

    if (local === route.creatorId) {
      this.held.delete(manifest.coinId);
      const done: MediaCoinLoopComplete = { coinId: manifest.coinId, route };
      for (const cb of this.loopListeners) cb(done);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("media-coin-loop-complete", { detail: done }));
      }
      console.log(`[MediaCoin] 🏁 ${manifest.coinId} looped home after ${route.hops.length - 2} peers`);
      return;
    }

    // Unpack: keep the coin's chunks so this peer can serve and pass it on.
    this.manifests.set(manifest.coinId, manifest);
    this.chunks.set(manifest.coinId, new Map(entry.pieces));

    try {
      const bytes = await this.assembleBytes(manifest.coinId);
      if (bytes) {
        const unpacked: MediaCoinUnpacked = { manifest, route, fromPeerId: from, bytes };
        for (const cb of this.unpackListeners) await cb(unpacked);
      }
    } catch (err) {
      console.warn(`[MediaCoin] Unpack of ${manifest.coinId} failed`, err);
    }

    this.forward(manifest.coinId, route);
  }

  /** Full plaintext bytes of a locally held coin. */
  private async assembleBytes(coinId: string): Promise<Uint8Array | null> {
    const manifest = this.manifests.get(coinId);
    const chunkMap = this.chunks.get(coinId);
    if (!manifest || !chunkMap) return null;
    const key = manifest.encryptionKey && manifest.encryptionIvPrefix
      ? await crypto.subtle.importKey("raw", b642ab(manifest.encryptionKey), { name: "AES-GCM" }, false, ["decrypt"])
      : null;
    const ivPrefix = manifest.encryptionIvPrefix ? new Uint8Array(b642ab(manifest.encryptionIvPrefix)) : null;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) return null;
      let buf = b642ab(chunk.data);
      if (key && ivPrefix) {
        const iv = new Uint8Array(12);
        iv.set(ivPrefix.subarray(0, 4), 0);
        new DataView(iv.buffer).setUint32(4, i);
        buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, buf);
      }
      parts.push(new Uint8Array(buf));
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private getOrCreatePeer(
    coinId: string,
    peerId: string
  ): PeerChunkState {
    if (!this.peerState.has(coinId)) {
      this.peerState.set(coinId, new Map());
    }
    const pm = this.peerState.get(coinId)!;
    if (!pm.has(peerId)) {
      pm.set(peerId, {
        peerId,
        haveChunks: new Set(),
        inflight: new Set(),
        lastSeen: Date.now(),
        failures: 0,
        chunksServed: 0,
      });
    }
    return pm.get(peerId)!;
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUERY API
  // ═══════════════════════════════════════════════════════════════════

  getManifest(coinId: string): MediaCoinManifest | undefined {
    return this.manifests.get(coinId);
  }

  getAllManifests(): MediaCoinManifest[] {
    return Array.from(this.manifests.values());
  }

  getChunkCount(coinId: string): number {
    return this.chunks.get(coinId)?.size ?? 0;
  }

  hasAllChunks(coinId: string): boolean {
    const manifest = this.manifests.get(coinId);
    if (!manifest) return false;
    return (this.chunks.get(coinId)?.size ?? 0) >= manifest.totalChunks;
  }

  /** Get hosting stats for reward calculation */
  getHostingStats(coinId: string): Map<string, number> {
    const stats = new Map<string, number>();
    const pm = this.peerState.get(coinId);
    if (!pm) return stats;
    for (const [peerId, ps] of pm) {
      if (ps.chunksServed > 0) stats.set(peerId, ps.chunksServed);
    }
    return stats;
  }

  /**
   * Get the number of peers that hold all chunks for a coin (full holders).
   * Based on peer state from the last protocol exchange.
   */
  getCoinHolderCount(coinId: string): number {
    const manifest = this.manifests.get(coinId);
    const pm = this.peerState.get(coinId);
    if (!manifest || !pm) return 0;
    let holders = 0;
    // Count self if we have all chunks
    if ((this.chunks.get(coinId)?.size ?? 0) >= manifest.totalChunks) holders++;
    for (const [, ps] of pm) {
      if (ps.haveChunks.size >= manifest.totalChunks) holders++;
    }
    return holders;
  }

  /**
   * Get the number of peers with any chunks for a coin (partial + full).
   */
  getCoinSeederCount(coinId: string): number {
    const pm = this.peerState.get(coinId);
    if (!pm) return 0;
    let count = 0;
    // Count self
    if ((this.chunks.get(coinId)?.size ?? 0) > 0) count++;
    for (const [, ps] of pm) {
      if (ps.haveChunks.size > 0) count++;
    }
    return count;
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

export function getMediaCoinEngine(
  transport: MeshTransportAdapter
): MediaCoinEngine {
  if (!_instance) {
    _instance = new MediaCoinEngine(transport);
  }
  return _instance;
}

export function getActiveMediaCoinEngine(): MediaCoinEngine | null {
  return _instance;
}

export function resetMediaCoinEngine(): void {
  _instance?.stop();
  _instance = null;
}
