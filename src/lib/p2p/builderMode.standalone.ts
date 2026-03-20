/**
 * ═══════════════════════════════════════════════════════════════════════
 * BUILDER MODE — Standalone P2P Network Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Fully self-contained. Zero imports from other project modules.
 * Provides advanced, manual P2P control with four toggles:
 *   1. Build a Mesh   — enable/disable mesh construction
 *   2. Blockchain Sync — enable/disable chain synchronization
 *   3. Auto-Connect   — enable/disable automatic peer discovery
 *   4. Approve Only   — require manual approval for inbound peers
 *
 * Designed for power users who want granular control over every
 * aspect of their P2P network participation.
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

function generateId(prefix = "bm"): string {
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

export interface BuilderToggles {
  buildMesh: boolean;
  blockchainSync: boolean;
  autoConnect: boolean;
  approveOnly: boolean;
}

export type BuilderStatus = "offline" | "connecting" | "online" | "degraded";

export interface BuilderPeer {
  peerId: string;
  userId: string | null;
  state: "pending" | "approved" | "connected" | "rejected" | "disconnected";
  quality: number;
  latencyMs: number;
  lastSeen: number;
  failures: number;
  successes: number;
  encKey: CryptoKey | null;
  decKey: CryptoKey | null;
}

export interface BuilderConfig {
  localPeerId: string;
  localUserId: string;
  iceServers?: RTCIceServer[];
  initialToggles?: Partial<BuilderToggles>;
  maxPeers?: number;
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
type StatusChangeHandler = (status: BuilderStatus) => void;
type PendingPeerHandler = (pending: BuilderPeer[]) => void;
type ToggleChangeHandler = (toggles: BuilderToggles) => void;

export interface BuilderStats {
  status: BuilderStatus;
  totalPeers: number;
  connectedPeers: number;
  pendingApproval: number;
  chainLength: number;
  toggles: BuilderToggles;
  uptimeMs: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const MINING_DIFFICULTY = 4;

// ═══════════════════════════════════════════════════════════════════════
// BUILDER MODE CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneBuilderMode {
  // ── State ──────────────────────────────────────────────────────────
  private config: Required<Omit<BuilderConfig, "initialToggles">> & { initialToggles: Partial<BuilderToggles> };
  private status: BuilderStatus = "offline";
  private toggles: BuilderToggles;
  private peers = new Map<string, BuilderPeer>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private localKeyPair: Awaited<ReturnType<typeof generateKeyPair>> | null = null;

  // Blockchain
  private chain: BlockRecord[] = [];
  private pendingTx: TxRecord[] = [];

  // Signaling
  private broadcastChannel: BroadcastChannel | null = null;
  private startedAt: number | null = null;

  // Listeners
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private peerChangeHandlers = new Set<PeerChangeHandler>();
  private statusChangeHandlers = new Set<StatusChangeHandler>();
  private pendingPeerHandlers = new Set<PendingPeerHandler>();
  private toggleChangeHandlers = new Set<ToggleChangeHandler>();

  constructor(config: BuilderConfig) {
    this.config = {
      iceServers: config.iceServers ?? DEFAULT_ICE,
      maxPeers: config.maxPeers ?? 20,
      initialToggles: config.initialToggles ?? {},
      ...config,
    };

    this.toggles = {
      buildMesh: config.initialToggles?.buildMesh ?? false,
      blockchainSync: config.initialToggles?.blockchainSync ?? false,
      autoConnect: config.initialToggles?.autoConnect ?? false,
      approveOnly: config.initialToggles?.approveOnly ?? true,
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
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.status !== "offline") return;
    this.setStatus("connecting");
    this.startedAt = Date.now();

    this.localKeyPair = await generateKeyPair();
    this.setupSignaling();
    this.setStatus("online");
    console.log("[BuilderMode] ✅ Builder Mode started", this.config.localPeerId);
  }

  stop(): void {
    if (this.status === "offline") return;

    for (const [pid] of this.peerConnections) {
      this.forceDisconnect(pid);
    }

    this.broadcastChannel?.close();
    this.broadcastChannel = null;
    this.setStatus("offline");
    console.log("[BuilderMode] ⏹️ Builder Mode stopped");
  }

  // ═══════════════════════════════════════════════════════════════════
  // TOGGLES (the four manual controls)
  // ═══════════════════════════════════════════════════════════════════

  setToggle<K extends keyof BuilderToggles>(key: K, value: boolean): void {
    this.toggles[key] = value;
    this.emitToggleChange();
    console.log(`[BuilderMode] Toggle ${key} → ${value}`);

    // React to toggle changes
    if (key === "autoConnect" && value) {
      this.broadcastPresence();
    }
    if (key === "buildMesh" && !value) {
      // Disconnect all peers when mesh is disabled
      for (const [pid] of this.peerConnections) {
        this.forceDisconnect(pid);
      }
    }
  }

  getToggles(): BuilderToggles {
    return { ...this.toggles };
  }

  // ═══════════════════════════════════════════════════════════════════
  // SIGNALING
  // ═══════════════════════════════════════════════════════════════════

  private setupSignaling(): void {
    if (typeof BroadcastChannel === "undefined") return;
    this.broadcastChannel = new BroadcastChannel("builder-mode-signaling");
    this.broadcastChannel.onmessage = (e) => {
      const msg = e.data as Envelope;
      if (msg.from === this.config.localPeerId) return;
      this.handleSignalingMessage(msg);
    };
  }

  private sendSignaling(msg: Envelope): void {
    this.broadcastChannel?.postMessage(msg);
  }

  private handleSignalingMessage(msg: Envelope): void {
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
  // PEER MANAGEMENT (manual control)
  // ═══════════════════════════════════════════════════════════════════

  private handlePresence(msg: Envelope): void {
    if (!this.toggles.buildMesh) return;

    const peerId = msg.from;
    if (this.peers.has(peerId)) {
      this.peers.get(peerId)!.lastSeen = Date.now();
      return;
    }
    if (this.peers.size >= this.config.maxPeers) return;

    const data = msg.payload as { userId?: string };

    if (this.toggles.approveOnly) {
      // Add as pending — wait for manual approval
      const peer: BuilderPeer = {
        peerId,
        userId: data.userId ?? null,
        state: "pending",
        quality: 50,
        latencyMs: 0,
        lastSeen: Date.now(),
        failures: 0,
        successes: 0,
        encKey: null,
        decKey: null,
      };
      this.peers.set(peerId, peer);
      this.emitPendingPeers();
      console.log(`[BuilderMode] 🔔 Peer ${peerId} awaiting approval`);
    } else if (this.toggles.autoConnect) {
      // Auto-approve and connect
      this.manualConnect(peerId);
    }
  }

  /** Manually connect to a peer by ID */
  async manualConnect(peerId: string): Promise<void> {
    if (!this.toggles.buildMesh) {
      console.warn("[BuilderMode] Cannot connect — Build Mesh is disabled");
      return;
    }
    if (peerId === this.config.localPeerId) return;

    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = {
        peerId,
        userId: null,
        state: "approved",
        quality: 50,
        latencyMs: 0,
        lastSeen: Date.now(),
        failures: 0,
        successes: 0,
        encKey: null,
        decKey: null,
      };
      this.peers.set(peerId, peer);
    } else {
      peer.state = "approved";
    }

    this.emitPeerChange();
    this.emitPendingPeers();
    this.initiateWebRTC(peerId);
  }

  /** Approve a pending inbound peer */
  approvePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer || peer.state !== "pending") return;
    peer.state = "approved";
    this.emitPendingPeers();
    this.initiateWebRTC(peerId);
  }

  /** Reject a pending inbound peer */
  rejectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.state = "rejected";
    this.emitPendingPeers();
    // Remove after short delay
    setTimeout(() => {
      if (this.peers.get(peerId)?.state === "rejected") {
        this.peers.delete(peerId);
        this.emitPeerChange();
      }
    }, 5_000);
  }

  /** Force disconnect a peer */
  forceDisconnect(peerId: string): void {
    const dc = this.dataChannels.get(peerId);
    if (dc) try { dc.close(); } catch {}
    const pc = this.peerConnections.get(peerId);
    if (pc) try { pc.close(); } catch {}
    this.dataChannels.delete(peerId);
    this.peerConnections.delete(peerId);
    this.peers.delete(peerId);
    this.emitPeerChange();
    this.emitPendingPeers();
  }

  /** Broadcast presence (manual trigger or auto) */
  broadcastPresence(): void {
    if (!this.toggles.buildMesh) return;
    this.sendSignaling({
      type: "presence",
      channel: "presence",
      from: this.config.localPeerId,
      payload: { userId: this.config.localUserId },
      timestamp: Date.now(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // WEBRTC
  // ═══════════════════════════════════════════════════════════════════

  private async initiateWebRTC(peerId: string): Promise<void> {
    if (this.peerConnections.has(peerId)) return;

    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    this.peerConnections.set(peerId, pc);

    const dc = pc.createDataChannel("builder", { ordered: true, maxRetransmits: 3 });
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
    if (!this.toggles.buildMesh) return;

    const peerId = msg.from;

    // Check approval requirement
    const existingPeer = this.peers.get(peerId);
    if (this.toggles.approveOnly && (!existingPeer || existingPeer.state === "pending")) {
      // Don't accept — peer hasn't been approved yet
      if (!existingPeer) {
        this.peers.set(peerId, {
          peerId,
          userId: null,
          state: "pending",
          quality: 50,
          latencyMs: 0,
          lastSeen: Date.now(),
          failures: 0,
          successes: 0,
          encKey: null,
          decKey: null,
        });
        this.emitPendingPeers();
      }
      return;
    }

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

    // Derive transport keys
    if (data.publicKey && this.localKeyPair) {
      try {
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.encKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "encrypt");
          peer.decKey = await deriveKey(this.localKeyPair.privateKey, data.publicKey, "decrypt");
        }
      } catch {}
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

  private async handleAnswer(msg: Envelope): void {
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

  private async handleIce(msg: Envelope): void {
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

        // Sync blockchain if enabled
        if (this.toggles.blockchainSync) {
          this.sendChainSync(peerId);
        }
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
          this.forceDisconnect(peerId);
        }
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
        const envelope = JSON.parse(e.data) as Envelope;
        let payload = envelope.payload;

        if (envelope.encrypted) {
          const peer = this.peers.get(peerId);
          if (peer?.decKey) {
            const dec = await decrypt(peer.decKey, payload as string);
            payload = JSON.parse(dec);
          }
        }

        // Route
        this.dispatchMessage(envelope.channel, peerId, payload);

        // Blockchain handling
        if (envelope.channel === "blockchain" && this.toggles.blockchainSync) {
          this.handleBlockchainData(peerId, payload);
        }
      } catch (err) {
        console.warn("[BuilderMode] Message parse error", err);
      }
    };
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

      dc.send(JSON.stringify(envelope));
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
  // BLOCKCHAIN (manual sync via toggle)
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

  async mineBlock(): Promise<BlockRecord | null> {
    if (this.pendingTx.length === 0) return null;

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
        return null;
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

    if (this.toggles.blockchainSync) {
      this.broadcast("blockchain", { type: "new-block", block });
    }

    return block;
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

  onPendingPeers(handler: PendingPeerHandler): () => void {
    this.pendingPeerHandlers.add(handler);
    handler(this.getPendingPeers());
    return () => { this.pendingPeerHandlers.delete(handler); };
  }

  onToggleChange(handler: ToggleChangeHandler): () => void {
    this.toggleChangeHandlers.add(handler);
    handler(this.getToggles());
    return () => { this.toggleChangeHandlers.delete(handler); };
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, p]) => p.state === "connected")
      .map(([id]) => id);
  }

  getAllPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  getPendingPeers(): BuilderPeer[] {
    return Array.from(this.peers.values()).filter(p => p.state === "pending");
  }

  getPeer(peerId: string): BuilderPeer | null {
    return this.peers.get(peerId) ?? null;
  }

  getChain(): BlockRecord[] {
    return [...this.chain];
  }

  getStats(): BuilderStats {
    const connected = this.getConnectedPeerIds().length;
    const pending = this.getPendingPeers().length;

    return {
      status: this.status,
      totalPeers: this.peers.size,
      connectedPeers: connected,
      pendingApproval: pending,
      chainLength: this.chain.length,
      toggles: { ...this.toggles },
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  getStatus(): BuilderStatus {
    return this.status;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════════════

  private setStatus(s: BuilderStatus): void {
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
    if (ids.length > 0 && this.status === "connecting") this.setStatus("online");
    if (ids.length === 0 && this.status === "online") this.setStatus("degraded");
  }

  private emitPendingPeers(): void {
    const pending = this.getPendingPeers();
    for (const h of this.pendingPeerHandlers) {
      try { h(pending); } catch {}
    }
  }

  private emitToggleChange(): void {
    const t = this.getToggles();
    for (const h of this.toggleChangeHandlers) {
      try { h(t); } catch {}
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneBuilderMode | null = null;

export function getStandaloneBuilderMode(config?: BuilderConfig): StandaloneBuilderMode {
  if (!_instance && config) {
    _instance = new StandaloneBuilderMode(config);
  }
  if (!_instance) throw new Error("BuilderMode not initialized");
  return _instance;
}

export function destroyStandaloneBuilderMode(): void {
  _instance?.stop();
  _instance = null;
}
