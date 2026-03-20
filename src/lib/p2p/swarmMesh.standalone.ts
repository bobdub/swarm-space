/**
 * ═══════════════════════════════════════════════════════════════════════
 * SWARM MESH — Standalone P2P Network Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Fully self-contained. Zero imports from other project modules.
 * Handles: auto-connect, auto-mining, content routing, transport
 * encryption (ECDH + AES-256-GCM), blockchain sync, post/comment
 * synchronization, tab persistence, and peer reputation.
 *
 * This script can be dropped into any environment with WebRTC +
 * Web Crypto API support and will operate independently.
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

interface TransportKeys {
  encKey: CryptoKey;
  decKey: CryptoKey;
  publicKeyB64: string;
}

async function generateTransportKeyPair(): Promise<{
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

async function deriveTransportKey(
  privateKey: CryptoKey,
  remotePublicKeyB64: string,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const remotePub = await crypto.subtle.importKey(
    "raw",
    b642ab(remotePublicKeyB64),
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

async function transportEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Pack IV + ciphertext
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return ab2b64(packed.buffer as ArrayBuffer);
}

async function transportDecrypt(key: CryptoKey, packed: string): Promise<string> {
  const data = new Uint8Array(b642ab(packed));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ── Types ──────────────────────────────────────────────────────────────

export type SwarmMeshStatus = "offline" | "connecting" | "online" | "degraded";

export interface SwarmPeer {
  peerId: string;
  userId: string | null;
  connectedVia: "direct" | "relay" | "both";
  quality: number;         // 0–100
  reputation: number;      // 0–100 (blockchain-derived)
  latencyMs: number;
  lastSeen: number;
  failures: number;
  successes: number;
  blockchainActivity: number;
  transportKeys: TransportKeys | null;
}

export interface SwarmMeshConfig {
  localPeerId: string;
  localUserId: string;
  swarmId: string;
  iceServers?: RTCIceServer[];
  autoConnect?: boolean;
  autoMine?: boolean;
  maxPeers?: number;
  presenceIntervalMs?: number;
  reconnectIntervalMs?: number;
  tabPersistence?: boolean;
}

interface MeshMessage {
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
  directConnections: number;
  relayConnections: number;
  averageQuality: number;
  averageReputation: number;
  meshHealth: number;
  blocksMinedLocally: number;
  chainLength: number;
  uptimeMs: number;
  bytesSent: number;
  bytesReceived: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const QUALITY_WEIGHT = 0.4;
const REPUTATION_WEIGHT = 0.3;
const BLOCKCHAIN_WEIGHT = 0.3;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const TAB_STATE_KEY = "swarm-mesh-standalone-state";
const CHANNEL_NAME = "swarm-mesh-standalone-tabs";
const MINING_DIFFICULTY = 4; // leading zeros required
const MINING_INTERVAL_MS = 15_000;

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
  private localKeyPair: Awaited<ReturnType<typeof generateTransportKeyPair>> | null = null;

  // Blockchain
  private chain: BlockRecord[] = [];
  private pendingTransactions: TxRecord[] = [];
  private miningInterval: number | null = null;
  private blocksMinedLocally = 0;

  // Signaling (BroadcastChannel for local, extensible for WS)
  private broadcastChannel: BroadcastChannel | null = null;
  private tabChannel: BroadcastChannel | null = null;

  // Intervals
  private presenceInterval: number | null = null;
  private reconnectInterval: number | null = null;
  private tabPersistInterval: number | null = null;
  private startedAt: number | null = null;

  // Metrics
  private bytesSent = 0;
  private bytesReceived = 0;

  // Listeners
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private peerChangeHandlers = new Set<PeerChangeHandler>();
  private statusChangeHandlers = new Set<StatusChangeHandler>();
  private miningRewardHandlers = new Set<MiningRewardHandler>();

  constructor(config: SwarmMeshConfig) {
    this.config = {
      iceServers: config.iceServers ?? DEFAULT_ICE,
      autoConnect: config.autoConnect ?? true,
      autoMine: config.autoMine ?? true,
      maxPeers: config.maxPeers ?? 12,
      presenceIntervalMs: config.presenceIntervalMs ?? 10_000,
      reconnectIntervalMs: config.reconnectIntervalMs ?? 30_000,
      tabPersistence: config.tabPersistence ?? true,
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
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.status !== "offline") return;
    this.setStatus("connecting");
    this.startedAt = Date.now();

    // Generate transport keys
    this.localKeyPair = await generateTransportKeyPair();

    // Setup signaling
    this.setupSignaling();

    // Restore tab state
    if (this.config.tabPersistence) {
      this.restoreTabState();
      this.startTabPersistence();
    }

    // Start presence broadcast
    this.broadcastPresence();
    this.presenceInterval = window.setInterval(
      () => this.broadcastPresence(),
      this.config.presenceIntervalMs
    );

    // Auto-reconnect loop
    if (this.config.autoConnect) {
      this.reconnectInterval = window.setInterval(
        () => this.autoReconnect(),
        this.config.reconnectIntervalMs
      );
    }

    // Auto-mine
    if (this.config.autoMine) {
      this.startMining();
    }

    this.setStatus("online");
    console.log("[SwarmMesh] ✅ Mesh started", this.config.localPeerId);
  }

  stop(): void {
    if (this.status === "offline") return;

    // Save state before shutdown
    if (this.config.tabPersistence) this.saveTabState();

    // Clear all intervals
    for (const id of [
      this.presenceInterval,
      this.reconnectInterval,
      this.tabPersistInterval,
      this.miningInterval,
    ]) {
      if (id !== null) clearInterval(id);
    }
    this.presenceInterval = null;
    this.reconnectInterval = null;
    this.tabPersistInterval = null;
    this.miningInterval = null;

    // Close connections
    for (const [peerId] of this.peerConnections) {
      this.disconnectPeer(peerId);
    }

    // Close channels
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
      const msg = e.data as MeshMessage;
      if (msg.from === this.config.localPeerId) return;
      this.handleSignalingMessage(msg);
    };
  }

  private sendSignaling(msg: MeshMessage): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(msg);
      this.bytesSent += JSON.stringify(msg).length;
    }
  }

  private handleSignalingMessage(msg: MeshMessage): void {
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
        this.handleData(msg);
        break;
      case "blockchain-sync":
        this.handleBlockchainSync(msg);
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  private handlePresence(msg: MeshMessage): void {
    const data = msg.payload as { publicKey?: string; userId?: string };
    const peerId = msg.from;

    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId)!;
      peer.lastSeen = Date.now();
      return;
    }

    if (this.peers.size >= this.config.maxPeers) return;

    // New peer discovered — add and initiate connection
    const peer: SwarmPeer = {
      peerId,
      userId: (data.userId as string) ?? null,
      connectedVia: "relay",
      quality: 50,
      reputation: 0,
      latencyMs: 0,
      lastSeen: Date.now(),
      failures: 0,
      successes: 0,
      blockchainActivity: 0,
      transportKeys: null,
    };
    this.peers.set(peerId, peer);
    this.emitPeerChange();

    // Auto-connect via WebRTC
    if (this.config.autoConnect) {
      this.initiateWebRTC(peerId);
    }
  }

  async connectToPeer(peerId: string): Promise<void> {
    if (peerId === this.config.localPeerId || this.peers.has(peerId)) return;

    const peer: SwarmPeer = {
      peerId,
      userId: null,
      connectedVia: "relay",
      quality: 50,
      reputation: 0,
      latencyMs: 0,
      lastSeen: Date.now(),
      failures: 0,
      successes: 0,
      blockchainActivity: 0,
      transportKeys: null,
    };
    this.peers.set(peerId, peer);
    this.emitPeerChange();
    this.initiateWebRTC(peerId);
  }

  disconnectPeer(peerId: string): void {
    const dc = this.dataChannels.get(peerId);
    if (dc) { try { dc.close(); } catch {} }
    const pc = this.peerConnections.get(peerId);
    if (pc) { try { pc.close(); } catch {} }
    this.dataChannels.delete(peerId);
    this.peerConnections.delete(peerId);
    this.peers.delete(peerId);
    this.emitPeerChange();
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
        offer: offer,
        publicKey: this.localKeyPair?.publicKeyB64,
      },
      timestamp: Date.now(),
    });
  }

  private async handleOffer(msg: MeshMessage): void {
    const data = msg.payload as {
      target: string;
      offer: RTCSessionDescriptionInit;
      publicKey?: string;
    };
    if (data.target !== this.config.localPeerId) return;

    const peerId = msg.from;
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

    // Derive transport encryption key if public key provided
    if (data.publicKey && this.localKeyPair) {
      try {
        const encKey = await deriveTransportKey(this.localKeyPair.privateKey, data.publicKey, "encrypt");
        const decKey = await deriveTransportKey(this.localKeyPair.privateKey, data.publicKey, "decrypt");
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.transportKeys = { encKey, decKey, publicKeyB64: data.publicKey };
        }
      } catch (err) {
        console.warn("[SwarmMesh] Transport key derivation failed", err);
      }
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

  private async handleAnswer(msg: MeshMessage): void {
    const data = msg.payload as {
      target: string;
      answer: RTCSessionDescriptionInit;
      publicKey?: string;
    };
    if (data.target !== this.config.localPeerId) return;

    const pc = this.peerConnections.get(msg.from);
    if (!pc) return;

    await pc.setRemoteDescription(data.answer);

    // Derive transport key
    if (data.publicKey && this.localKeyPair) {
      try {
        const encKey = await deriveTransportKey(this.localKeyPair.privateKey, data.publicKey, "encrypt");
        const decKey = await deriveTransportKey(this.localKeyPair.privateKey, data.publicKey, "decrypt");
        const peer = this.peers.get(msg.from);
        if (peer) {
          peer.transportKeys = { encKey, decKey, publicKeyB64: data.publicKey };
        }
      } catch (err) {
        console.warn("[SwarmMesh] Transport key derivation failed", err);
      }
    }
  }

  private async handleIce(msg: MeshMessage): void {
    const data = msg.payload as { candidate: RTCIceCandidateInit; target: string };
    if (data.target !== this.config.localPeerId) return;

    const pc = this.peerConnections.get(msg.from);
    if (pc) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        console.warn("[SwarmMesh] ICE candidate error", err);
      }
    }
  }

  private handlePCState(peerId: string, pc: RTCPeerConnection): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    switch (pc.connectionState) {
      case "connected":
        peer.connectedVia = "direct";
        peer.successes++;
        peer.quality = Math.min(100, peer.quality + 10);
        this.emitPeerChange();
        break;
      case "disconnected":
      case "failed":
        peer.failures++;
        peer.quality = Math.max(0, peer.quality - 15);
        if (peer.failures > 5) {
          this.disconnectPeer(peerId);
        }
        break;
    }
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(peerId, dc);

    dc.onopen = () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.connectedVia = "direct";
        peer.lastSeen = Date.now();
      }
      this.emitPeerChange();

      // Sync blockchain on connect
      this.sendBlockchainSync(peerId);
    };

    dc.onclose = () => {
      this.dataChannels.delete(peerId);
      const peer = this.peers.get(peerId);
      if (peer) peer.connectedVia = "relay";
      this.emitPeerChange();
    };

    dc.onmessage = async (e) => {
      try {
        const raw = e.data as string;
        this.bytesReceived += raw.length;

        const envelope = JSON.parse(raw) as MeshMessage;
        let payload = envelope.payload;

        // Decrypt if encrypted
        if (envelope.encrypted) {
          const peer = this.peers.get(peerId);
          if (peer?.transportKeys?.decKey) {
            const decrypted = await transportDecrypt(peer.transportKeys.decKey, payload as string);
            payload = JSON.parse(decrypted);
          }
        }

        // Route to handlers
        this.dispatchMessage(envelope.channel, peerId, payload);

        // Handle blockchain messages
        if (envelope.channel === "blockchain") {
          this.handleBlockchainData(peerId, payload);
        }
      } catch (err) {
        console.warn("[SwarmMesh] Message parse error", err);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGING
  // ═══════════════════════════════════════════════════════════════════

  async send(channel: string, peerId: string, payload: unknown): Promise<boolean> {
    const dc = this.dataChannels.get(peerId);
    if (!dc || dc.readyState !== "open") {
      // Fallback to signaling relay
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
      let encrypted = false;

      // Encrypt if transport keys available
      const peer = this.peers.get(peerId);
      if (peer?.transportKeys?.encKey) {
        msgPayload = await transportEncrypt(
          peer.transportKeys.encKey,
          JSON.stringify(payload)
        );
        encrypted = true;
      }

      const envelope: MeshMessage = {
        type: "data",
        channel,
        from: this.config.localPeerId,
        payload: msgPayload,
        timestamp: Date.now(),
        encrypted,
      };

      const raw = JSON.stringify(envelope);
      dc.send(raw);
      this.bytesSent += raw.length;
      this.recordSuccess(peerId);
      return true;
    } catch (err) {
      console.warn("[SwarmMesh] Send failed", err);
      this.recordFailure(peerId);
      return false;
    }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const peerId of this.peers.keys()) {
      this.send(channel, peerId, payload);
    }
  }

  private handleData(msg: MeshMessage): void {
    const data = msg.payload as { target?: string; data?: unknown };
    if (data.target && data.target !== this.config.localPeerId) return;
    this.dispatchMessage(msg.channel, msg.from, data.data ?? msg.payload);
  }

  private dispatchMessage(channel: string, peerId: string, payload: unknown): void {
    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      for (const h of handlers) {
        try { h(peerId, payload); } catch (err) {
          console.warn("[SwarmMesh] Handler error", err);
        }
      }
    }
    // Wildcard handlers
    const wildcardHandlers = this.messageHandlers.get("*");
    if (wildcardHandlers) {
      for (const h of wildcardHandlers) {
        try { h(peerId, { channel, payload }); } catch {}
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCKCHAIN (inline, self-contained)
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
    this.pendingTransactions.push(tx);
    return tx.id;
  }

  private startMining(): void {
    this.miningInterval = window.setInterval(() => {
      if (this.pendingTransactions.length > 0) {
        this.mineBlock();
      }
    }, MINING_INTERVAL_MS);
  }

  private async mineBlock(): Promise<void> {
    const lastBlock = this.chain[this.chain.length - 1];
    const transactions = this.pendingTransactions.splice(0, 10); // max 10 per block
    const target = "0".repeat(MINING_DIFFICULTY);

    let nonce = 0;
    let hash = "";

    while (true) {
      const raw = `${lastBlock.index + 1}:${lastBlock.hash}:${JSON.stringify(transactions)}:${nonce}`;
      hash = await sha256(raw);
      if (hash.startsWith(target)) break;
      nonce++;
      if (nonce > 1_000_000) {
        // Safety bail
        console.warn("[SwarmMesh] Mining bail — too many iterations");
        this.pendingTransactions.unshift(...transactions);
        return;
      }
    }

    const block: BlockRecord = {
      index: lastBlock.index + 1,
      hash,
      previousHash: lastBlock.hash,
      timestamp: Date.now(),
      transactions,
      miner: this.config.localPeerId,
      nonce,
    };

    this.chain.push(block);
    this.blocksMinedLocally++;

    // Update reputation for self
    this.updateReputation(this.config.localPeerId);

    // Broadcast to peers
    this.broadcast("blockchain", { type: "new-block", block });

    // Notify listeners
    for (const h of this.miningRewardHandlers) {
      try { h(block); } catch {}
    }

    console.log(`[SwarmMesh] ⛏️ Mined block #${block.index} (nonce=${nonce})`);
  }

  private handleBlockchainData(peerId: string, payload: unknown): void {
    const data = payload as { type?: string; block?: BlockRecord; chain?: BlockRecord[] };
    if (!data.type) return;

    if (data.type === "new-block" && data.block) {
      this.receiveBlock(data.block, peerId);
    } else if (data.type === "chain-sync" && data.chain) {
      this.receiveChain(data.chain, peerId);
    }
  }

  private receiveBlock(block: BlockRecord, fromPeer: string): void {
    const lastBlock = this.chain[this.chain.length - 1];
    if (block.previousHash !== lastBlock.hash || block.index !== lastBlock.index + 1) {
      // Chain divergence — request full sync
      this.sendBlockchainSync(fromPeer);
      return;
    }
    this.chain.push(block);
    this.updateReputation(fromPeer);
  }

  private receiveChain(incoming: BlockRecord[], fromPeer: string): void {
    if (incoming.length > this.chain.length) {
      // Simple longest-chain rule
      this.chain = incoming;
      this.updateReputation(fromPeer);
    }
  }

  private sendBlockchainSync(peerId: string): void {
    this.send("blockchain", peerId, { type: "chain-sync", chain: this.chain });
  }

  private handleBlockchainSync(msg: MeshMessage): void {
    const data = msg.payload as { type?: string; chain?: BlockRecord[] };
    if (data.type === "chain-sync" && data.chain) {
      this.receiveChain(data.chain, msg.from);
    }
  }

  private updateReputation(peerId: string): void {
    const mined = this.chain.filter(b => b.miner === peerId).length;
    let txCount = 0;
    for (const b of this.chain) {
      txCount += b.transactions.filter(t => t.from === peerId || t.to === peerId).length;
    }
    const rep = Math.min(100, mined * 10 + txCount * 2);

    const peer = this.peers.get(peerId);
    if (peer) {
      peer.reputation = rep;
      peer.blockchainActivity = mined + txCount;
    }
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
      const dc = this.dataChannels.get(peerId);
      const isStale = now - peer.lastSeen > 60_000;
      const isDisconnected = !dc || dc.readyState !== "open";

      if (isStale && isDisconnected && peer.failures < 10) {
        const timeout = this.dynamicTimeout(peer);
        if (now - peer.lastSeen > timeout) {
          this.initiateWebRTC(peerId);
        }
      }
    }
  }

  private dynamicTimeout(peer: SwarmPeer): number {
    const q = peer.quality / 100;
    const r = Math.min(peer.reputation / 100, 1);
    const l = Math.max(0, 1 - peer.latencyMs / 1000);
    const score = q * QUALITY_WEIGHT + r * REPUTATION_WEIGHT + l * BLOCKCHAIN_WEIGHT;
    return MAX_TIMEOUT_MS - score * (MAX_TIMEOUT_MS - MIN_TIMEOUT_MS);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════

  private startTabPersistence(): void {
    this.tabPersistInterval = window.setInterval(() => this.saveTabState(), 5_000);
    window.addEventListener("beforeunload", () => this.saveTabState());

    if (typeof BroadcastChannel !== "undefined") {
      this.tabChannel = new BroadcastChannel(CHANNEL_NAME);
      this.tabChannel.onmessage = (e) => {
        const data = e.data as { type: string; peerId?: string };
        if (data.type === "peer-found" && data.peerId && !this.peers.has(data.peerId)) {
          this.connectToPeer(data.peerId);
        }
      };
    }
  }

  private saveTabState(): void {
    try {
      localStorage.setItem(
        TAB_STATE_KEY,
        JSON.stringify({
          peerId: this.config.localPeerId,
          peers: Array.from(this.peers.keys()),
          chainLength: this.chain.length,
          timestamp: Date.now(),
        })
      );
    } catch {}
  }

  private restoreTabState(): void {
    try {
      const raw = localStorage.getItem(TAB_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as {
        peers: string[];
        timestamp: number;
      };
      if (Date.now() - state.timestamp > 5 * 60 * 1000) return;
      for (const pid of state.peers) {
        if (pid !== this.config.localPeerId) {
          this.connectToPeer(pid);
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUALITY TRACKING
  // ═══════════════════════════════════════════════════════════════════

  private recordSuccess(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.successes++;
    peer.failures = Math.max(0, peer.failures - 1);
    const rate = peer.successes / (peer.successes + peer.failures);
    peer.quality = Math.round(peer.quality * 0.7 + rate * 100 * 0.3);
    peer.lastSeen = Date.now();
  }

  private recordFailure(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.failures++;
    const rate = peer.successes / (peer.successes + peer.failures);
    peer.quality = Math.round(peer.quality * 0.7 + rate * 100 * 0.3);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  onMessage(channel: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    this.messageHandlers.get(channel)!.add(handler);
    return () => {
      this.messageHandlers.get(channel)?.delete(handler);
    };
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
    return Array.from(this.peers.keys());
  }

  getPeer(peerId: string): SwarmPeer | null {
    return this.peers.get(peerId) ?? null;
  }

  getChain(): BlockRecord[] {
    return [...this.chain];
  }

  getStats(): SwarmMeshStats {
    const peers = Array.from(this.peers.values());
    const direct = peers.filter(p => p.connectedVia === "direct" || p.connectedVia === "both");
    const relay = peers.filter(p => p.connectedVia === "relay");
    const avgQ = peers.length ? peers.reduce((s, p) => s + p.quality, 0) / peers.length : 0;
    const avgR = peers.length ? peers.reduce((s, p) => s + p.reputation, 0) / peers.length : 0;

    return {
      status: this.status,
      totalPeers: peers.length,
      directConnections: direct.length,
      relayConnections: relay.length,
      averageQuality: Math.round(avgQ),
      averageReputation: Math.round(avgR),
      meshHealth: this.calculateHealth(),
      blocksMinedLocally: this.blocksMinedLocally,
      chainLength: this.chain.length,
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

  private calculateHealth(): number {
    if (this.peers.size === 0) return 0;
    const peers = Array.from(this.peers.values());
    const avgQ = peers.reduce((s, p) => s + p.quality, 0) / peers.length;
    const directRatio = peers.filter(p => p.connectedVia !== "relay").length / peers.length;
    const avgR = peers.reduce((s, p) => s + p.reputation, 0) / peers.length;
    return Math.round(avgQ * 0.4 + directRatio * 100 * 0.3 + avgR * 0.3);
  }

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
    if (ids.length > 0 && this.status === "connecting") {
      this.setStatus("online");
    } else if (ids.length === 0 && this.status === "online") {
      this.setStatus("degraded");
    }
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
