/**
 * ═══════════════════════════════════════════════════════════════════════
 * SWARM MESH — Standalone P2P Network Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Follows the generalized Builder Mode flow with automation:
 *   - All toggles ON by default (buildMesh, blockchainSync, autoConnect)
 *   - approveOnly OFF (ease of use over manual curation)
 *   - DEV bootstrap list for auto-connect (no manual peer sharing)
 *   - Auto-mining with configurable interval
 *   - Persistent connection list (localStorage) for mesh stability
 *   - Block / Mute / Hide controls for security
 *
 * Fully self-contained. Zero imports from other project modules.
 * Does NOT touch the stable PeerJS-based content serving layer.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Inline Crypto Utilities ────────────────────────────────────────────

function ab2b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
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

function generateId(prefix = "sm"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Inline Transport Encryption ────────────────────────────────────────

async function generateKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyB64: string;
}> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyB64: ab2b64(raw) };
}

async function deriveKey(
  privateKey: CryptoKey,
  remotePublicB64: string,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const remotePub = await crypto.subtle.importKey(
    "raw",
    b642ab(remotePublicB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: remotePub },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return ab2b64(packed.buffer as ArrayBuffer);
}

async function decrypt(key: CryptoKey, packed: string): Promise<string> {
  const data = new Uint8Array(b642ab(packed));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ── Types ──────────────────────────────────────────────────────────────

export type SwarmMeshStatus = "offline" | "connecting" | "online" | "degraded";

export type PeerModeration = "none" | "muted" | "hidden" | "blocked";

export interface SwarmPeer {
  peerId: string;
  userId: string | null;
  state: "connecting" | "connected" | "disconnected";
  quality: number;        // 0–100
  latencyMs: number;
  lastSeen: number;
  failures: number;
  successes: number;
  moderation: PeerModeration;
  encKey: CryptoKey | null;
  decKey: CryptoKey | null;
}

export interface SwarmMeshConfig {
  localPeerId: string;
  localUserId: string;
  swarmId?: string;
  iceServers?: RTCIceServer[];
  maxPeers?: number;
  miningIntervalMs?: number;
  presenceIntervalMs?: number;
  reconnectIntervalMs?: number;
  connectionPingIntervalMs?: number;
}

interface Envelope {
  type: string;
  channel: string;
  from: string;
  payload: unknown;
  timestamp: number;
  encrypted?: boolean;
}

interface BlockRecord {
  index: number;
  hash: string;
  previousHash: string;
  timestamp: number;
  transactions: TxRecord[];
  miner: string;
  nonce: number;
}

interface TxRecord {
  id: string;
  type: string;
  from: string;
  to: string;
  data: unknown;
  timestamp: number;
}

type MessageHandler = (peerId: string, payload: unknown) => void;
type PeerChangeHandler = (peers: string[]) => void;
type StatusChangeHandler = (status: SwarmMeshStatus) => void;
type MiningRewardHandler = (block: BlockRecord) => void;

export interface SwarmMeshStats {
  status: SwarmMeshStatus;
  totalPeers: number;
  connectedPeers: number;
  blockedPeers: number;
  mutedPeers: number;
  chainLength: number;
  blocksMinedLocally: number;
  uptimeMs: number;
  bytesSent: number;
  bytesReceived: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const MINING_DIFFICULTY = 4;
const KNOWN_CONNECTIONS_KEY = "swarm-mesh-known-connections";
const MODERATION_KEY = "swarm-mesh-moderation";
const TAB_CHANNEL_NAME = "swarm-mesh-tabs";

/**
 * DEV Bootstrap Node List
 * These are known stable nodes the mesh will auto-ping on startup.
 * Format: 16-char hex Node IDs (resolved to peer-{nodeId} PeerJS aliases)
 */
const DEV_BOOTSTRAP_NODES: string[] = [
  "531132bd57058f8a",
  "c99d22420d763147",
  "fc6ea1c770f8e2db",
  "685cb8ea430d21a3",
];

// ═══════════════════════════════════════════════════════════════════════
// SWARM MESH CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneSwarmMesh {
  // ── State ──────────────────────────────────────────────────────────
  private config: Required<SwarmMeshConfig>;
  private status: SwarmMeshStatus = "offline";
  private peers = new Map<string, SwarmPeer>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private localKeyPair: Awaited<ReturnType<typeof generateKeyPair>> | null = null;

  // Blockchain
  private chain: BlockRecord[] = [];
  private pendingTx: TxRecord[] = [];
  private miningInterval: number | null = null;
  private blocksMinedLocally = 0;

  // Signaling
  private broadcastChannel: BroadcastChannel | null = null;
  private tabChannel: BroadcastChannel | null = null;

  // Intervals
  private presenceInterval: number | null = null;
  private reconnectInterval: number | null = null;
  private connectionPingInterval: number | null = null;
  private startedAt: number | null = null;

  // Metrics
  private bytesSent = 0;
  private bytesReceived = 0;

  // Persistent moderation state
  private moderationMap = new Map<string, PeerModeration>();

  // Listeners
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private peerChangeHandlers = new Set<PeerChangeHandler>();
  private statusChangeHandlers = new Set<StatusChangeHandler>();
  private miningRewardHandlers = new Set<MiningRewardHandler>();

  constructor(config: SwarmMeshConfig) {
    this.config = {
      swarmId: config.swarmId ?? "swarm-main",
      iceServers: config.iceServers ?? DEFAULT_ICE,
      maxPeers: config.maxPeers ?? 24,
      miningIntervalMs: config.miningIntervalMs ?? 15_000,
      presenceIntervalMs: config.presenceIntervalMs ?? 10_000,
      reconnectIntervalMs: config.reconnectIntervalMs ?? 30_000,
      connectionPingIntervalMs: config.connectionPingIntervalMs ?? 45_000,
      ...config,
    };

    // Genesis block
    this.chain.push({
      index: 0,
      hash: "0".repeat(64),
      previousHash: "0".repeat(64),
      timestamp: Date.now(),
      transactions: [],
      miner: this.config.localPeerId,
      nonce: 0,
    });

    // Load persisted moderation
    this.loadModeration();
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.status !== "offline") return;
    this.setStatus("connecting");
    this.startedAt = Date.now();

    // Generate transport keys
    this.localKeyPair = await generateKeyPair();

    // Setup signaling (BroadcastChannel for same-origin tab discovery)
    this.setupSignaling();

    // Setup cross-tab peer sharing
    this.setupTabChannel();

    // Start presence broadcast
    this.broadcastPresence();
    this.presenceInterval = window.setInterval(
      () => this.broadcastPresence(),
      this.config.presenceIntervalMs
    );

    // Auto-reconnect loop for stale peers
    this.reconnectInterval = window.setInterval(
      () => this.autoReconnect(),
      this.config.reconnectIntervalMs
    );

    // Ping known connections to keep mesh stable
    this.connectionPingInterval = window.setInterval(
      () => this.pingKnownConnections(),
      this.config.connectionPingIntervalMs
    );

    // Auto-mine
    this.startMining();

    // Auto-connect to DEV bootstrap nodes
    this.bootstrapFromDevList();

    // Auto-connect to previously known peers
    this.restoreKnownConnections();

    this.setStatus("online");
    console.log("[SwarmMesh] ✅ Mesh started", this.config.localPeerId);
  }

  stop(): void {
    if (this.status === "offline") return;

    // Persist known connections before shutdown
    this.saveKnownConnections();

    // Clear all intervals
    for (const id of [
      this.presenceInterval,
      this.reconnectInterval,
      this.connectionPingInterval,
      this.miningInterval,
    ]) {
      if (id !== null) clearInterval(id);
    }
    this.presenceInterval = null;
    this.reconnectInterval = null;
    this.connectionPingInterval = null;
    this.miningInterval = null;

    // Close all peer connections
    for (const [peerId] of this.peerConnections) {
      this.disconnectPeer(peerId);
    }

    // Close signaling channels
    this.broadcastChannel?.close();
    this.tabChannel?.close();
    this.broadcastChannel = null;
    this.tabChannel = null;

    this.setStatus("offline");
    console.log("[SwarmMesh] ⏹️ Mesh stopped");
  }

  // ═══════════════════════════════════════════════════════════════════
  // SIGNALING (BroadcastChannel — same-origin discovery)
  // ═══════════════════════════════════════════════════════════════════

  private setupSignaling(): void {
    if (typeof BroadcastChannel === "undefined") return;
    this.broadcastChannel = new BroadcastChannel(`swarm-mesh-${this.config.swarmId}`);
    this.broadcastChannel.onmessage = (e) => {
      const msg = e.data as Envelope;
      if (msg.from === this.config.localPeerId) return;
      this.handleSignalingMessage(msg);
    };
  }

  private setupTabChannel(): void {
    if (typeof BroadcastChannel === "undefined") return;
    this.tabChannel = new BroadcastChannel(TAB_CHANNEL_NAME);
    this.tabChannel.onmessage = (e) => {
      const data = e.data as { type: string; peerId?: string };
      if (data.type === "peer-found" && data.peerId && !this.peers.has(data.peerId)) {
        if (data.peerId !== this.config.localPeerId) {
          this.connectToPeer(data.peerId);
        }
      }
    };
  }

  private sendSignaling(msg: Envelope): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(msg);
      this.bytesSent += JSON.stringify(msg).length;
    }
  }

  private handleSignalingMessage(msg: Envelope): void {
    this.bytesReceived += JSON.stringify(msg).length;
    switch (msg.type) {
      case "presence":
        this.handlePresence(msg);
        break;
      case "offer":
        this.handleOffer(msg);
        break;
      case "answer":
        this.handleAnswer(msg);
        break;
      case "ice":
        this.handleIce(msg);
        break;
      case "data":
        this.handleRelayedData(msg);
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BOOTSTRAP & CONNECTION PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════

  private bootstrapFromDevList(): void {
    for (const nodeId of DEV_BOOTSTRAP_NODES) {
      const peerId = `peer-${nodeId}`;
      if (peerId === this.config.localPeerId) continue;
      if (this.isBlocked(peerId)) continue;
      this.connectToPeer(peerId);
    }
    console.log(`[SwarmMesh] 📡 Pinging ${DEV_BOOTSTRAP_NODES.length} bootstrap nodes`);
  }

  private saveKnownConnections(): void {
    try {
      const connected = Array.from(this.peers.entries())
        .filter(([, p]) => p.state === "connected" && p.moderation !== "blocked")
        .map(([id, p]) => ({
          peerId: id,
          userId: p.userId,
          lastSeen: p.lastSeen,
          quality: p.quality,
        }));
      localStorage.setItem(KNOWN_CONNECTIONS_KEY, JSON.stringify(connected));
    } catch {}
  }

  private restoreKnownConnections(): void {
    try {
      const raw = localStorage.getItem(KNOWN_CONNECTIONS_KEY);
      if (!raw) return;
      const known = JSON.parse(raw) as { peerId: string; userId: string | null; lastSeen: number }[];
      // Only restore connections from the last 24 hours
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      let restored = 0;
      for (const entry of known) {
        if (entry.lastSeen < cutoff) continue;
        if (entry.peerId === this.config.localPeerId) continue;
        if (this.isBlocked(entry.peerId)) continue;
        if (!this.peers.has(entry.peerId)) {
          this.connectToPeer(entry.peerId);
          restored++;
        }
      }
      if (restored > 0) {
        console.log(`[SwarmMesh] 🔄 Restored ${restored} known connections`);
      }
    } catch {}
  }

  /** Periodically ping known connections to keep mesh alive */
  private pingKnownConnections(): void {
    for (const [peerId, peer] of this.peers) {
      if (peer.moderation === "blocked") continue;
      const dc = this.dataChannels.get(peerId);
      if (dc && dc.readyState === "open") {
        // Send a lightweight ping
        try {
          const ping: Envelope = {
            type: "data",
            channel: "ping",
            from: this.config.localPeerId,
            payload: { t: Date.now() },
            timestamp: Date.now(),
          };
          dc.send(JSON.stringify(ping));
          this.bytesSent += 80;
        } catch {}
      } else if (peer.state === "disconnected" && peer.failures < 10) {
        // Try to reconnect stale peers
        this.initiateWebRTC(peerId);
      }
    }
    // Save after pinging
    this.saveKnownConnections();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER MANAGEMENT (automated, with security controls)
  // ═══════════════════════════════════════════════════════════════════

  private handlePresence(msg: Envelope): void {
    const peerId = msg.from;
    if (this.isBlocked(peerId)) return;

    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId)!;
      peer.lastSeen = Date.now();
      return;
    }

    if (this.peers.size >= this.config.maxPeers) return;

    const data = msg.payload as { userId?: string };

    // Auto-connect (no approval required in Swarm Mesh)
    const peer: SwarmPeer = {
      peerId,
      userId: data.userId ?? null,
      state: "connecting",
      quality: 50,
      latencyMs: 0,
      lastSeen: Date.now(),
      failures: 0,
      successes: 0,
      moderation: this.moderationMap.get(peerId) ?? "none",
      encKey: null,
      decKey: null,
    };
    this.peers.set(peerId, peer);
    this.emitPeerChange();
    this.initiateWebRTC(peerId);
  }

  /** Connect to a specific peer by ID */
  async connectToPeer(peerId: string): Promise<void> {
    if (peerId === this.config.localPeerId) return;
    if (this.isBlocked(peerId)) return;
    if (this.peers.has(peerId)) return;

    const peer: SwarmPeer = {
      peerId,
      userId: null,
      state: "connecting",
      quality: 50,
      latencyMs: 0,
      lastSeen: Date.now(),
      failures: 0,
      successes: 0,
      moderation: this.moderationMap.get(peerId) ?? "none",
      encKey: null,
      decKey: null,
    };
    this.peers.set(peerId, peer);
    this.emitPeerChange();
    this.initiateWebRTC(peerId);
  }

  /** Disconnect a peer */
  disconnectPeer(peerId: string): void {
    const dc = this.dataChannels.get(peerId);
    if (dc) try { dc.close(); } catch {}
    const pc = this.peerConnections.get(peerId);
    if (pc) try { pc.close(); } catch {}
    this.dataChannels.delete(peerId);
    this.peerConnections.delete(peerId);
    this.peers.delete(peerId);
    this.emitPeerChange();
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODERATION (Block / Mute / Hide)
  // ═══════════════════════════════════════════════════════════════════

  /** Block a peer — immediately disconnects and prevents reconnection */
  blockPeer(peerId: string): void {
    this.setModeration(peerId, "blocked");
    this.disconnectPeer(peerId);
    console.log(`[SwarmMesh] 🚫 Blocked peer ${peerId}`);
  }

  /** Mute a peer — stays connected but content is hidden from feed */
  mutePeer(peerId: string): void {
    this.setModeration(peerId, "muted");
    console.log(`[SwarmMesh] 🔇 Muted peer ${peerId}`);
  }

  /** Hide a peer — stays connected, hidden from UI list */
  hidePeer(peerId: string): void {
    this.setModeration(peerId, "hidden");
    console.log(`[SwarmMesh] 👁️‍🗨️ Hidden peer ${peerId}`);
  }

  /** Remove moderation from a peer */
  unmoderatePeer(peerId: string): void {
    this.setModeration(peerId, "none");
    console.log(`[SwarmMesh] ✅ Unmoderated peer ${peerId}`);
  }

  /** Get moderation status of a peer */
  getPeerModeration(peerId: string): PeerModeration {
    return this.moderationMap.get(peerId) ?? "none";
  }

  /** Check if peer is blocked */
  isBlocked(peerId: string): boolean {
    return this.moderationMap.get(peerId) === "blocked";
  }

  /** Check if peer is muted (content hidden from feed) */
  isMuted(peerId: string): boolean {
    const mod = this.moderationMap.get(peerId);
    return mod === "muted" || mod === "blocked";
  }

  private setModeration(peerId: string, mod: PeerModeration): void {
    if (mod === "none") {
      this.moderationMap.delete(peerId);
    } else {
      this.moderationMap.set(peerId, mod);
    }
    const peer = this.peers.get(peerId);
    if (peer) peer.moderation = mod;
    this.saveModeration();
    this.emitPeerChange();
  }

  private saveModeration(): void {
    try {
      const entries = Array.from(this.moderationMap.entries());
      localStorage.setItem(MODERATION_KEY, JSON.stringify(entries));
    } catch {}
  }

  private loadModeration(): void {
    try {
      const raw = localStorage.getItem(MODERATION_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as [string, PeerModeration][];
      for (const [peerId, mod] of entries) {
        this.moderationMap.set(peerId, mod);
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // WEBRTC
  // ═══════════════════════════════════════════════════════════════════

  private async initiateWebRTC(peerId: string): Promise<void> {
    if (this.peerConnections.has(peerId)) return;

    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    this.peerConnections.set(peerId, pc);

    const dc = pc.createDataChannel("swarm", { ordered: true, maxRetransmits: 3 });
    this.setupDataChannel(peerId, dc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignaling({
          type: "ice",
          channel: "signaling",
          from: this.config.localPeerId,
          payload: { candidate: e.candidate.toJSON(), target: peerId },
          timestamp: Date.now(),
        });
      }
    };

    pc.onconnectionstatechange = () => this.handlePCState(peerId, pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignaling({
      type: "offer",
      channel: "signaling",
      from: this.config.localPeerId,
      payload: {
        target: peerId,
        offer,
        publicKey: this.localKeyPair?.publicKeyB64,
      },
      timestamp: Date.now(),
    });
  }

  private async handleOffer(msg: Envelope): Promise<void> {
    const data = msg.payload as {
      target: string;
      offer: RTCSessionDescriptionInit;
      publicKey?: string;
    };
    if (data.target !== this.config.localPeerId) return;

    const peerId = msg.from;
    if (this.isBlocked(peerId)) return;

    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    this.peerConnections.set(peerId, pc);

    pc.ondatachannel = (e) => this.setupDataChannel(peerId, e.channel);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignaling({
          type: "ice",
          channel: "signaling",
          from: this.config.localPeerId,
          payload: { candidate: e.candidate.toJSON(), target: peerId },
          timestamp: Date.now(),
        });
      }
    };
    pc.onconnectionstatechange = () => this.handlePCState(peerId, pc);

    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Derive transport encryption keys
    if (data.publicKey && this.localKeyPair) {
      try {
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.encKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "encrypt");
          peer.decKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "decrypt");
        }
      } catch {}
    }

    // Auto-add peer if not tracked yet
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, {
        peerId,
        userId: null,
        state: "connecting",
        quality: 50,
        latencyMs: 0,
        lastSeen: Date.now(),
        failures: 0,
        successes: 0,
        moderation: this.moderationMap.get(peerId) ?? "none",
        encKey: null,
        decKey: null,
      });
    }

    this.sendSignaling({
      type: "answer",
      channel: "signaling",
      from: this.config.localPeerId,
      payload: {
        target: peerId,
        answer,
        publicKey: this.localKeyPair?.publicKeyB64,
      },
      timestamp: Date.now(),
    });
  }

  private async handleAnswer(msg: Envelope): Promise<void> {
    const data = msg.payload as {
      target: string;
      answer: RTCSessionDescriptionInit;
      publicKey?: string;
    };
    if (data.target !== this.config.localPeerId) return;

    const pc = this.peerConnections.get(msg.from);
    if (!pc) return;
    await pc.setRemoteDescription(data.answer);

    if (data.publicKey && this.localKeyPair) {
      try {
        const peer = this.peers.get(msg.from);
        if (peer) {
          peer.encKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "encrypt");
          peer.decKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "decrypt");
        }
      } catch {}
    }
  }

  private async handleIce(msg: Envelope): Promise<void> {
    const data = msg.payload as { candidate: RTCIceCandidateInit; target: string };
    if (data.target !== this.config.localPeerId) return;
    const pc = this.peerConnections.get(msg.from);
    if (pc) {
      try { await pc.addIceCandidate(data.candidate); } catch {}
    }
  }

  private handlePCState(peerId: string, pc: RTCPeerConnection): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    switch (pc.connectionState) {
      case "connected":
        peer.state = "connected";
        peer.successes++;
        peer.quality = Math.min(100, peer.quality + 10);
        this.emitPeerChange();

        // Sync blockchain on connect
        this.sendChainSync(peerId);

        // Share our known peer list (Peer Exchange)
        this.sendPeerExchange(peerId);
        break;
      case "disconnected":
        peer.state = "disconnected";
        peer.failures++;
        this.emitPeerChange();
        break;
      case "failed":
        peer.state = "disconnected";
        peer.failures++;
        if (peer.failures > 5) {
          this.disconnectPeer(peerId);
        }
        this.emitPeerChange();
        break;
    }
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(peerId, dc);

    dc.onopen = () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.state = "connected";
        peer.lastSeen = Date.now();
      }
      this.emitPeerChange();
    };

    dc.onclose = () => {
      this.dataChannels.delete(peerId);
      const peer = this.peers.get(peerId);
      if (peer) peer.state = "disconnected";
      this.emitPeerChange();
    };

    dc.onmessage = async (e) => {
      try {
        const raw = e.data as string;
        this.bytesReceived += raw.length;

        const envelope = JSON.parse(raw) as Envelope;
        let payload = envelope.payload;

        // Decrypt if encrypted
        if (envelope.encrypted) {
          const peer = this.peers.get(peerId);
          if (peer?.decKey) {
            const dec = await decrypt(peer.decKey, payload as string);
            payload = JSON.parse(dec);
          }
        }

        // Handle peer exchange
        if (envelope.channel === "pex") {
          this.handlePeerExchange(payload);
          return;
        }

        // Handle ping (update lastSeen)
        if (envelope.channel === "ping") {
          const peer = this.peers.get(peerId);
          if (peer) peer.lastSeen = Date.now();
          return;
        }

        // Route to handlers
        this.dispatchMessage(envelope.channel, peerId, payload);

        // Blockchain handling
        if (envelope.channel === "blockchain") {
          this.handleBlockchainData(peerId, payload);
        }
      } catch (err) {
        console.warn("[SwarmMesh] Message parse error", err);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER EXCHANGE (mesh auto-growth)
  // ═══════════════════════════════════════════════════════════════════

  /** Send our known connected peers to a newly connected peer */
  private sendPeerExchange(toPeerId: string): void {
    const knownPeers = Array.from(this.peers.entries())
      .filter(([id, p]) => id !== toPeerId && p.state === "connected" && p.moderation !== "blocked")
      .map(([id]) => id)
      .slice(0, 10); // cap exchange size

    if (knownPeers.length === 0) return;

    this.send("pex", toPeerId, { peers: knownPeers });
  }

  /** Receive peer exchange and connect to unknown peers */
  private handlePeerExchange(payload: unknown): void {
    const data = payload as { peers?: string[] };
    if (!data.peers || !Array.isArray(data.peers)) return;

    for (const peerId of data.peers) {
      if (peerId === this.config.localPeerId) continue;
      if (this.isBlocked(peerId)) continue;
      if (this.peers.has(peerId)) continue;
      if (this.peers.size >= this.config.maxPeers) break;

      this.connectToPeer(peerId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGING
  // ═══════════════════════════════════════════════════════════════════

  async send(channel: string, peerId: string, payload: unknown): Promise<boolean> {
    const dc = this.dataChannels.get(peerId);
    if (!dc || dc.readyState !== "open") {
      // Relay via signaling
      this.sendSignaling({
        type: "data",
        channel,
        from: this.config.localPeerId,
        payload: { target: peerId, data: payload },
        timestamp: Date.now(),
      });
      return false;
    }

    try {
      let msgPayload: unknown = payload;
      let isEncrypted = false;
      const peer = this.peers.get(peerId);

      if (peer?.encKey) {
        msgPayload = await encrypt(peer.encKey, JSON.stringify(payload));
        isEncrypted = true;
      }

      const envelope: Envelope = {
        type: "data",
        channel,
        from: this.config.localPeerId,
        payload: msgPayload,
        timestamp: Date.now(),
        encrypted: isEncrypted,
      };

      const raw = JSON.stringify(envelope);
      dc.send(raw);
      this.bytesSent += raw.length;

      if (peer) {
        peer.successes++;
        peer.lastSeen = Date.now();
      }
      return true;
    } catch {
      const peer = this.peers.get(peerId);
      if (peer) peer.failures++;
      return false;
    }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const peerId of this.getConnectedPeerIds()) {
      this.send(channel, peerId, payload);
    }
  }

  private handleRelayedData(msg: Envelope): void {
    const data = msg.payload as { target?: string; data?: unknown };
    if (data.target && data.target !== this.config.localPeerId) return;
    this.dispatchMessage(msg.channel, msg.from, data.data ?? msg.payload);
  }

  private dispatchMessage(channel: string, peerId: string, payload: unknown): void {
    // Skip dispatching content from muted/blocked peers
    if (this.isMuted(peerId) && channel !== "blockchain" && channel !== "pex" && channel !== "ping") {
      return;
    }

    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      for (const h of handlers) {
        try { h(peerId, payload); } catch {}
      }
    }
    const wild = this.messageHandlers.get("*");
    if (wild) {
      for (const h of wild) {
        try { h(peerId, { channel, payload }); } catch {}
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCKCHAIN (auto-mine, auto-sync)
  // ═══════════════════════════════════════════════════════════════════

  addTransaction(type: string, to: string, data: unknown): string {
    const tx: TxRecord = {
      id: generateId("tx"),
      type,
      from: this.config.localPeerId,
      to,
      data,
      timestamp: Date.now(),
    };
    this.pendingTx.push(tx);
    return tx.id;
  }

  private startMining(): void {
    this.miningInterval = window.setInterval(() => {
      if (this.pendingTx.length > 0) {
        this.mineBlock();
      }
    }, this.config.miningIntervalMs);
  }

  private async mineBlock(): Promise<void> {
    const last = this.chain[this.chain.length - 1];
    const txs = this.pendingTx.splice(0, 10);
    const target = "0".repeat(MINING_DIFFICULTY);

    let nonce = 0;
    let hash = "";

    while (true) {
      const raw = `${last.index + 1}:${last.hash}:${JSON.stringify(txs)}:${nonce}`;
      hash = await sha256(raw);
      if (hash.startsWith(target)) break;
      nonce++;
      if (nonce > 1_000_000) {
        this.pendingTx.unshift(...txs);
        return;
      }
    }

    const block: BlockRecord = {
      index: last.index + 1,
      hash,
      previousHash: last.hash,
      timestamp: Date.now(),
      transactions: txs,
      miner: this.config.localPeerId,
      nonce,
    };

    this.chain.push(block);
    this.blocksMinedLocally++;

    // Broadcast to peers
    this.broadcast("blockchain", { type: "new-block", block });

    // Notify listeners
    for (const h of this.miningRewardHandlers) {
      try { h(block); } catch {}
    }

    console.log(`[SwarmMesh] ⛏️ Mined block #${block.index} (nonce=${nonce})`);
  }

  private handleBlockchainData(_peerId: string, payload: unknown): void {
    const data = payload as { type?: string; block?: BlockRecord; chain?: BlockRecord[] };
    if (data.type === "new-block" && data.block) {
      const last = this.chain[this.chain.length - 1];
      if (data.block.previousHash === last.hash) {
        this.chain.push(data.block);
      }
    } else if (data.type === "chain-sync" && data.chain) {
      if (data.chain.length > this.chain.length) {
        this.chain = data.chain;
      }
    }
  }

  private sendChainSync(peerId: string): void {
    this.send("blockchain", peerId, { type: "chain-sync", chain: this.chain });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRESENCE & AUTO-RECONNECT
  // ═══════════════════════════════════════════════════════════════════

  private broadcastPresence(): void {
    this.sendSignaling({
      type: "presence",
      channel: "presence",
      from: this.config.localPeerId,
      payload: {
        userId: this.config.localUserId,
        publicKey: this.localKeyPair?.publicKeyB64,
        peerCount: this.peers.size,
      },
      timestamp: Date.now(),
    });
  }

  private autoReconnect(): void {
    const now = Date.now();
    for (const [peerId, peer] of this.peers) {
      if (peer.moderation === "blocked") continue;
      const dc = this.dataChannels.get(peerId);
      const isStale = now - peer.lastSeen > 60_000;
      const isDisconnected = !dc || dc.readyState !== "open";

      if (isStale && isDisconnected && peer.failures < 10) {
        this.initiateWebRTC(peerId);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  onMessage(channel: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    this.messageHandlers.get(channel)!.add(handler);
    return () => { this.messageHandlers.get(channel)?.delete(handler); };
  }

  onPeerChange(handler: PeerChangeHandler): () => void {
    this.peerChangeHandlers.add(handler);
    handler(this.getConnectedPeerIds());
    return () => { this.peerChangeHandlers.delete(handler); };
  }

  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusChangeHandlers.add(handler);
    handler(this.status);
    return () => { this.statusChangeHandlers.delete(handler); };
  }

  onMiningReward(handler: MiningRewardHandler): () => void {
    this.miningRewardHandlers.add(handler);
    return () => { this.miningRewardHandlers.delete(handler); };
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, p]) => p.state === "connected")
      .map(([id]) => id);
  }

  /** Get visible peers (excludes hidden and blocked) */
  getVisiblePeers(): SwarmPeer[] {
    return Array.from(this.peers.values())
      .filter(p => p.moderation !== "hidden" && p.moderation !== "blocked");
  }

  getAllPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  getPeer(peerId: string): SwarmPeer | null {
    return this.peers.get(peerId) ?? null;
  }

  getChain(): BlockRecord[] {
    return [...this.chain];
  }

  getStats(): SwarmMeshStats {
    const connected = this.getConnectedPeerIds().length;
    const blocked = Array.from(this.moderationMap.values()).filter(m => m === "blocked").length;
    const muted = Array.from(this.moderationMap.values()).filter(m => m === "muted").length;

    return {
      status: this.status,
      totalPeers: this.peers.size,
      connectedPeers: connected,
      blockedPeers: blocked,
      mutedPeers: muted,
      chainLength: this.chain.length,
      blocksMinedLocally: this.blocksMinedLocally,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
    };
  }

  getStatus(): SwarmMeshStatus {
    return this.status;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private setStatus(s: SwarmMeshStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const h of this.statusChangeHandlers) {
      try { h(s); } catch {}
    }
  }

  private emitPeerChange(): void {
    const ids = this.getConnectedPeerIds();
    for (const h of this.peerChangeHandlers) {
      try { h(ids); } catch {}
    }

    // Cross-tab notification
    if (this.tabChannel) {
      for (const id of ids) {
        this.tabChannel.postMessage({ type: "peer-found", peerId: id });
      }
    }

    // Update status based on peer count
    if (ids.length > 0 && this.status === "connecting") this.setStatus("online");
    if (ids.length === 0 && this.status === "online") this.setStatus("degraded");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneSwarmMesh | null = null;

export function getStandaloneSwarmMesh(config?: SwarmMeshConfig): StandaloneSwarmMesh {
  if (!_instance && config) {
    _instance = new StandaloneSwarmMesh(config);
  }
  if (!_instance) throw new Error("SwarmMesh not initialized");
  return _instance;
}

export function destroyStandaloneSwarmMesh(): void {
  _instance?.stop();
  _instance = null;
}
