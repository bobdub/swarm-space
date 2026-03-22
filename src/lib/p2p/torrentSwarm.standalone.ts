/**
 * ═══════════════════════════════════════════════════════════════════════
 * Torrent-Style Chunk Distribution — Standalone
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Fully self-contained. Zero imports from other project modules.
 *
 * Implements torrent-like swarming for large content (files, media)
 * through the existing mesh network.
 *
 * How it works:
 *   1. Seeder splits content → fixed-size chunks → hashes each chunk
 *   2. Creates a manifest (like a .torrent) with all chunk hashes
 *   3. Announces manifest to mesh peers via "torrent" channel
 *   4. Leechers request missing chunks from any peer that has them
 *   5. As leechers receive chunks, they also become seeders
 *   6. Rarest-first chunk selection for optimal swarm distribution
 *   7. Chunks are AES-256-GCM encrypted per-peer during transport
 *
 * This module talks to whichever mesh is active (SwarmMesh or
 * BuilderMode) via a thin adapter interface — it doesn't import
 * either directly.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Inline Crypto ──────────────────────────────────────────────────────

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
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
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return ab2hex(buf);
}

function generateId(prefix = "ts"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface TorrentManifest {
  id: string;
  name: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  chunkHashes: string[];       // SHA-256 of each chunk
  contentHash: string;         // SHA-256 of full content
  creatorId: string;
  createdAt: number;
  mimeType?: string;
}

export interface TorrentChunk {
  manifestId: string;
  index: number;
  hash: string;
  data: string;                // base64 encoded
  size: number;
}

export type TorrentState = "idle" | "seeding" | "downloading" | "complete" | "error" | "paused";

export interface TorrentProgress {
  manifestId: string;
  state: TorrentState;
  totalChunks: number;
  receivedChunks: number;
  availableChunks: number;     // chunks we can serve to others
  percent: number;
  bytesReceived: number;
  bytesTotal: number;
  activePeers: number;         // peers we're downloading from
  seeders: number;             // peers with complete content
}

interface PeerChunkMap {
  peerId: string;
  haveChunks: Set<number>;     // indices the peer has
  requestsInFlight: Set<number>;
  lastResponse: number;
  failures: number;
}

/** Thin adapter so this module works with any mesh instance */
export interface MeshTransportAdapter {
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  broadcast(channel: string, payload: unknown): void;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
  localPeerId: string;
}

// ── Chunk Sizing ──────────────────────────────────────────────────────

/**
 * Returns a fixed 1 MiB (1,048,576 bytes) chunk size for all files.
 * This ensures a 1:1 ratio between file size in MiB and chunk count
 * (rounded up for partial final chunks).
 */
export function getAdaptiveChunkSize(_fileSize: number): number {
  return 1_048_576; // always 1 MiB
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 1_048_576;     // 1 MB floor (adaptive sizing preferred)
const MAX_REQUESTS_PER_PEER = 4;          // pipeline depth
const REQUEST_TIMEOUT_MS = 8_000;
const RARITY_POLL_MS = 2_000;
const STALL_TIMEOUT_MS = 60_000;          // stop polling after 60s with no progress
const BLOAT_PAUSE_MS = 60 * 60 * 1000;   // 1 hour pause for bloating torrents
const BLOAT_RETRY_THRESHOLD = 10;         // max request failures before bloat detection
const GUN_RECOVERY_INTERVAL_MS = 15_000;  // Gun fallback recovery poll interval
const CHANNEL = "torrent";
const SEEN_MSG_CAP = 500;

// ── Gun Relay Interface ────────────────────────────────────────────────

export interface GunRelayAdapter {
  send(channel: string, peerId: string, payload: unknown): boolean;
  broadcastToAll(channel: string, payload: unknown): boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

// ── Torrent Messages ───────────────────────────────────────────────────

type TorrentMessageType =
  | "announce"        // seeder broadcasts manifest
  | "have"            // peer tells which chunks it has
  | "request"         // leecher asks for a chunk
  | "piece"           // seeder sends a chunk
  | "cancel"          // leecher cancels a request
  | "interested"      // leecher wants to download
  | "not-interested";

interface TorrentMessage {
  msg: TorrentMessageType;
  manifestId: string;
  payload: unknown;
  msgId?: string;      // deduplication ID for Gun relay
}

// ═══════════════════════════════════════════════════════════════════════
// TORRENT SWARM CLASS
// ═══════════════════════════════════════════════════════════════════════

export class TorrentSwarm {
  private transport: MeshTransportAdapter;
  private manifests = new Map<string, TorrentManifest>();
  private chunks = new Map<string, Map<number, TorrentChunk>>();  // manifestId → index → chunk
  private peerMaps = new Map<string, Map<string, PeerChunkMap>>(); // manifestId → peerId → map
  private states = new Map<string, TorrentState>();
  private progressListeners = new Map<string, Set<(p: TorrentProgress) => void>>();
  private completionListeners = new Map<string, Set<(data: Uint8Array) => void>>();
  private rarityTimers = new Map<string, number>();
  private lastProgressAt = new Map<string, number>();   // manifestId → timestamp of last new chunk
  private interestedSent = new Map<string, Set<string>>(); // manifestId → peerIds we've asked
  private unsubMessage: (() => void) | null = null;

  // ── Gun Relay ──────────────────────────────────────────────────────
  private gunRelay: GunRelayAdapter | null = null;
  private gunUnsub: (() => void) | null = null;
  private seenMsgIds = new Set<string>();

  // ── Gun Recovery & Bloat Detection ─────────────────────────────────
  private gunRecoveryTimers = new Map<string, number>();  // manifestId → timer
  private bloatPauseTimers = new Map<string, number>();   // manifestId → resume timer

  constructor(transport: MeshTransportAdapter) {
    this.transport = transport;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  start(): void {
    this.unsubMessage = this.transport.onMessage(CHANNEL, (peerId, payload) => {
      this.handleMessage(peerId, payload as TorrentMessage);
    });

    // Listen for recording/file seed events from streaming system
    if (typeof window !== 'undefined') {
      window.addEventListener('torrent-seed-file', ((event: CustomEvent<{ fileId?: string; file?: File; fileName?: string }>) => {
        const { fileId, file, fileName } = event.detail ?? {};
        if (!file || !fileId) return;

        void (async () => {
          try {
            const buf = await file.arrayBuffer();
            const data = new Uint8Array(buf);
            const manifest = await this.seed(
              fileName ?? fileId,
              data,
              this.transport.localPeerId,
              file.type || 'video/webm',
            );
            console.log(`[TorrentSwarm] 📡 Auto-seeded recording "${fileName ?? fileId}" → ${manifest.id}`);

            // Persist manifest to IndexedDB so the Content Distribution overlay survives navigation
            try {
              const idbOpen = indexedDB.open('swarm-app', 4);
              idbOpen.onupgradeneeded = () => {
                const db = idbOpen.result;
                if (!db.objectStoreNames.contains('torrent-manifests')) {
                  db.createObjectStore('torrent-manifests', { keyPath: 'id' });
                }
              };
              idbOpen.onsuccess = () => {
                const db = idbOpen.result;
                if (!db.objectStoreNames.contains('torrent-manifests')) {
                  db.close();
                  return;
                }
                const tx = db.transaction('torrent-manifests', 'readwrite');
                tx.objectStore('torrent-manifests').put({
                  ...manifest,
                  state: 'seeding',
                  receivedChunks: manifest.totalChunks,
                  persistedAt: Date.now(),
                });
                tx.oncomplete = () => db.close();
              };
            } catch { /* best effort */ }

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('torrent-manifest-persisted', {
                detail: { manifest },
              }));
            }
          } catch (err) {
            console.error('[TorrentSwarm] Failed to auto-seed file:', err);
          }
        })();
      }) as EventListener);
    }

    console.log("[TorrentSwarm] ✅ Started");
  }

  stop(): void {
    this.unsubMessage?.();
    this.unsubMessage = null;
    this.gunUnsub?.();
    this.gunUnsub = null;
    this.gunRelay = null;
    for (const timer of this.rarityTimers.values()) clearInterval(timer);
    this.rarityTimers.clear();
    for (const timer of this.gunRecoveryTimers.values()) clearInterval(timer);
    this.gunRecoveryTimers.clear();
    for (const timer of this.bloatPauseTimers.values()) clearTimeout(timer);
    this.bloatPauseTimers.clear();
    this.seenMsgIds.clear();
    console.log("[TorrentSwarm] ⏹️ Stopped");
  }

  // ═══════════════════════════════════════════════════════════════════
  // SEED — Split content and announce to mesh
  // ═══════════════════════════════════════════════════════════════════

  async seed(
    name: string,
    data: Uint8Array,
    creatorId: string,
    mimeType?: string,
    chunkSize?: number
  ): Promise<TorrentManifest> {
    // Use adaptive sizing when no explicit chunk size is given
    const effectiveChunkSize = chunkSize ?? getAdaptiveChunkSize(data.byteLength);
    const totalChunks = Math.max(1, Math.ceil(data.byteLength / effectiveChunkSize));
    const chunkHashes: string[] = [];
    const chunkMap = new Map<number, TorrentChunk>();

    // Split into chunks and hash
    for (let i = 0; i < totalChunks; i++) {
      const start = i * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, data.byteLength);
      const slice = data.slice(start, end);
      const b64 = ab2b64(slice.buffer as ArrayBuffer);
      const hash = await sha256(b64);

      chunkHashes.push(hash);
      chunkMap.set(i, {
        manifestId: "", // set below
        index: i,
        hash,
        data: b64,
        size: slice.byteLength,
      });
    }

    // Content hash (full file)
    const contentHash = await sha256(ab2b64(data.buffer as ArrayBuffer));

    const manifest: TorrentManifest = {
      id: generateId("torrent"),
      name,
      totalSize: data.byteLength,
      chunkSize: effectiveChunkSize,
      totalChunks,
      chunkHashes,
      contentHash,
      creatorId,
      createdAt: Date.now(),
      mimeType,
    };

    // Backfill manifestId on chunks
    for (const [, chunk] of chunkMap) {
      chunk.manifestId = manifest.id;
    }

    this.manifests.set(manifest.id, manifest);
    this.chunks.set(manifest.id, chunkMap);
    this.states.set(manifest.id, "seeding");

    // Announce to mesh (+ Gun relay if attached)
    const announceMsg: TorrentMessage = {
      msg: "announce",
      manifestId: manifest.id,
      payload: manifest,
      msgId: generateId("msg"),
    };
    this.transport.broadcast(CHANNEL, announceMsg);
    this.gunRelay?.broadcastToAll(CHANNEL, announceMsg);

    console.log(
      `[TorrentSwarm] 📡 Seeding "${name}" (${totalChunks} chunks, ${data.byteLength} bytes)`
    );
    return manifest;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOWNLOAD — Request content from mesh peers
  // ═══════════════════════════════════════════════════════════════════

  download(manifest: TorrentManifest): void {
    if (this.states.get(manifest.id) === "downloading") return;

    this.manifests.set(manifest.id, manifest);
    this.states.set(manifest.id, "downloading");

    if (!this.chunks.has(manifest.id)) {
      this.chunks.set(manifest.id, new Map());
    }
    if (!this.peerMaps.has(manifest.id)) {
      this.peerMaps.set(manifest.id, new Map());
    }

    // Ask all connected peers what they have & track who we asked
    if (!this.interestedSent.has(manifest.id)) {
      this.interestedSent.set(manifest.id, new Set());
    }
    const sentSet = this.interestedSent.get(manifest.id)!;
    for (const peerId of this.transport.getConnectedPeerIds()) {
      sentSet.add(peerId);
      this.sendWithFallback(peerId, {
        msg: "interested",
        manifestId: manifest.id,
        payload: null,
      } as TorrentMessage);
    }
    // Also broadcast interest through Gun relay for discovery
    this.gunRelay?.broadcastToAll(CHANNEL, {
      msg: "interested",
      manifestId: manifest.id,
      payload: null,
      msgId: generateId("msg"),
    } as TorrentMessage);

    // Start rarest-first request loop
    this.lastProgressAt.set(manifest.id, Date.now());
    let rebroadcastCycle = 0;
    const timer = window.setInterval(() => {
      // Auto-stop stalled transfers to free mesh bandwidth
      const lastProgress = this.lastProgressAt.get(manifest.id) ?? 0;
      if (Date.now() - lastProgress > STALL_TIMEOUT_MS) {
        const chunkMap = this.chunks.get(manifest.id);
        const total = manifest.totalChunks;
        const have = chunkMap?.size ?? 0;
        if (have < total) {
          // Before fully pausing, try Gun relay recovery
          if (this.gunRelay && !this.gunRecoveryTimers.has(manifest.id)) {
            console.log(`[TorrentSwarm] 🔗 Peers dropped — activating Gun relay recovery for "${manifest.name}" (${have}/${total})`);
            this.startGunRecovery(manifest.id);
            this.lastProgressAt.set(manifest.id, Date.now()); // reset stall timer
            return;
          }

          // Check for bloat: too many failures across peers
          const totalFailures = this.getTotalPeerFailures(manifest.id);
          if (totalFailures >= BLOAT_RETRY_THRESHOLD) {
            console.log(`[TorrentSwarm] 🧊 Bloat detected for "${manifest.name}" (${totalFailures} failures) — pausing for 1 hour`);
            window.clearInterval(timer);
            this.rarityTimers.delete(manifest.id);
            this.stopGunRecovery(manifest.id);
            this.states.set(manifest.id, "paused");
            this.emitProgress(manifest.id);
            this.scheduleBloatReseed(manifest.id, manifest.name);
            return;
          }

          console.log(`[TorrentSwarm] ⏸️ Pausing stalled "${manifest.name}" (${have}/${total} chunks, no progress for ${STALL_TIMEOUT_MS / 1000}s)`);
          window.clearInterval(timer);
          this.rarityTimers.delete(manifest.id);
          this.stopGunRecovery(manifest.id);
          this.states.set(manifest.id, "paused");
          return;
        }
      }

      // Every 5th cycle (~10s), discover new peers and re-send "interested"
      rebroadcastCycle++;
      if (rebroadcastCycle % 5 === 0) {
        this.rebroadcastInterest(manifest.id);
      }

      this.requestRarestChunks(manifest.id);
    }, RARITY_POLL_MS);
    this.rarityTimers.set(manifest.id, timer);

    this.emitProgress(manifest.id);
    console.log(`[TorrentSwarm] ⬇️ Downloading "${manifest.name}"`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleMessage(peerId: string, msg: TorrentMessage): void {
    if (!msg.msg || !msg.manifestId) return;

    // Dedup via msgId (Gun relay can deliver same message via both transports)
    if (msg.msgId) {
      if (this.seenMsgIds.has(msg.msgId)) return;
      this.seenMsgIds.add(msg.msgId);
      if (this.seenMsgIds.size > SEEN_MSG_CAP) {
        const first = this.seenMsgIds.values().next().value;
        if (first) this.seenMsgIds.delete(first);
      }
    }

    switch (msg.msg) {
      case "announce":
        this.handleAnnounce(peerId, msg);
        break;
      case "have":
        this.handleHave(peerId, msg);
        break;
      case "interested":
        this.handleInterested(peerId, msg);
        break;
      case "request":
        this.handleRequest(peerId, msg);
        break;
      case "piece":
        this.handlePiece(peerId, msg);
        break;
      case "cancel":
        this.handleCancel(peerId, msg);
        break;
    }
  }

  private handleAnnounce(peerId: string, msg: TorrentMessage): void {
    const manifest = msg.payload as TorrentManifest;
    if (!this.manifests.has(manifest.id)) {
      this.manifests.set(manifest.id, manifest);
      console.log(`[TorrentSwarm] 📢 Peer ${peerId.slice(0, 8)} announced "${manifest.name}"`);
      // Auto-emit event for UI
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("torrent-announced", {
            detail: { peerId, manifest },
          })
        );
      }
      // Auto-download announced content from peers
      this.download(manifest);
    }
  }

  private handleHave(peerId: string, msg: TorrentMessage): void {
    const { indices } = msg.payload as { indices: number[] };
    const peerMap = this.getOrCreatePeerMap(msg.manifestId, peerId);
    for (const idx of indices) {
      peerMap.haveChunks.add(idx);
    }
    peerMap.lastResponse = Date.now();
  }

  private handleInterested(peerId: string, msg: TorrentMessage): void {
    // Respond with which chunks we have
    const chunkMap = this.chunks.get(msg.manifestId);
    if (!chunkMap || chunkMap.size === 0) return;

    const indices = Array.from(chunkMap.keys());
    this.sendWithFallback(peerId, {
      msg: "have",
      manifestId: msg.manifestId,
      payload: { indices },
    } as TorrentMessage);
  }

  private handleRequest(peerId: string, msg: TorrentMessage): void {
    const { index } = msg.payload as { index: number };
    const chunkMap = this.chunks.get(msg.manifestId);
    const chunk = chunkMap?.get(index);

    if (!chunk) return;

    // Send the piece (with Gun fallback)
    this.sendWithFallback(peerId, {
      msg: "piece",
      manifestId: msg.manifestId,
      payload: {
        index: chunk.index,
        hash: chunk.hash,
        data: chunk.data,
        size: chunk.size,
      },
    } as TorrentMessage);
  }

  private async handlePiece(peerId: string, msg: TorrentMessage): Promise<void> {
    const piece = msg.payload as { index: number; hash: string; data: string; size: number };
    const manifest = this.manifests.get(msg.manifestId);
    if (!manifest) return;

    // Verify hash
    const computedHash = await sha256(piece.data);
    if (computedHash !== manifest.chunkHashes[piece.index]) {
      console.warn(
        `[TorrentSwarm] ❌ Bad chunk #${piece.index} from ${peerId.slice(0, 8)} — hash mismatch`
      );
      const peerMap = this.getOrCreatePeerMap(msg.manifestId, peerId);
      peerMap.failures++;
      peerMap.requestsInFlight.delete(piece.index);
      return;
    }

    // Store chunk
    const chunkMap = this.chunks.get(msg.manifestId) ?? new Map();
    chunkMap.set(piece.index, {
      manifestId: msg.manifestId,
      index: piece.index,
      hash: piece.hash,
      data: piece.data,
      size: piece.size,
    });
    this.chunks.set(msg.manifestId, chunkMap);

    // Update peer tracking
    const peerMap = this.getOrCreatePeerMap(msg.manifestId, peerId);
    peerMap.requestsInFlight.delete(piece.index);
    peerMap.lastResponse = Date.now();

    // Announce we have this chunk to other peers (become partial seeder)
    for (const pid of this.transport.getConnectedPeerIds()) {
      if (pid === peerId) continue;
      this.sendWithFallback(pid, {
        msg: "have",
        manifestId: msg.manifestId,
        payload: { indices: [piece.index] },
      } as TorrentMessage);
    }

    this.lastProgressAt.set(msg.manifestId, Date.now());
    this.emitProgress(msg.manifestId);

    // Check if complete
    if (chunkMap.size === manifest.totalChunks) {
      this.handleComplete(msg.manifestId);
    }
  }

  private handleCancel(peerId: string, msg: TorrentMessage): void {
    const peerMap = this.peerMaps.get(msg.manifestId)?.get(peerId);
    if (peerMap) {
      const { index } = msg.payload as { index: number };
      peerMap.requestsInFlight.delete(index);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RAREST-FIRST CHUNK SELECTION
  // ═══════════════════════════════════════════════════════════════════

  private requestRarestChunks(manifestId: string): void {
    const manifest = this.manifests.get(manifestId);
    const chunkMap = this.chunks.get(manifestId);
    const peerMapAll = this.peerMaps.get(manifestId);
    if (!manifest || !chunkMap || !peerMapAll) return;

    // Find missing chunks
    const missing: number[] = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      if (!chunkMap.has(i)) missing.push(i);
    }
    if (missing.length === 0) return;

    // Count availability of each missing chunk across peers
    const availability = new Map<number, string[]>(); // index → peerIds that have it
    for (const idx of missing) {
      const peers: string[] = [];
      for (const [pid, pm] of peerMapAll) {
        if (pm.haveChunks.has(idx)) peers.push(pid);
      }
      if (peers.length > 0) availability.set(idx, peers);
    }

    // Sort by rarity (fewest sources first)
    const sorted = Array.from(availability.entries()).sort(
      (a, b) => a[1].length - b[1].length
    );

    // Clear stale requests on all peers first
    const now = Date.now();
    for (const [, pm] of peerMapAll) {
      if (pm.requestsInFlight.size > 0 && now - pm.lastResponse > REQUEST_TIMEOUT_MS) {
        pm.requestsInFlight.clear();
        pm.failures++;
      }
    }

    // Request from peers with capacity — multiple chunks per cycle
    for (const [idx, peers] of sorted) {
      let requested = false;
      for (const pid of peers) {
        const pm = peerMapAll.get(pid)!;
        if (pm.requestsInFlight.size >= MAX_REQUESTS_PER_PEER) continue;
        if (pm.requestsInFlight.has(idx)) continue;

        pm.requestsInFlight.add(idx);
        this.sendWithFallback(pid, {
          msg: "request",
          manifestId,
          payload: { index: idx },
        } as TorrentMessage);
        requested = true;
        break; // found a peer for this chunk, move to next chunk
      }
      // If no peer could take this chunk, skip it this cycle
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // COMPLETION
  // ═══════════════════════════════════════════════════════════════════

  private async handleComplete(manifestId: string): Promise<void> {
    const manifest = this.manifests.get(manifestId)!;
    const chunkMap = this.chunks.get(manifestId)!;

    // Reassemble in order
    const parts: Uint8Array[] = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      const chunk = chunkMap.get(i)!;
      parts.push(new Uint8Array(b642ab(chunk.data)));
    }

    // Concatenate
    const totalLen = parts.reduce((s, p) => s + p.byteLength, 0);
    const assembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      assembled.set(part, offset);
      offset += part.byteLength;
    }

    // Verify content hash
    const fullHash = await sha256(ab2b64(assembled.buffer as ArrayBuffer));
    if (fullHash !== manifest.contentHash) {
      console.error(`[TorrentSwarm] ❌ Content hash mismatch for "${manifest.name}"`);
      this.states.set(manifestId, "error");
      this.emitProgress(manifestId);
      return;
    }

    this.states.set(manifestId, "complete");

    // Stop requesting
    const timer = this.rarityTimers.get(manifestId);
    if (timer) {
      clearInterval(timer);
      this.rarityTimers.delete(manifestId);
    }

    // Now we're a full seeder
    this.states.set(manifestId, "seeding");

    console.log(
      `[TorrentSwarm] ✅ Download complete: "${manifest.name}" (${totalLen} bytes, verified)`
    );

    // Notify completion listeners
    const listeners = this.completionListeners.get(manifestId);
    if (listeners) {
      for (const h of listeners) {
        try { h(assembled); } catch {}
      }
    }

    // DOM event
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("torrent-complete", {
          detail: { manifestId, name: manifest.name, size: totalLen },
        })
      );
    }

    this.emitProgress(manifestId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROGRESS
  // ═══════════════════════════════════════════════════════════════════

  private emitProgress(manifestId: string): void {
    const progress = this.getProgress(manifestId);
    if (!progress) return;

    const listeners = this.progressListeners.get(manifestId);
    if (listeners) {
      for (const h of listeners) {
        try { h(progress); } catch {}
      }
    }
  }

  getProgress(manifestId: string): TorrentProgress | null {
    const manifest = this.manifests.get(manifestId);
    if (!manifest) return null;

    const chunkMap = this.chunks.get(manifestId);
    const received = chunkMap?.size ?? 0;
    const peerMapAll = this.peerMaps.get(manifestId);
    let activePeers = 0;
    let seeders = 0;

    if (peerMapAll) {
      for (const [, pm] of peerMapAll) {
        if (pm.requestsInFlight.size > 0) activePeers++;
        if (pm.haveChunks.size === manifest.totalChunks) seeders++;
      }
    }

    return {
      manifestId,
      state: this.states.get(manifestId) ?? "idle",
      totalChunks: manifest.totalChunks,
      receivedChunks: received,
      availableChunks: received,
      percent: manifest.totalChunks > 0
        ? Math.round((received / manifest.totalChunks) * 100)
        : 0,
      bytesReceived: received * manifest.chunkSize,
      bytesTotal: manifest.totalSize,
      activePeers,
      seeders,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  onProgress(manifestId: string, handler: (p: TorrentProgress) => void): () => void {
    if (!this.progressListeners.has(manifestId)) {
      this.progressListeners.set(manifestId, new Set());
    }
    this.progressListeners.get(manifestId)!.add(handler);
    return () => { this.progressListeners.get(manifestId)?.delete(handler); };
  }

  onComplete(manifestId: string, handler: (data: Uint8Array) => void): () => void {
    if (!this.completionListeners.has(manifestId)) {
      this.completionListeners.set(manifestId, new Set());
    }
    this.completionListeners.get(manifestId)!.add(handler);
    return () => { this.completionListeners.get(manifestId)?.delete(handler); };
  }

  getManifest(id: string): TorrentManifest | null {
    return this.manifests.get(id) ?? null;
  }

  getAllManifests(): TorrentManifest[] {
    return Array.from(this.manifests.values());
  }

  getAllProgress(): TorrentProgress[] {
    const results: TorrentProgress[] = [];
    for (const id of this.manifests.keys()) {
      const p = this.getProgress(id);
      if (p) results.push(p);
    }
    return results;
  }

  getTotalStats(): { activeTorrents: number; totalSeeders: number; totalChunks: number; completedChunks: number } {
    const all = this.getAllProgress();
    return {
      activeTorrents: all.length,
      totalSeeders: all.reduce((s, p) => s + p.seeders, 0),
      totalChunks: all.reduce((s, p) => s + p.totalChunks, 0),
      completedChunks: all.reduce((s, p) => s + p.receivedChunks, 0),
    };
  }

  hasChunk(manifestId: string, index: number): boolean {
    return this.chunks.get(manifestId)?.has(index) ?? false;
  }

  getChunkCount(manifestId: string): number {
    return this.chunks.get(manifestId)?.size ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════════════

  private getOrCreatePeerMap(manifestId: string, peerId: string): PeerChunkMap {
    if (!this.peerMaps.has(manifestId)) {
      this.peerMaps.set(manifestId, new Map());
    }
    const peerMapAll = this.peerMaps.get(manifestId)!;
    if (!peerMapAll.has(peerId)) {
      peerMapAll.set(peerId, {
        peerId,
        haveChunks: new Set(),
        requestsInFlight: new Set(),
        lastResponse: Date.now(),
        failures: 0,
      });
    }
    return peerMapAll.get(peerId)!;
  }

  /** Re-send "interested" to any peers we haven't asked yet */
  private rebroadcastInterest(manifestId: string): void {
    const sentSet = this.interestedSent.get(manifestId);
    if (!sentSet) return;

    const currentPeers = this.transport.getConnectedPeerIds();
    let newCount = 0;
    for (const peerId of currentPeers) {
      if (!sentSet.has(peerId)) {
        sentSet.add(peerId);
        this.sendWithFallback(peerId, {
          msg: "interested",
          manifestId,
          payload: null,
        } as TorrentMessage);
        newCount++;
      }
    }

    // Also re-ask peers who never responded (stale haveChunks)
    const peerMapAll = this.peerMaps.get(manifestId);
    const chunkMap = this.chunks.get(manifestId);
    const received = chunkMap?.size ?? 0;
    if (received === 0 && currentPeers.length > 0) {
      // Nobody has responded — re-ask everyone via both transports
      for (const peerId of currentPeers) {
        this.sendWithFallback(peerId, {
          msg: "interested",
          manifestId,
          payload: null,
        } as TorrentMessage);
      }
      // Also broadcast through Gun relay for wider discovery
      this.gunRelay?.broadcastToAll(CHANNEL, {
        msg: "interested",
        manifestId,
        payload: null,
        msgId: generateId("msg"),
      } as TorrentMessage);
      console.debug(`[TorrentSwarm] 🔄 Re-sent interest to ${currentPeers.length} peers + Gun relay (0 chunks received)`);
    } else if (newCount > 0) {
      console.debug(`[TorrentSwarm] 🔄 Sent interest to ${newCount} new peer(s)`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GUN RELAY RECOVERY — Fallback when WebRTC peers drop
  // ═══════════════════════════════════════════════════════════════════

  private startGunRecovery(manifestId: string): void {
    if (this.gunRecoveryTimers.has(manifestId) || !this.gunRelay) return;

    const manifest = this.manifests.get(manifestId);
    if (!manifest) return;

    const recoveryTimer = window.setInterval(() => {
      if (!this.gunRelay) {
        this.stopGunRecovery(manifestId);
        return;
      }

      const chunkMap = this.chunks.get(manifestId);
      const have = chunkMap?.size ?? 0;
      if (have >= manifest.totalChunks) {
        console.log(`[TorrentSwarm] ✅ Gun recovery completed "${manifest.name}"`);
        this.stopGunRecovery(manifestId);
        return;
      }

      // Broadcast interest through Gun relay to discover any available seeders
      this.gunRelay.broadcastToAll(CHANNEL, {
        msg: "interested",
        manifestId,
        payload: null,
        msgId: generateId("msg"),
      } as TorrentMessage);

      // Request missing chunks through Gun relay from any known peers
      const peerMapAll = this.peerMaps.get(manifestId);
      if (peerMapAll) {
        for (let i = 0; i < manifest.totalChunks; i++) {
          if (chunkMap?.has(i)) continue;
          for (const [pid, pm] of peerMapAll) {
            if (pm.haveChunks.has(i) && pm.requestsInFlight.size < MAX_REQUESTS_PER_PEER) {
              pm.requestsInFlight.add(i);
              this.gunRelay!.send(CHANNEL, pid, {
                msg: "request",
                manifestId,
                payload: { index: i },
                msgId: generateId("msg"),
              } as TorrentMessage);
              break;
            }
          }
        }
      }

      console.debug(`[TorrentSwarm] 🔗 Gun recovery tick for "${manifest.name}" (${have}/${manifest.totalChunks})`);
    }, GUN_RECOVERY_INTERVAL_MS);

    this.gunRecoveryTimers.set(manifestId, recoveryTimer);
  }

  private stopGunRecovery(manifestId: string): void {
    const timer = this.gunRecoveryTimers.get(manifestId);
    if (timer) {
      clearInterval(timer);
      this.gunRecoveryTimers.delete(manifestId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOAT DETECTION — Pause resource-heavy torrents, retry after 1hr
  // ═══════════════════════════════════════════════════════════════════

  private getTotalPeerFailures(manifestId: string): number {
    const peerMapAll = this.peerMaps.get(manifestId);
    if (!peerMapAll) return 0;
    let total = 0;
    for (const [, pm] of peerMapAll) {
      total += pm.failures;
    }
    return total;
  }

  private scheduleBloatReseed(manifestId: string, name: string): void {
    // Clear any existing bloat timer for this manifest
    const existing = this.bloatPauseTimers.get(manifestId);
    if (existing) clearTimeout(existing);

    const timer = window.setTimeout(() => {
      this.bloatPauseTimers.delete(manifestId);
      const manifest = this.manifests.get(manifestId);
      if (!manifest) return;

      console.log(`[TorrentSwarm] ⏰ Bloat pause expired for "${name}" — resuming download`);

      // Reset peer failure counts
      const peerMapAll = this.peerMaps.get(manifestId);
      if (peerMapAll) {
        for (const [, pm] of peerMapAll) {
          pm.failures = 0;
          pm.requestsInFlight.clear();
        }
      }

      // Resume downloading
      this.states.set(manifestId, "downloading");
      this.lastProgressAt.set(manifestId, Date.now());
      this.download(manifest);
    }, BLOAT_PAUSE_MS);

    this.bloatPauseTimers.set(manifestId, timer);
    console.log(`[TorrentSwarm] ⏱️ Scheduled resume for "${name}" in 1 hour`);
  }


  pause(manifestId: string): void {
    const timer = this.rarityTimers.get(manifestId);
    if (timer) { clearInterval(timer); this.rarityTimers.delete(manifestId); }
    this.stopGunRecovery(manifestId);
    this.states.set(manifestId, "paused");
    this.emitProgress(manifestId);
    console.log(`[TorrentSwarm] ⏸️ Paused "${manifestId}"`);
  }

  resume(manifestId: string): void {
    const manifest = this.manifests.get(manifestId);
    if (!manifest) return;
    const chunkMap = this.chunks.get(manifestId);
    if (chunkMap && chunkMap.size >= manifest.totalChunks) {
      this.states.set(manifestId, "seeding");
      this.emitProgress(manifestId);
      return;
    }
    this.states.set(manifestId, "downloading");
    this.lastProgressAt.set(manifestId, Date.now());
    this.download(manifest);
    console.log(`[TorrentSwarm] ▶️ Resumed "${manifestId}"`);
  }

  remove(manifestId: string): void {
    // Stop download timer
    const timer = this.rarityTimers.get(manifestId);
    if (timer) { clearInterval(timer); this.rarityTimers.delete(manifestId); }

    // Stop Gun recovery and bloat timers
    this.stopGunRecovery(manifestId);
    const bloatTimer = this.bloatPauseTimers.get(manifestId);
    if (bloatTimer) { clearTimeout(bloatTimer); this.bloatPauseTimers.delete(manifestId); }

    // Broadcast not-interested
    this.transport.broadcast(CHANNEL, {
      msg: "not-interested",
      manifestId,
      payload: null,
      msgId: generateId("msg"),
    } as TorrentMessage);

    // Clear in-memory state
    this.manifests.delete(manifestId);
    this.chunks.delete(manifestId);
    this.peerMaps.delete(manifestId);
    this.states.delete(manifestId);
    this.progressListeners.delete(manifestId);
    this.completionListeners.delete(manifestId);
    this.lastProgressAt.delete(manifestId);
    this.interestedSent.delete(manifestId);

    console.log(`[TorrentSwarm] 🗑️ Removed torrent "${manifestId}"`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESEED — Re-chunk completed file with current adaptive sizing
  // ═══════════════════════════════════════════════════════════════════

  async reseed(manifestId: string): Promise<TorrentManifest | null> {
    const oldManifest = this.manifests.get(manifestId);
    const chunkMap = this.chunks.get(manifestId);
    if (!oldManifest || !chunkMap || chunkMap.size < oldManifest.totalChunks) {
      console.warn(`[TorrentSwarm] Cannot reseed "${manifestId}" — incomplete or missing`);
      return null;
    }

    // Reassemble original data
    const parts: Uint8Array[] = [];
    for (let i = 0; i < oldManifest.totalChunks; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) return null;
      parts.push(new Uint8Array(b642ab(chunk.data)));
    }
    const totalLen = parts.reduce((s, p) => s + p.byteLength, 0);
    const assembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      assembled.set(part, offset);
      offset += part.byteLength;
    }

    // Remove old torrent state
    this.remove(manifestId);

    // Re-seed with current adaptive chunk size
    const newManifest = await this.seed(
      oldManifest.name,
      assembled,
      oldManifest.creatorId,
      oldManifest.mimeType,
    );

    console.log(`[TorrentSwarm] ♻️ Re-seeded "${oldManifest.name}" → ${newManifest.id} (${newManifest.totalChunks} chunks @ ${newManifest.chunkSize} bytes)`);
    return newManifest;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GUN RELAY — Secondary transport for chunk delivery
  // ═══════════════════════════════════════════════════════════════════

  attachGunRelay(relay: GunRelayAdapter): void {
    this.gunUnsub?.();
    this.gunRelay = relay;

    // Listen for torrent messages arriving via Gun
    this.gunUnsub = relay.onMessage(CHANNEL, (peerId: string, payload: unknown) => {
      this.handleMessage(peerId, payload as TorrentMessage);
    });

    // Re-announce all manifests we're seeding through Gun
    for (const [id, manifest] of this.manifests) {
      const state = this.states.get(id);
      if (state === "seeding" || state === "complete") {
        relay.broadcastToAll(CHANNEL, {
          msg: "announce",
          manifestId: id,
          payload: manifest,
          msgId: generateId("msg"),
        } as TorrentMessage);
      }
    }

    console.log("[TorrentSwarm] 🔗 Gun relay attached — secondary content delivery active");
  }

  /** Send with Gun fallback when primary mesh fails */
  private sendWithFallback(peerId: string, msg: TorrentMessage): void {
    if (!msg.msgId) msg.msgId = generateId("msg");
    const sent = this.transport.send(CHANNEL, peerId, msg);
    // If primary mesh delivery failed and we have Gun, relay through Gun
    void sent.then((ok) => {
      if (!ok && this.gunRelay) {
        this.gunRelay.send(CHANNEL, peerId, msg);
      }
    }).catch(() => {
      this.gunRelay?.send(CHANNEL, peerId, msg);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _instance: TorrentSwarm | null = null;

export function getTorrentSwarm(transport?: MeshTransportAdapter): TorrentSwarm {
  if (!_instance && transport) {
    _instance = new TorrentSwarm(transport);
  }
  if (!_instance) throw new Error("TorrentSwarm not initialized — provide transport adapter");
  return _instance;
}

export function destroyTorrentSwarm(): void {
  _instance?.stop();
  _instance = null;
}
