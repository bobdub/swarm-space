/**
 * ═══════════════════════════════════════════════════════════════════════
 * SWARM MESH — Production P2P Connection & Content Serving Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Cloned from builderMode.standalone.ts — the proven working foundation.
 * Fully self-contained. Zero imports from other project modules.
 *
 * Key differences from Builder Mode:
 *   - AUTO-CONNECTS via Cascade: Dev Bootstrap → Library → Manual fallback
 *   - DEV_BOOTSTRAP_PEERS: expandable list of primary seed nodes
 *   - 24-hour retry: if dev node is unreachable, silently retries every 24h
 *   - Mining enabled by default (automatic upon connection)
 *   - Library exchange: connected peers share their contact lists for mesh growth
 *
 * Design principles (inherited from TestMode cornerstone):
 *   - No abort controllers — clean lifecycle
 *   - No shared state with other modules
 *   - PeerJS instance is never re-created while one is still alive
 *   - Identity is sacred: same Peer ID across all sessions
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Inline Utilities ───────────────────────────────────────────────────

function hexId(bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function now(): number {
  return Date.now();
}

// ── Storage Keys ───────────────────────────────────────────────────────

const KEYS = {
  NODE_ID: 'swarm-mesh-node-id',
  FLAGS: 'swarm-mesh-flags',
  TOGGLES: 'swarm-mesh-toggles',
  CONNECTION_LIBRARY: 'swarm-mesh-connection-library',
  BLOCKED_PEERS: 'swarm-mesh-blocked-peers',
  MINING_STATS: 'swarm-mesh-mining-stats',
  DEV_RETRY_AT: 'swarm-mesh-dev-retry-at',
} as const;

// ── Dev Bootstrap Peers ────────────────────────────────────────────────
// Primary seed nodes. Once connected, the user gets their PeerID and it
// goes here. This list is expandable — new devs just add their nodeId.
// The mesh grows organically via library exchange after first contact.

const DEV_BOOTSTRAP_PEERS: string[] = [
  'peer-aabdc05f37ceb551',
  'peer-01e3f23e20fe0102',
];

// 1 hour in ms — silent retry interval for dev bootstrap nodes
// Each peer is tried once per cycle, no reconnect retries or fallback
const DEV_RETRY_INTERVAL = 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────

export type SwarmPhase =
  | 'off'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'failed';

export interface SwarmFlags {
  enabled: boolean;
  lastOnlineAt: number | null;
}

export interface SwarmToggles {
  autoConnect: boolean;
  mining: boolean;
  libraryExchange: boolean;
}

export interface SwarmPeer {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  messagesReceived: number;
  messagesSent: number;
  avgRttMs: number | null;
  lastRttMs: number | null;
  source: 'bootstrap' | 'library' | 'manual' | 'exchange';
  /** Timestamp of last mining broadcast received from this peer */
  lastMinedBlock: number | null;
  /** RTT measured from mining-ack round-trip */
  miningRtt: number | null;
}

export interface LibraryPeer {
  peerId: string;
  nodeId: string;
  alias: string;
  addedAt: number;
  lastSeenAt: number;
  autoConnect: boolean;
  source: 'bootstrap' | 'library' | 'manual' | 'exchange';
  displayName?: string;
  username?: string;
  avatarRef?: string;
}

export interface ContentItem {
  id: string;
  type: 'post' | 'chunk' | 'comment';
  data: unknown;
  author: string;
  timestamp: number;
  hash: string;
}

export interface MiningStats {
  /** Blocks produced by this node */
  blocksMinedTotal: number;
  /** Blocks received & relayed from other peers */
  blocksRelayed: number;
  /** Peer discovery events facilitated (PEX exchanges) */
  peersDiscovered: number;
  /** Heartbeats sent to keep mesh alive */
  heartbeatsSent: number;
  /** Heartbeat acks received back */
  heartbeatsReceived: number;
  /** Data chunks served to peers (content sync) */
  chunksServed: number;
  /** Mining-acks received (connection quality probes answered) */
  acksReceived: number;
  /** Timestamp of last block mined (ms) */
  lastBlockMinedAt: number | null;
  /** Timestamp of last heartbeat sent (ms) */
  lastHeartbeatAt: number | null;

  // ── Legacy (kept for backward compat with stored data) ──
  /** @deprecated use blocksRelayed */
  transactionsProcessed: number;
  /** @deprecated use chunksServed */
  spaceHosted: number;
}

export interface SwarmMeshStandaloneStats {
  phase: SwarmPhase;
  peerId: string | null;
  nodeId: string;
  connectedPeers: number;
  contentItems: number;
  uptimeMs: number;
  reconnectAttempt: number;
  flags: SwarmFlags;
  toggles: SwarmToggles;
  miningStats: MiningStats;
  bootstrapOnline: number;
  libraryOnline: number;
  assetSync: AssetSyncStats;
}

export interface AssetSyncStats {
  manifestsPulled: number;
  chunksPulled: number;
  chunksServed: number;
  pendingManifests: number;
  activeRetries: number;
}

type ConnectionSource = 'bootstrap' | 'library' | 'manual' | 'exchange';

interface SwarmSignalingEndpoint {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  path: string;
}

type PhaseHandler = (phase: SwarmPhase) => void;
type PeerHandler = (peers: SwarmPeer[]) => void;
type ContentHandler = (item: ContentItem) => void;
type ContentChangeHandler = (items: ContentItem[]) => void;
type AlertHandler = (message: string, level: 'info' | 'warn' | 'error') => void;
type LibraryHandler = (peers: LibraryPeer[]) => void;
type ToggleHandler = (toggles: SwarmToggles) => void;
type MiningHandler = (stats: MiningStats) => void;

interface PendingAssetRequest {
  resolve: (message: Record<string, unknown> | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  expectedType: 'manifest-response' | 'chunk-response';
}

interface StoredManifestLike {
  fileId?: string;
  chunks?: string[];
  fileKey?: string;
  [key: string]: unknown;
}

interface StoredChunkLike {
  ref?: string;
  [key: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────

const RECONNECT_INTERVALS = [15_000, 30_000, 60_000] as const;
const PEERJS_INIT_TIMEOUT = 12_000;
const CONTENT_SYNC_INTERVAL = 10_000;
const HEARTBEAT_INTERVAL = 8_000;
const PEER_STALE_THRESHOLD = 30_000;
const PEER_STALE_THRESHOLD_MINING = 60_000; // Extended for actively mining peers
const MINING_COLD_THRESHOLD = 45_000; // 3 × MINING_INTERVAL — no blocks = "cold"
const LIBRARY_RECONNECT_INTERVAL = 30_000;
const MINING_INTERVAL = 15_000;
const CASCADE_SETTLE_TIME = 12_000;
const SIGNALING_ENDPOINT_STORAGE_KEY = 'p2p-signaling-endpoint-id';
const ASSET_REQUEST_TIMEOUT_MS = 10_000;
const ASSET_RETRY_INTERVAL_MS = 2_500;
const ASSET_RETRY_MAX_ATTEMPTS = 24;

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DEFAULT_SIGNALING_ENDPOINTS: SwarmSignalingEndpoint[] = [
  {
    id: 'peerjs-cloud',
    label: 'PeerJS Cloud',
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    path: '/',
  },
];

const DEFAULT_TOGGLES: SwarmToggles = {
  autoConnect: true,
  mining: true,
  libraryExchange: true,
};

// ═══════════════════════════════════════════════════════════════════════
// STANDALONE SWARM MESH CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneSwarmMesh {
  // ── Identity (sacred, never changes) ──────────────────────────────
  private readonly nodeId: string;
  private readonly peerId: string;

  // ── PeerJS ────────────────────────────────────────────────────────
  private peer: import('peerjs').default | null = null;
  private connections = new Map<string, import('peerjs').DataConnection>();
  private peerData = new Map<string, SwarmPeer>();

  // ── State Machine ─────────────────────────────────────────────────
  private phase: SwarmPhase = 'off';
  private flags: SwarmFlags;
  private toggles: SwarmToggles;
  private startedAt: number | null = null;

  // ── Reconnect ─────────────────────────────────────────────────────
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Content Store ─────────────────────────────────────────────────
  private contentStore = new Map<string, ContentItem>();
  private pendingAssetRequests = new Map<string, PendingAssetRequest>();
  private assetRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private assetRetryAttempts = new Map<string, number>();
  private _assetSyncCounters = { manifestsPulled: 0, chunksPulled: 0, chunksServed: 0 };

  // ── Connection Library (persisted) ────────────────────────────────
  private library = new Map<string, LibraryPeer>();
  private blockedPeers = new Set<string>();

  // ── Mining ────────────────────────────────────────────────────────
  private miningStats: MiningStats;
  private miningTimer: ReturnType<typeof setInterval> | null = null;

  // ── Dev bootstrap retry ───────────────────────────────────────────
  private devRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Peer-unavailable tracking for cascade retry ──────────────────
  private unavailablePeers = new Set<string>();

  // ── Intervals ─────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null;
  private libraryReconnectTimer: ReturnType<typeof setInterval> | null = null;

  // ── Event Handlers ────────────────────────────────────────────────
  private phaseHandlers = new Set<PhaseHandler>();
  private peerHandlers = new Set<PeerHandler>();
  private contentHandlers = new Set<ContentHandler>();
  private contentChangeHandlers = new Set<ContentChangeHandler>();
  private alertHandlers = new Set<AlertHandler>();
  private libraryHandlers = new Set<LibraryHandler>();
  private toggleHandlers = new Set<ToggleHandler>();
  private miningHandlers = new Set<MiningHandler>();

  // ── Guard ─────────────────────────────────────────────────────────
  private initInProgress = false;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    this.nodeId = this.loadOrCreateNodeId();
    this.peerId = `peer-${this.nodeId}`;
    this.flags = this.loadFlags();
    this.toggles = this.loadToggles();
    this.miningStats = this.loadMiningStats();
    this.loadLibrary();
    this.loadBlockedPeers();
    this.setupVisibilityHandler();

    // Seed dev bootstrap peers into library
    for (const bp of DEV_BOOTSTRAP_PEERS) {
      if (bp === this.peerId) continue;
      if (!this.library.has(bp) && !this.blockedPeers.has(bp)) {
        this.library.set(bp, {
          peerId: bp,
          nodeId: bp.replace(/^peer-/, ''),
          alias: `Dev ${bp.slice(5, 11)}`,
          addedAt: now(),
          lastSeenAt: 0,
          autoConnect: true,
          source: 'bootstrap',
        });
      }
    }
    this.saveLibrary();

    console.log(
      `[SwarmMesh] Identity: nodeId=${this.nodeId} peerId=${this.peerId}, toggles=${JSON.stringify(this.toggles)}, library=${this.library.size}, blocked=${this.blockedPeers.size}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VISIBILITY — Reconnect when tab regains focus
  // ═══════════════════════════════════════════════════════════════════

  private setupVisibilityHandler(): void {
    if (typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.flags.enabled) return;
      if (this.phase === 'online' || this.phase === 'connecting' || this.phase === 'reconnecting') return;
      console.log('[SwarmMesh] 👁️ Tab visible — auto-reconnecting');
      void this.start();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private teardownVisibilityHandler(): void {
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // IDENTITY — shared with TestMode, never rotates
  // ═══════════════════════════════════════════════════════════════════

  private loadOrCreateNodeId(): string {
    try {
      const testModeId = localStorage.getItem('test-mode-node-id');
      if (testModeId && testModeId.length >= 8) {
        localStorage.setItem(KEYS.NODE_ID, testModeId);
        return testModeId;
      }
    } catch { /* ignore */ }

    try {
      const stored = localStorage.getItem(KEYS.NODE_ID);
      if (stored && stored.length >= 8) return stored;
    } catch { /* ignore */ }

    const id = hexId(8);
    try { localStorage.setItem(KEYS.NODE_ID, id); } catch { /* ignore */ }
    console.log('[SwarmMesh] Generated new node ID:', id);
    return id;
  }

  getNodeId(): string { return this.nodeId; }
  getPeerId(): string { return this.peerId; }

  // ═══════════════════════════════════════════════════════════════════
  // FLAGS
  // ═══════════════════════════════════════════════════════════════════

  private loadFlags(): SwarmFlags {
    try {
      const raw = localStorage.getItem(KEYS.FLAGS);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          enabled: typeof p.enabled === 'boolean' ? p.enabled : false,
          lastOnlineAt: typeof p.lastOnlineAt === 'number' ? p.lastOnlineAt : null,
        };
      }
    } catch { /* ignore */ }
    return { enabled: false, lastOnlineAt: null };
  }

  private saveFlags(): void {
    try { localStorage.setItem(KEYS.FLAGS, JSON.stringify(this.flags)); } catch { /* ignore */ }
  }

  getFlags(): SwarmFlags { return { ...this.flags }; }

  // ═══════════════════════════════════════════════════════════════════
  // TOGGLES — Persisted user controls
  // ═══════════════════════════════════════════════════════════════════

  private loadToggles(): SwarmToggles {
    try {
      const raw = localStorage.getItem(KEYS.TOGGLES);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          autoConnect: typeof p.autoConnect === 'boolean' ? p.autoConnect : DEFAULT_TOGGLES.autoConnect,
          mining: typeof p.mining === 'boolean' ? p.mining : DEFAULT_TOGGLES.mining,
          libraryExchange: typeof p.libraryExchange === 'boolean' ? p.libraryExchange : DEFAULT_TOGGLES.libraryExchange,
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_TOGGLES };
  }

  private saveToggles(): void {
    try { localStorage.setItem(KEYS.TOGGLES, JSON.stringify(this.toggles)); } catch { /* ignore */ }
    this.emitToggles();
  }

  getToggles(): SwarmToggles { return { ...this.toggles }; }

  setToggle<K extends keyof SwarmToggles>(key: K, value: boolean): void {
    this.toggles[key] = value;
    this.saveToggles();
    console.log(`[SwarmMesh] Toggle ${key} → ${value}`);

    if (key === 'mining') {
      if (value && this.phase === 'online') {
        console.log('[SwarmMesh][Mining] ⛏️ TOGGLE ON — user enabled mining, phase is online → starting loop');
        this.startMiningLoop();
      } else if (value && this.phase !== 'online') {
        console.log(`[SwarmMesh][Mining] ⛏️ TOGGLE ON — but phase is "${this.phase}", mining deferred until online`);
      } else {
        console.log('[SwarmMesh][Mining] ⛏️ TOGGLE OFF — user disabled mining → stopping loop');
        this.stopMiningLoop();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MINING — Automatic by default, persisted stats
  // ═══════════════════════════════════════════════════════════════════

  private loadMiningStats(): MiningStats {
    try {
      const raw = localStorage.getItem(KEYS.MINING_STATS);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          blocksMinedTotal: typeof p.blocksMinedTotal === 'number' ? p.blocksMinedTotal : 0,
          blocksRelayed: typeof p.blocksRelayed === 'number' ? p.blocksRelayed : 0,
          peersDiscovered: typeof p.peersDiscovered === 'number' ? p.peersDiscovered : 0,
          heartbeatsSent: typeof p.heartbeatsSent === 'number' ? p.heartbeatsSent : 0,
          heartbeatsReceived: typeof p.heartbeatsReceived === 'number' ? p.heartbeatsReceived : 0,
          chunksServed: typeof p.chunksServed === 'number' ? p.chunksServed : 0,
          acksReceived: typeof p.acksReceived === 'number' ? p.acksReceived : 0,
          lastBlockMinedAt: typeof p.lastBlockMinedAt === 'number' ? p.lastBlockMinedAt : null,
          lastHeartbeatAt: typeof p.lastHeartbeatAt === 'number' ? p.lastHeartbeatAt : null,
          // Legacy
          transactionsProcessed: typeof p.transactionsProcessed === 'number' ? p.transactionsProcessed : 0,
          spaceHosted: typeof p.spaceHosted === 'number' ? p.spaceHosted : 0,
        };
      }
    } catch { /* ignore */ }
    return {
      blocksMinedTotal: 0, blocksRelayed: 0, peersDiscovered: 0,
      heartbeatsSent: 0, heartbeatsReceived: 0, chunksServed: 0,
      acksReceived: 0, lastBlockMinedAt: null, lastHeartbeatAt: null,
      transactionsProcessed: 0, spaceHosted: 0,
    };
  }

  private saveMiningStats(): void {
    try { localStorage.setItem(KEYS.MINING_STATS, JSON.stringify(this.miningStats)); } catch { /* ignore */ }
    this.emitMining();
  }

  getMiningStats(): MiningStats { return { ...this.miningStats }; }

  private startMiningLoop(): void {
    this.stopMiningLoop();

    // ── Gate check: mining toggle ──
    if (!this.toggles.mining) {
      console.log('[SwarmMesh][Mining] ⛏️ START BLOCKED — mining toggle is OFF');
      return;
    }
    if (this.phase !== 'online') {
      console.log(`[SwarmMesh][Mining] ⛏️ START BLOCKED — phase is "${this.phase}" (need "online")`);
      return;
    }

    console.log(
      `[SwarmMesh][Mining] ⛏️ STARTED — interval=${MINING_INTERVAL}ms, ` +
      `peers=${this.connections.size}, blockHeight=${this.miningStats.blocksMinedTotal}`
    );

    this.miningTimer = setInterval(() => {
      // ── Per-tick gate checks ──
      if (this.phase !== 'online') {
        console.log(`[SwarmMesh][Mining] ⛏️ TICK HALTED — phase changed to "${this.phase}"`);
        this.stopMiningLoop();
        return;
      }
      if (!this.toggles.mining) {
        console.log('[SwarmMesh][Mining] ⛏️ TICK HALTED — mining toggle switched OFF mid-loop');
        this.stopMiningLoop();
        return;
      }

      // ── Stage 1: Record honest block production ──
      this.miningStats.blocksMinedTotal += 1;
      this.miningStats.lastBlockMinedAt = now();
      this.saveMiningStats();

      console.log(
        `[SwarmMesh][Mining] ⛏️ BLOCK #${this.miningStats.blocksMinedTotal} MINED — ` +
        `peers=${this.connections.size}, blocksRelayed=${this.miningStats.blocksRelayed}, ` +
        `heartbeats=${this.miningStats.heartbeatsSent}`
      );

      // ── Stage 2: Build enriched payload (Mining as Motion) ──
      const librarySnapshot = Array.from(this.library.keys())
        .filter(id => id !== this.peerId && !this.blockedPeers.has(id))
        .slice(0, 5);

      const payload = {
        type: 'blockchain-tx' as const,
        txId: `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`,
        actionType: 'mining_reward' as const,
        meta: {
          blocksProduced: this.miningStats.blocksMinedTotal,
          blocksRelayed: this.miningStats.blocksRelayed,
          peerCount: this.connections.size,
          librarySnapshot,
          uptime: this.startedAt ? Math.floor((now() - this.startedAt) / 1000) : 0,
          blockHeight: this.miningStats.blocksMinedTotal,
        },
        minedAt: now(),
      };

      console.log(
        `[SwarmMesh][Mining] ⛏️ BROADCAST → peers=${payload.meta.peerCount}, ` +
        `pexSnapshot=[${librarySnapshot.length} peers], uptime=${payload.meta.uptime}s, ` +
        `blockHeight=${payload.meta.blockHeight}`
      );

      // ── Stage 3: Broadcast to mesh ──
      this.broadcastInternal(payload);
    }, MINING_INTERVAL);
  }

  private stopMiningLoop(): void {
    if (this.miningTimer !== null) {
      clearInterval(this.miningTimer);
      this.miningTimer = null;
      console.log(
        `[SwarmMesh][Mining] ⛏️ STOPPED — final blockHeight=${this.miningStats.blocksMinedTotal}, ` +
        `totalTx=${this.miningStats.transactionsProcessed}, totalMB=${this.miningStats.spaceHosted}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION LIBRARY — Persistent peer directory
  // ═══════════════════════════════════════════════════════════════════

  private loadLibrary(): void {
    try {
      const raw = localStorage.getItem(KEYS.CONNECTION_LIBRARY);
      if (raw) {
        for (const p of JSON.parse(raw) as LibraryPeer[]) {
          if (p.peerId) this.library.set(p.peerId, p);
        }
      }
    } catch { /* ignore */ }
  }

  private saveLibrary(): void {
    try {
      localStorage.setItem(KEYS.CONNECTION_LIBRARY, JSON.stringify(Array.from(this.library.values())));
    } catch { /* ignore */ }
    this.emitLibrary();
  }

  private addToLibrary(remotePeerId: string, source: ConnectionSource, metadata?: { nodeId?: string }): void {
    if (remotePeerId === this.peerId || this.blockedPeers.has(remotePeerId)) return;

    const nodeId = (metadata?.nodeId ?? remotePeerId.replace(/^peer-/, '').split('-')[0] ?? '').toLowerCase();

    // Dedupe by nodeId
    for (const [peerId, entry] of this.library) {
      if (peerId !== remotePeerId && entry.nodeId?.toLowerCase() === nodeId) {
        this.library.delete(peerId);
      }
    }

    const existing = this.library.get(remotePeerId);
    if (existing) {
      existing.lastSeenAt = now();
      existing.nodeId = nodeId;
      // Preserve profile data from prior profile-exchange
      this.saveLibrary();
      return;
    }

    this.library.set(remotePeerId, {
      peerId: remotePeerId,
      nodeId,
      alias: `Node ${nodeId.slice(0, 6)}`,
      addedAt: now(),
      lastSeenAt: now(),
      autoConnect: true,
      source,
    });
    this.saveLibrary();
    console.log(`[SwarmMesh] 📚 Added ${remotePeerId} to library (${source})`);
  }

  removeFromLibrary(remotePeerId: string): void {
    this.library.delete(remotePeerId);
    this.saveLibrary();
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
  }

  getLibrary(): LibraryPeer[] {
    return Array.from(this.library.values());
  }

  onLibraryChange(handler: LibraryHandler): () => void {
    this.libraryHandlers.add(handler);
    handler(this.getLibrary());
    return () => { this.libraryHandlers.delete(handler); };
  }

  private emitLibrary(): void {
    const peers = this.getLibrary();
    for (const h of this.libraryHandlers) { try { h(peers); } catch { /* ignore */ } }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCKED PEERS
  // ═══════════════════════════════════════════════════════════════════

  private loadBlockedPeers(): void {
    try {
      const raw = localStorage.getItem(KEYS.BLOCKED_PEERS);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.blockedPeers.add(id);
    } catch { /* ignore */ }
  }

  private saveBlockedPeers(): void {
    try { localStorage.setItem(KEYS.BLOCKED_PEERS, JSON.stringify(Array.from(this.blockedPeers))); } catch { /* ignore */ }
  }

  blockPeer(remotePeerId: string): void {
    this.blockedPeers.add(remotePeerId);
    this.saveBlockedPeers();
    this.library.delete(remotePeerId);
    this.saveLibrary();
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
    this.emitAlert(`Blocked ${remotePeerId.slice(0, 16)}`, 'info');
  }

  unblockPeer(remotePeerId: string): void {
    this.blockedPeers.delete(remotePeerId);
    this.saveBlockedPeers();
  }

  isBlocked(id: string): boolean { return this.blockedPeers.has(id); }
  getBlockedPeers(): string[] { return Array.from(this.blockedPeers); }

  // ═══════════════════════════════════════════════════════════════════
  // CASCADE CONNECT — Dev Bootstrap → Library → Manual fallback
  // ═══════════════════════════════════════════════════════════════════

  private async cascadeConnect(): Promise<void> {
    if (this.phase !== 'online') return;
    console.log('[SwarmMesh] 🔀 Cascade connect starting...');
    this.unavailablePeers.clear();

    // ─── Phase 1: Dev Bootstrap Peers ───────────────────────────────
    if (DEV_BOOTSTRAP_PEERS.length > 0) {
      console.log(`[SwarmMesh] Phase 1: ${DEV_BOOTSTRAP_PEERS.length} dev bootstrap peer(s)`);
      for (const bp of DEV_BOOTSTRAP_PEERS) {
        if (bp === this.peerId || this.blockedPeers.has(bp) || this.connections.has(bp)) continue;
        this.dialPeer(bp, 'bootstrap');
      }
      await this.sleep(CASCADE_SETTLE_TIME);

      if (this.connections.size > 0) {
        const bootstrapConnected = Array.from(this.peerData.values()).filter(p => p.source === 'bootstrap').length;
        this.emitAlert(`Connected to Swarm Mesh via ${bootstrapConnected} bootstrap node(s)`, 'info');
        this.clearDevRetryTimer();
        return;
      }

      // ─── Phase 1b: Retry peers that returned peer-unavailable ─────
      // PeerJS Cloud can be inconsistent; a second attempt often succeeds
      const retryTargets = DEV_BOOTSTRAP_PEERS.filter(
        bp => bp !== this.peerId && !this.blockedPeers.has(bp) && !this.connections.has(bp) && this.unavailablePeers.has(bp)
      );
      if (retryTargets.length > 0) {
        console.log(`[SwarmMesh] Phase 1b: Retrying ${retryTargets.length} unavailable peer(s)...`);
        this.unavailablePeers.clear();
        for (const bp of retryTargets) {
          this.dialPeer(bp, 'bootstrap');
        }
        await this.sleep(CASCADE_SETTLE_TIME);

        if (this.connections.size > 0) {
          const bootstrapConnected = Array.from(this.peerData.values()).filter(p => p.source === 'bootstrap').length;
          this.emitAlert(`Connected to Swarm Mesh via ${bootstrapConnected} bootstrap node(s)`, 'info');
          this.clearDevRetryTimer();
          return;
        }
      }

      // Dev bootstrap failed — schedule silent 1-hour retry
      console.log('[SwarmMesh] Dev bootstrap unreachable — will silently retry in 1 hour');
      this.scheduleDevRetry();
    }

    // ─── Phase 2: Library peers ─────────────────────────────────────
    if (this.toggles.autoConnect) {
      console.log('[SwarmMesh] Phase 2: Library peers...');
      let libraryDialed = 0;
      for (const [peerId, entry] of this.library) {
        if (!entry.autoConnect || this.connections.has(peerId) || this.blockedPeers.has(peerId)) continue;
        if (peerId === this.peerId) continue;
        this.dialPeer(peerId, 'library');
        libraryDialed++;
      }

      if (libraryDialed > 0) {
        await this.sleep(CASCADE_SETTLE_TIME);
        if (this.connections.size > 0) {
          this.emitAlert(`Connected to Swarm Mesh via saved contacts`, 'info');
          return;
        }
      }
    }

    // ─── Phase 3: No one online — prompt user ───────────────────────
    console.log('[SwarmMesh] ⚠️ No online nodes found in cascade');
    this.emitAlert('No online nodes found — enter a Peer ID to join the Swarm Mesh', 'warn');
  }

  // ── Dev bootstrap 24h retry logic ─────────────────────────────────

  private shouldRetryDevBootstrap(): boolean {
    if (DEV_BOOTSTRAP_PEERS.length === 0) return false;
    try {
      const retryAt = localStorage.getItem(KEYS.DEV_RETRY_AT);
      if (!retryAt) return true; // first time, always try
      return now() >= parseInt(retryAt, 10);
    } catch { return true; }
  }

  private scheduleDevRetry(): void {
    const nextRetry = now() + DEV_RETRY_INTERVAL;
    try { localStorage.setItem(KEYS.DEV_RETRY_AT, String(nextRetry)); } catch { /* ignore */ }

    this.clearDevRetryTimer();
    this.devRetryTimer = setTimeout(() => {
      this.devRetryTimer = null;
      if (this.phase === 'online' && DEV_BOOTSTRAP_PEERS.length > 0) {
        console.log('[SwarmMesh] 🔄 1-hour silent dev bootstrap retry (single attempt per peer)...');
        let anyDialed = false;
        for (const bp of DEV_BOOTSTRAP_PEERS) {
          if (bp === this.peerId || this.blockedPeers.has(bp) || this.connections.has(bp)) continue;
          // Single dial attempt — no reconnect retries or fallback
          this.dialPeer(bp, 'bootstrap');
          anyDialed = true;
        }
        // Re-schedule for the next hour regardless of outcome
        if (anyDialed) {
          this.scheduleDevRetry();
        }
      }
    }, DEV_RETRY_INTERVAL);
  }

  private clearDevRetryTimer(): void {
    if (this.devRetryTimer !== null) { clearTimeout(this.devRetryTimer); this.devRetryTimer = null; }
    try { localStorage.removeItem(KEYS.DEV_RETRY_AT); } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-RECONNECT LIBRARY
  // ═══════════════════════════════════════════════════════════════════

  private autoConnectLibrary(): void {
    if (this.phase !== 'online' || !this.toggles.autoConnect) return;
    let dialed = 0;
    for (const [peerId, entry] of this.library) {
      if (!entry.autoConnect) continue;
      if (this.connections.has(peerId)) continue;
      if (this.blockedPeers.has(peerId)) continue;
      if (peerId === this.peerId) continue;
      this.dialPeer(peerId, entry.source ?? 'library');
      dialed++;
    }
    if (dialed > 0) {
      console.log(`[SwarmMesh] 📡 Auto-dialing ${dialed} saved peer(s) from library`);
    }
  }

  private startLibraryReconnectLoop(): void {
    this.stopLibraryReconnectLoop();
    this.libraryReconnectTimer = setInterval(() => {
      if (this.phase !== 'online' || !this.toggles.autoConnect) return;

      // Mining as Motion: sort candidates so recently-mining peers are dialed first
      const candidates = Array.from(this.library.entries())
        .filter(([peerId, entry]) => entry.autoConnect && !this.connections.has(peerId) && !this.blockedPeers.has(peerId) && peerId !== this.peerId)
        .sort(([, a], [, b]) => {
          // Peers we've previously seen mining get priority (lastSeenAt as proxy, but
          // peerData.lastMinedBlock is the real signal when available)
          const aMinedAt = this.peerData.get(a.peerId)?.lastMinedBlock ?? 0;
          const bMinedAt = this.peerData.get(b.peerId)?.lastMinedBlock ?? 0;
          return bMinedAt - aMinedAt; // most recently mining first
        });

      if (candidates.length > 0) {
        const topMined = this.peerData.get(candidates[0][0])?.lastMinedBlock;
        console.log(
          `[SwarmMesh][Mining] 🔄 RECONNECT LOOP — ${candidates.length} candidates, ` +
          `top priority lastMinedBlock=${topMined ? new Date(topMined).toISOString() : 'never'}`
        );
      }

      for (const [peerId, entry] of candidates) {
        this.dialPeer(peerId, entry.source ?? 'library');
      }
    }, LIBRARY_RECONNECT_INTERVAL);
  }

  private stopLibraryReconnectLoop(): void {
    if (this.libraryReconnectTimer !== null) { clearInterval(this.libraryReconnectTimer); this.libraryReconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════

  private setPhase(next: SwarmPhase): void {
    if (this.phase === next) return;
    const prev = this.phase;
    this.phase = next;
    console.log(`[SwarmMesh] Phase: ${prev} → ${next}`);
    for (const h of this.phaseHandlers) { try { h(next); } catch { /* ignore */ } }
  }

  getPhase(): SwarmPhase { return this.phase; }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.phase === 'connecting' || this.phase === 'online' || this.initInProgress) return;

    this.flags.enabled = true;
    this.saveFlags();
    this.startedAt = now();
    this.reconnectAttempt = 0;

    await this.loadPostsFromDB();
    await this.connectSignaling();
  }

  stop(): void {
    this.flags.enabled = false;
    this.saveFlags();
    this.clearReconnectTimer();
    this.clearIntervals();
    this.stopLibraryReconnectLoop();
    this.stopMiningLoop();
    this.clearDevRetryTimer();
    this.clearPendingAssetRequests();
    this.clearAssetRetryTimers();
    this.destroyPeer();
    this.peerData.clear();
    this.connections.clear();
    this.setPhase('off');
    this.emitPeers();
    this.emitAlert('Swarm Mesh disconnected', 'info');
    console.log('[SwarmMesh] ⏹️ Stopped');
  }

  async autoStart(): Promise<void> {
    if (!this.flags.enabled) {
      console.log('[SwarmMesh] Flags say offline, skipping auto-start');
      return;
    }
    console.log('[SwarmMesh] Auto-starting from persisted flags...');
    await this.start();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEERJS SIGNALING
  // ═══════════════════════════════════════════════════════════════════

  private async connectSignaling(): Promise<void> {
    if (this.initInProgress) {
      console.warn('[SwarmMesh] Connection already in progress, skipping');
      return;
    }

    this.initInProgress = true;
    this.setPhase(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    this.destroyPeer();

    if (this.reconnectAttempt > 0) {
      const cooldown = Math.min(2000 + this.reconnectAttempt * 500, 5000);
      console.log(`[SwarmMesh] Waiting ${cooldown}ms for server to release session...`);
      await this.sleep(cooldown);
    }

    try {
      const Peer = (await import('peerjs')).default;
      const endpoint = DEFAULT_SIGNALING_ENDPOINTS[0];

      console.log(`[SwarmMesh] 🔌 Creating PeerJS instance with ID: ${this.peerId}`);

      const peer = new Peer(this.peerId, {
        debug: 1,
        host: endpoint.host,
        port: endpoint.port,
        secure: endpoint.secure,
        path: endpoint.path,
        config: { iceServers: DEFAULT_ICE },
      });

      const initResult = await this.waitForOpen(peer);

      if (!initResult.success) {
        console.warn(`[SwarmMesh] ❌ PeerJS init failed: ${initResult.error}`);
        this.destroyPeerInstance(peer);
        this.initInProgress = false;
        this.scheduleReconnect();
        return;
      }

      this.peer = peer;
      this.initInProgress = false;

      this.setupPeerHandlers(peer);
      this.startIntervals();

      this.flags.lastOnlineAt = now();
      this.saveFlags();
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();

      this.setPhase('online');
      this.emitAlert('Connected to P2P network', 'info');
      console.log(`[SwarmMesh] ✅ Online as ${this.peerId}`);

      // Start cascade connect after brief delay
      setTimeout(() => void this.cascadeConnect(), 2000);
      this.startLibraryReconnectLoop();

      // Auto-start mining
      if (this.toggles.mining) {
        console.log('[SwarmMesh][Mining] ⛏️ AUTO-START — node went online, mining toggle is ON');
        this.startMiningLoop();
      } else {
        console.log('[SwarmMesh][Mining] ⛏️ AUTO-START SKIPPED — node online but mining toggle is OFF');
      }

      // Auto-start torrent swarming for multi-peer content distribution
      this.startTorrentSwarm();

    } catch (err) {
      console.error('[SwarmMesh] Unexpected init error:', err);
      this.initInProgress = false;
      this.scheduleReconnect();
    }
  }

  private waitForOpen(peer: import('peerjs').default): Promise<{ success: boolean; error?: string }> {
    return new Promise(resolve => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.removeAllListeners?.();
        resolve({ success: false, error: 'Signaling timeout' });
      }, PEERJS_INIT_TIMEOUT);

      peer.on('open', (_id: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ success: true });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const msg = err?.message || 'Unknown error';
        const idTaken = err?.type === 'unavailable-id' || /ID.*taken|unavailable/i.test(msg);

        if (idTaken) {
          resolve({ success: false, error: `ID "${this.peerId}" still held by server — will retry` });
        } else {
          resolve({ success: false, error: msg });
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // RECONNECT
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (!this.flags.enabled) { this.setPhase('off'); return; }
    if (this.reconnectAttempt >= RECONNECT_INTERVALS.length) {
      this.flags.enabled = false;
      this.saveFlags();
      this.setPhase('failed');
      this.emitAlert('Connection failed — try refreshing', 'error');
      return;
    }
    const delay = RECONNECT_INTERVALS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.setPhase('reconnecting');
    this.emitAlert(`Reconnecting in ${delay / 1000}s (${this.reconnectAttempt}/${RECONNECT_INTERVALS.length})…`, 'warn');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.flags.enabled) void this.connectSignaling();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  private setupPeerHandlers(peer: import('peerjs').default): void {
    peer.on('connection', (conn: import('peerjs').DataConnection) => {
      const remotePeerId = conn.peer;
      console.log('[SwarmMesh] 📥 Incoming from:', remotePeerId);

      if (this.blockedPeers.has(remotePeerId)) {
        console.log(`[SwarmMesh] 🚫 Rejecting blocked peer: ${remotePeerId}`);
        try { conn.close(); } catch { /* ignore */ }
        return;
      }

      const meta = conn.metadata as { source?: string } | undefined;
      this.handleConnection(conn, (meta?.source as ConnectionSource) ?? 'manual');
    });

    peer.on('disconnected', () => {
      console.warn('[SwarmMesh] ⚠️ Signaling lost');
      if (this.peer && !this.peer.destroyed) {
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            try { this.peer.reconnect(); } catch { this.handleLost(); }
          } else { this.handleLost(); }
        }, 3000);
      } else { this.handleLost(); }
    });

    peer.on('error', (err: Error & { type?: string }) => {
      console.error('[SwarmMesh] Error:', err?.type, err?.message);
      if (err?.type === 'peer-unavailable') {
        // Extract the target peer ID from the error message
        const match = err.message?.match(/peer\s+(peer-[a-f0-9]+)/i);
        if (match?.[1]) {
          this.unavailablePeers.add(match[1]);
        }
        return; // Non-fatal — don't trigger reconnect
      }
      if (['network', 'server-error', 'socket-error'].includes(err?.type ?? '')) this.handleLost();
    });

    peer.on('close', () => this.handleLost());
  }

  private handleLost(): void {
    if (['reconnecting', 'off', 'failed'].includes(this.phase)) return;
    console.log('[SwarmMesh] Connection lost → reconnect');
    this.clearIntervals();
    this.stopMiningLoop();
    this.stopTorrentSwarm();
    this.peer = null;
    this.connections.clear();
    this.peerData.clear();
    this.emitPeers();
    this.reconnectAttempt = 0;
    this.scheduleReconnect();
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA CONNECTION HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleConnection(conn: import('peerjs').DataConnection, source: ConnectionSource): void {
    const rId = conn.peer;

    if (this.blockedPeers.has(rId)) {
      try { conn.close(); } catch { /* ignore */ }
      return;
    }

    conn.on('open', () => {
      console.log(`[SwarmMesh] ✅ Channel open: ${rId} (${source})`);
      this.connections.set(rId, conn);
      this.peerData.set(rId, {
        peerId: rId,
        connectedAt: now(),
        lastActivity: now(),
        messagesReceived: 0,
        messagesSent: 0,
        avgRttMs: null,
        lastRttMs: null,
        lastMinedBlock: null,
        miningRtt: null,
        source,
      });
      this.emitPeers();

      const meta = conn.metadata as { nodeId?: string } | undefined;
      this.addToLibrary(rId, source, meta ?? undefined);

      // Exchange content inventories
      this.sendContentInventory(conn);

      // Send our profile to the peer
      this.sendProfileExchange(conn);

      // Exchange libraries for mesh growth
      if (this.toggles.libraryExchange) {
        this.sendLibraryExchange(conn);
        // Rebroadcast updated library to ALL other peers so they discover this new peer
        // This creates the triangle: A↔B, A↔C → B learns about C → B↔C
        this.rebroadcastLibrary(rId);
      }

      if (source === 'manual') {
        this.emitAlert(`Connected to ${rId.slice(0, 16)} (manual)`, 'info');
      }
    });

    conn.on('data', (raw: unknown) => {
      const p = this.peerData.get(rId);
      if (p) { p.lastActivity = now(); p.messagesReceived++; }
      this.handleMessage(rId, raw);
    });

    conn.on('close', () => {
      this.connections.delete(rId);
      this.peerData.delete(rId);
      this.emitPeers();
    });

    conn.on('error', (err: Error) => {
      console.warn(`[SwarmMesh] Conn error ${rId}:`, err?.message);
      this.connections.delete(rId);
      this.peerData.delete(rId);
      this.emitPeers();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DIAL PEER
  // ═══════════════════════════════════════════════════════════════════

  private dialPeer(remotePeerId: string, source: ConnectionSource): void {
    if (!this.peer || this.peer.destroyed) return;
    if (remotePeerId === this.peerId || this.connections.has(remotePeerId)) return;

    console.log(`[SwarmMesh] 🔗 Dialing ${remotePeerId} (${source})`);
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: { nodeId: this.nodeId, source },
    });
    this.handleConnection(conn, source);
  }

  connectToPeer(remotePeerId: string): boolean {
    remotePeerId = remotePeerId.trim();
    if (!remotePeerId) {
      this.emitAlert('Enter a peer ID to connect', 'warn');
      return false;
    }
    if (!remotePeerId.startsWith('peer-')) {
      remotePeerId = `peer-${remotePeerId}`;
    }

    if (!this.peer || this.peer.destroyed || this.phase !== 'online') {
      this.emitAlert('Start Swarm Mesh first', 'warn');
      return false;
    }

    if (remotePeerId === this.peerId) return false;

    if (this.blockedPeers.has(remotePeerId)) {
      this.emitAlert('That peer is blocked', 'warn');
      return false;
    }

    if (this.connections.has(remotePeerId)) {
      this.emitAlert('Already connected', 'info');
      return false;
    }

    this.dialPeer(remotePeerId, 'manual');
    this.emitAlert(`Dialing ${remotePeerId.slice(0, 16)}…`, 'info');
    return true;
  }

  disconnectPeer(remotePeerId: string): void {
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIBRARY EXCHANGE — peers share contacts for mesh growth
  // ═══════════════════════════════════════════════════════════════════

  private sendLibraryExchange(conn: import('peerjs').DataConnection): void {
    const shareable = Array.from(this.library.values())
      .filter(p => p.peerId !== this.peerId && !this.blockedPeers.has(p.peerId))
      .map(p => ({ peerId: p.peerId, nodeId: p.nodeId, alias: p.alias }));
    try {
      conn.send(JSON.stringify({ type: 'library-exchange', peers: shareable, from: this.peerId }));
    } catch { /* ignore */ }
  }

  private handleLibraryExchange(fromPeerId: string, msg: Record<string, unknown>): void {
    const remote = msg.peers as Array<{ peerId: string; nodeId?: string; alias?: string }> | undefined;
    if (!Array.isArray(remote)) return;

    // Update lastSeenAt for the sender — they are clearly online
    const senderEntry = this.library.get(fromPeerId);
    if (senderEntry) {
      senderEntry.lastSeenAt = now();
      this.saveLibrary();
    }

    let added = 0;
    for (const rp of remote) {
      if (!rp.peerId || rp.peerId === this.peerId || this.blockedPeers.has(rp.peerId)) continue;

      // Update lastSeenAt for peers we're currently connected to
      if (this.connections.has(rp.peerId)) {
        const existing = this.library.get(rp.peerId);
        if (existing) existing.lastSeenAt = now();
        continue;
      }

      if (this.library.has(rp.peerId)) continue;

      this.library.set(rp.peerId, {
        peerId: rp.peerId,
        nodeId: rp.nodeId ?? rp.peerId.replace(/^peer-/, ''),
        alias: rp.alias ?? `Node ${(rp.nodeId ?? rp.peerId).slice(0, 6)}`,
        addedAt: now(),
        lastSeenAt: 0,
        autoConnect: true,
        source: 'exchange',
      });
      added++;
    }

    if (added > 0) {
      this.saveLibrary();
      console.log(`[SwarmMesh] 📚 Imported ${added} peer(s) from ${fromPeerId}`);
      // Try connecting to newly discovered peers
      for (const rp of remote) {
        if (!rp.peerId || rp.peerId === this.peerId || this.connections.has(rp.peerId) || this.blockedPeers.has(rp.peerId)) continue;
        this.dialPeer(rp.peerId, 'exchange');
      }
      // Rebroadcast our updated library to all OTHER peers so they learn about the new peers too
      // This creates a ripple effect for full mesh discovery
      if (this.toggles.libraryExchange) {
        this.rebroadcastLibrary(fromPeerId);
      }
    }
  }

  /**
   * Rebroadcast our full library to all connected peers except the excluded one.
   * This is the key mechanism for triangle gossip: when A connects to C,
   * A rebroadcasts to B so B discovers C and dials them.
   */
  private rebroadcastLibrary(excludePeerId?: string): void {
    const shareable = Array.from(this.library.values())
      .filter(p => p.peerId !== this.peerId && !this.blockedPeers.has(p.peerId))
      .map(p => ({ peerId: p.peerId, nodeId: p.nodeId, alias: p.alias }));

    if (shareable.length === 0) return;

    let sent = 0;
    for (const [peerId, conn] of this.connections) {
      if (peerId === excludePeerId) continue;
      try {
        conn.send(JSON.stringify({ type: 'library-exchange', peers: shareable, from: this.peerId }));
        sent++;
      } catch { /* ignore */ }
    }
    if (sent > 0) {
      console.log(`[SwarmMesh] 📡 Rebroadcast library (${shareable.length} peers) to ${sent} connection(s), excluding ${excludePeerId?.slice(0, 16) ?? 'none'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT SERVING
  // ═══════════════════════════════════════════════════════════════════

  addContent(item: Omit<ContentItem, 'hash'>): void {
    const hash = `${item.id}-${item.timestamp}`;
    const full: ContentItem = { ...item, hash };
    this.contentStore.set(item.id, full);
    this.broadcastInternal({ type: 'content-push', items: [full] });
    for (const h of this.contentHandlers) { try { h(full); } catch { /* ignore */ } }
    this.emitContentChange();
  }

  getContent(): ContentItem[] {
    return Array.from(this.contentStore.values());
  }

  broadcastNewPost(post: Record<string, unknown>): void {
    if (this.phase !== 'online') return;
    const id = post.id as string;
    if (!id) return;

    // Always update the content store with the latest version
    const item: ContentItem = {
      id,
      type: 'post',
      data: post,
      author: (post.author as string) ?? 'unknown',
      timestamp: post.createdAt ? new Date(post.createdAt as string).getTime() : Date.now(),
      hash: `${id}-${Date.now()}`,
    };
    this.contentStore.set(id, item);
    this.emitContentChange();

    this.broadcastInternal({ type: 'content-push', items: [item] });
    console.log(`[SwarmMesh] 📤 Broadcast post ${id} to ${this.connections.size} peer(s)`);

    // If post has manifest IDs, also broadcast the file data
    const manifestIds = post.manifestIds as string[] | undefined;
    if (Array.isArray(manifestIds) && manifestIds.length > 0) {
      void this.broadcastFileDataForPost(manifestIds);
    }
  }

  /**
   * Broadcast a comment through the mesh so all peers save it to their local IndexedDB.
   */
  broadcastComment(comment: Record<string, unknown>): void {
    if (this.phase !== 'online') return;
    const id = comment.id as string;
    if (!id) return;

    const item: ContentItem = {
      id,
      type: 'comment',
      data: comment,
      author: (comment.author as string) ?? 'unknown',
      timestamp: comment.createdAt ? new Date(comment.createdAt as string).getTime() : Date.now(),
      hash: `${id}-${Date.now()}`,
    };
    this.contentStore.set(id, item);
    this.broadcastInternal({ type: 'content-push', items: [item] });
    console.log(`[SwarmMesh] 💬 Broadcast comment ${id} to ${this.connections.size} peer(s)`);
  }

  private sendContentInventory(conn: import('peerjs').DataConnection): void {
    const ids = Array.from(this.contentStore.keys());
    try { conn.send(JSON.stringify({ type: 'content-inventory', ids, from: this.peerId })); } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleMessage(from: string, raw: unknown): void {
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || typeof data !== 'object') return;
      const msg = data as { type?: string; [key: string]: unknown };

      if (typeof msg.type === 'string' && msg.type.startsWith('channel:')) {
        this.handleChannelMessage(from, msg.type, msg.payload);
        return;
      }

      switch (msg.type) {
        case 'content-inventory': this.handleInventory(from, msg); break;
        case 'content-request': this.handleRequest(from, msg); break;
        case 'content-push': this.handlePush(from, msg); break;
        case 'file-manifest': void this.handleFileManifest(from, msg); break;
        case 'manifest-request': void this.handleManifestRequest(from, msg); break;
        case 'manifest-response': this.resolveAssetRequest(msg); break;
        case 'chunk-request': void this.handleChunkRequest(from, msg); break;
        case 'chunk-response': this.resolveAssetRequest(msg); break;
        case 'file-data': void this.handleFileData(msg); break;
        case 'seeding-available': this.handleSeedingAvailable(from, msg); break;
        case 'library-exchange': this.handleLibraryExchange(from, msg); break;
        case 'profile-exchange': this.handleProfileExchange(from, msg); break;
        case 'heartbeat': this.handleHeartbeat(from); break;
        case 'heartbeat-ack': this.handleHeartbeatAck(from); break;
        case 'ping': this.handlePing(from, msg); break;
        case 'pong': this.handlePong(from, msg); break;
        case 'blockchain-tx': this.handleMiningBroadcast(from, msg); break;
        case 'mining-ack': this.handleMiningAck(from, msg); break;
        default: break;
      }
    } catch (e) {
      console.warn('[SwarmMesh] Parse error from', from, e);
    }
  }

  private handleInventory(from: string, msg: Record<string, unknown>): void {
    const ids = msg.ids as string[] | undefined;
    if (!Array.isArray(ids)) return;
    const needed = ids.filter(id => !this.contentStore.has(id));
    if (!needed.length) return;
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'content-request', ids: needed, from: this.peerId })); } catch { /* ignore */ }
  }

  private handleRequest(from: string, msg: Record<string, unknown>): void {
    const ids = msg.ids as string[] | undefined;
    if (!Array.isArray(ids)) return;
    const conn = this.connections.get(from);
    if (!conn) return;
    const items = ids.map(id => this.contentStore.get(id)).filter((i): i is ContentItem => !!i);
    if (!items.length) return;
    try {
      conn.send(JSON.stringify({ type: 'content-push', items, from: this.peerId }));
      const p = this.peerData.get(from);
      if (p) p.messagesSent++;
    } catch { /* ignore */ }
  }

  private handlePush(fromPeerId: string, msg: Record<string, unknown>): void {
    const items = msg.items as ContentItem[] | undefined;
    if (!Array.isArray(items)) return;
    let n = 0;
    for (const item of items) {
      if (!item.id) continue;
      const existing = this.contentStore.get(item.id);
      const incomingTimestamp = typeof item.timestamp === 'number' ? item.timestamp : now();
      const shouldReplace =
        !existing ||
        incomingTimestamp >= existing.timestamp ||
        item.hash !== existing.hash;

      if (!shouldReplace) continue;

      this.contentStore.set(item.id, {
        ...item,
        timestamp: incomingTimestamp,
      });
      n++;
      if (item.type === 'post' && item.data) this.writePostToDB(item.data as Record<string, unknown>, fromPeerId);
      if (item.type === 'comment' && item.data) this.writeCommentToDB(item.data as Record<string, unknown>);
      for (const h of this.contentHandlers) { try { h(item); } catch { /* ignore */ } }
    }
    if (n > 0) {
      console.log(`[SwarmMesh] 📦 ${n} new/updated item(s), total: ${this.contentStore.size}`);
      this.emitContentChange();
    }
  }

  private handleChannelMessage(from: string, type: string, payload: unknown): void {
    const channel = type.replace('channel:', '');
    if (!channel) return;
    const handlers = this.channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(from, payload);
      } catch (error) {
        console.warn(`[SwarmMesh] Channel handler error (${channel}):`, error);
      }
    }
  }

  private handleHeartbeat(from: string): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'heartbeat-ack', from: this.peerId, ts: now() })); } catch { /* ignore */ }
  }

  private handleHeartbeatAck(from: string): void {
    const p = this.peerData.get(from);
    if (p) p.lastActivity = now();
    this.miningStats.heartbeatsReceived++;
    this.saveMiningStats();
  }

  private handlePing(from: string, msg: Record<string, unknown>): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'pong', from: this.peerId, echoTs: msg.ts })); } catch { /* ignore */ }
  }

  private handlePong(from: string, msg: Record<string, unknown>): void {
    const echoTs = msg.echoTs as number | undefined;
    if (typeof echoTs !== 'number') return;
    const rtt = now() - echoTs;
    const p = this.peerData.get(from);
    if (p) {
      p.lastRttMs = rtt;
      p.avgRttMs = p.avgRttMs != null ? Math.round(p.avgRttMs * 0.7 + rtt * 0.3) : rtt;
      p.lastActivity = now();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MINING AS MOTION — mining broadcasts strengthen the mesh
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming mining broadcast from a peer.
   * Treats it as a confirmed liveness signal, performs passive PEX
   * via the librarySnapshot, and sends a mining-ack for RTT measurement.
   */
  private handleMiningBroadcast(from: string, msg: Record<string, unknown>): void {
    const meta = msg.meta as Record<string, unknown> | undefined;
    const blockHeight = meta?.blockHeight ?? '?';
    const peerCount = meta?.peerCount ?? '?';

    console.log(
      `[SwarmMesh][Mining] 📥 BLOCK RECEIVED from ${from.slice(0, 16)}… — ` +
      `blockHeight=${blockHeight}, peerCount=${peerCount}`
    );

    // ── Stage: Liveness update ──
    const p = this.peerData.get(from);
    if (p) {
      p.lastActivity = now();
      p.lastMinedBlock = now();
      console.log(`[SwarmMesh][Mining] 💓 LIVENESS updated for ${from.slice(0, 16)}… (lastMinedBlock set)`);
    }

    // ── Stage: Passive PEX ──
    if (meta && Array.isArray(meta.librarySnapshot)) {
      let newPeers = 0;
      for (const snapshotPeerId of meta.librarySnapshot) {
        if (typeof snapshotPeerId !== 'string') continue;
        if (snapshotPeerId === this.peerId || this.blockedPeers.has(snapshotPeerId)) continue;
        if (this.library.has(snapshotPeerId) || this.connections.has(snapshotPeerId)) continue;
        // Discovered via mining PEX — add to library and attempt dial
        this.library.set(snapshotPeerId, {
          peerId: snapshotPeerId,
          nodeId: snapshotPeerId.replace(/^peer-/, ''),
          alias: `Node ${snapshotPeerId.slice(5, 11)}`,
          addedAt: now(),
          lastSeenAt: 0,
          autoConnect: true,
          source: 'exchange',
        });
        this.dialPeer(snapshotPeerId, 'exchange');
        newPeers++;
      }
      this.saveLibrary();
      console.log(
        `[SwarmMesh][Mining] 🔗 PEX from block — snapshot had ${(meta.librarySnapshot as unknown[]).length} peers, ` +
        `${newPeers} NEW discovered & dialed`
      );
    } else {
      console.log(`[SwarmMesh][Mining] 🔗 PEX — no librarySnapshot in block`);
    }

    // ── Stage: Send mining-ack ──
    const conn = this.connections.get(from);
    if (conn) {
      try {
        conn.send(JSON.stringify({
          type: 'mining-ack',
          from: this.peerId,
          blockHeight: this.miningStats.blocksMinedTotal,
          peerCount: this.connections.size,
          echoMinedAt: msg.minedAt,
          ts: now(),
        }));
        console.log(`[SwarmMesh][Mining] ✅ ACK SENT to ${from.slice(0, 16)}… (echoMinedAt=${msg.minedAt})`);
      } catch (e) {
        console.warn(`[SwarmMesh][Mining] ❌ ACK FAILED to ${from.slice(0, 16)}…`, e);
      }
    } else {
      console.log(`[SwarmMesh][Mining] ⚠️ ACK SKIPPED — no active connection to ${from.slice(0, 16)}…`);
    }
  }

  /**
   * Handle a mining-ack response. Calculates RTT from the echoed
   * minedAt timestamp to measure connection quality.
   */
  private handleMiningAck(from: string, msg: Record<string, unknown>): void {
    const echoMinedAt = msg.echoMinedAt as number | undefined;
    const p = this.peerData.get(from);
    if (p) {
      p.lastActivity = now();
      if (typeof echoMinedAt === 'number') {
        const rtt = now() - echoMinedAt;
        p.miningRtt = rtt;
        p.lastRttMs = rtt;
        p.avgRttMs = p.avgRttMs != null ? Math.round(p.avgRttMs * 0.7 + rtt * 0.3) : rtt;
        console.log(
          `[SwarmMesh][Mining] 📡 ACK RECEIVED from ${from.slice(0, 16)}… — ` +
          `RTT=${rtt}ms, avgRtt=${p.avgRttMs}ms, peerBlockHeight=${msg.blockHeight ?? '?'}`
        );
      } else {
        console.log(`[SwarmMesh][Mining] 📡 ACK RECEIVED from ${from.slice(0, 16)}… — no echoMinedAt (RTT unavailable)`);
      }
    } else {
      console.log(`[SwarmMesh][Mining] ⚠️ ACK from unknown peer ${from.slice(0, 16)}…`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERVALS — Heartbeat, RTT ping, Content Sync
  // ═══════════════════════════════════════════════════════════════════

  private startIntervals(): void {
    this.clearIntervals();

    this.heartbeatTimer = setInterval(() => {
      const t = now();
      for (const [peerId, peer] of this.peerData) {
        // Mining as Motion: peers actively mining get a longer stale threshold
        const isMining = peer.lastMinedBlock != null && (t - peer.lastMinedBlock) < MINING_COLD_THRESHOLD;
        const threshold = isMining ? PEER_STALE_THRESHOLD_MINING : PEER_STALE_THRESHOLD;

        if (t - peer.lastActivity > threshold) {
          console.log(
            `[SwarmMesh][Mining] 🧊 STALE PEER ${peerId.slice(0, 16)}… removed — ` +
            `idle=${Math.round((t - peer.lastActivity) / 1000)}s, threshold=${threshold / 1000}s, ` +
            `wasMining=${isMining}`
          );
          const conn = this.connections.get(peerId);
          try { conn?.close(); } catch { /* ignore */ }
          this.connections.delete(peerId);
          this.peerData.delete(peerId);
          this.emitPeers();
          continue;
        }
        const conn = this.connections.get(peerId);
        if (conn) {
          try { conn.send(JSON.stringify({ type: 'heartbeat', from: this.peerId })); this.miningStats.heartbeatsSent++; } catch { /* ignore */ }
          try { conn.send(JSON.stringify({ type: 'ping', from: this.peerId, ts: now() })); } catch { /* ignore */ }
          this.miningStats.lastHeartbeatAt = now();
          this.saveMiningStats();
        }
      }
    }, HEARTBEAT_INTERVAL);

    this.contentSyncTimer = setInterval(() => {
      for (const [, conn] of this.connections) this.sendContentInventory(conn);
    }, CONTENT_SYNC_INTERVAL);
  }

  private clearIntervals(): void {
    if (this.heartbeatTimer !== null) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.contentSyncTimer !== null) { clearInterval(this.contentSyncTimer); this.contentSyncTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BROADCAST
  // ═══════════════════════════════════════════════════════════════════

  private broadcastInternal(msg: Record<string, unknown>): void {
    const payload = JSON.stringify({ ...msg, from: this.peerId });
    for (const [peerId, conn] of this.connections) {
      try {
        conn.send(payload);
        const p = this.peerData.get(peerId);
        if (p) p.messagesSent++;
      } catch { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER INSTANCE
  // ═══════════════════════════════════════════════════════════════════

  private destroyPeer(): void {
    if (this.peer) { this.destroyPeerInstance(this.peer); this.peer = null; }
  }

  private destroyPeerInstance(peer: import('peerjs').default): void {
    try {
      peer.removeAllListeners?.();
      if (!peer.destroyed) peer.destroy();
    } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════

  onPhaseChange(handler: PhaseHandler): () => void {
    this.phaseHandlers.add(handler);
    handler(this.phase);
    return () => { this.phaseHandlers.delete(handler); };
  }

  onPeersChange(handler: PeerHandler): () => void {
    this.peerHandlers.add(handler);
    handler(Array.from(this.peerData.values()));
    return () => { this.peerHandlers.delete(handler); };
  }

  onContent(handler: ContentHandler): () => void {
    this.contentHandlers.add(handler);
    return () => { this.contentHandlers.delete(handler); };
  }

  onContentChange(handler: ContentChangeHandler): () => void {
    this.contentChangeHandlers.add(handler);
    handler(this.getContent());
    return () => { this.contentChangeHandlers.delete(handler); };
  }

  onAlert(handler: AlertHandler): () => void {
    this.alertHandlers.add(handler);
    return () => { this.alertHandlers.delete(handler); };
  }

  onToggleChange(handler: ToggleHandler): () => void {
    this.toggleHandlers.add(handler);
    handler(this.getToggles());
    return () => { this.toggleHandlers.delete(handler); };
  }

  onMiningChange(handler: MiningHandler): () => void {
    this.miningHandlers.add(handler);
    handler(this.getMiningStats());
    return () => { this.miningHandlers.delete(handler); };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROFILE EXCHANGE — peers share identity info on connect
  // ═══════════════════════════════════════════════════════════════════

  private getLocalProfile(): { username?: string; displayName?: string; avatarRef?: string } {
    try {
      const raw = localStorage.getItem('me');
      if (!raw) return {};
      const user = JSON.parse(raw);
      return {
        username: user.username || undefined,
        displayName: user.displayName || user.username || undefined,
        avatarRef: user.profile?.avatarRef || undefined,
      };
    } catch { return {}; }
  }

  private sendProfileExchange(conn: import('peerjs').DataConnection): void {
    const profile = this.getLocalProfile();
    if (!profile.username && !profile.displayName) return;
    try {
      conn.send(JSON.stringify({
        type: 'profile-exchange',
        from: this.peerId,
        username: profile.username,
        displayName: profile.displayName,
        avatarRef: profile.avatarRef,
      }));
    } catch { /* ignore */ }
  }

  private handleProfileExchange(fromPeerId: string, msg: Record<string, unknown>): void {
    const username = typeof msg.username === 'string' ? msg.username : undefined;
    const displayName = typeof msg.displayName === 'string' ? msg.displayName : undefined;
    const avatarRef = typeof msg.avatarRef === 'string' ? msg.avatarRef : undefined;

    if (!username && !displayName) return;

    const entry = this.library.get(fromPeerId);
    if (entry) {
      entry.username = username;
      entry.displayName = displayName;
      entry.avatarRef = avatarRef;
      if (displayName) entry.alias = displayName;
      this.saveLibrary();
      this.emitLibrary();
      console.log(`[SwarmMesh] 👤 Profile received from ${fromPeerId}: ${displayName ?? username}`);
    }
  }


  private emitPeers(): void {
    const peers = Array.from(this.peerData.values());
    for (const h of this.peerHandlers) { try { h(peers); } catch { /* ignore */ } }
  }

  private emitAlert(message: string, level: 'info' | 'warn' | 'error'): void {
    console.log(`[SwarmMesh] Alert (${level}): ${message}`);
    for (const h of this.alertHandlers) { try { h(message, level); } catch { /* ignore */ } }
  }

  private emitContentChange(): void {
    const items = this.getContent();
    for (const h of this.contentChangeHandlers) { try { h(items); } catch { /* ignore */ } }
  }

  private emitToggles(): void {
    const t = this.getToggles();
    for (const h of this.toggleHandlers) { try { h(t); } catch { /* ignore */ } }
  }

  private emitMining(): void {
    const s = this.getMiningStats();
    for (const h of this.miningHandlers) { try { h(s); } catch { /* ignore */ } }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════

  getStats(): SwarmMeshStandaloneStats {
    const peers = Array.from(this.peerData.values());
    return {
      phase: this.phase,
      peerId: this.phase === 'online' ? this.peerId : null,
      nodeId: this.nodeId,
      connectedPeers: this.connections.size,
      contentItems: this.contentStore.size,
      uptimeMs: this.startedAt ? now() - this.startedAt : 0,
      reconnectAttempt: this.reconnectAttempt,
      flags: this.getFlags(),
      toggles: this.getToggles(),
      miningStats: this.getMiningStats(),
      bootstrapOnline: peers.filter(p => p.source === 'bootstrap').length,
      libraryOnline: peers.filter(p => p.source === 'library' || p.source === 'exchange').length,
      assetSync: {
        manifestsPulled: this._assetSyncCounters.manifestsPulled,
        chunksPulled: this._assetSyncCounters.chunksPulled,
        chunksServed: this._assetSyncCounters.chunksServed,
        pendingManifests: this.assetRetryTimers.size,
        activeRetries: this.assetRetryAttempts.size,
      },
  };
  }

  // ── File Transfer Preferences ──────────────────────────────────────

  private static readonly PREFS_KEY = 'swarm-mesh-file-prefs';

  private _filePrefs: Record<string, { paused?: boolean; ignored?: boolean; hostFirst?: boolean }> | null = null;

  private loadFilePrefs(): Record<string, { paused?: boolean; ignored?: boolean; hostFirst?: boolean }> {
    if (this._filePrefs) return this._filePrefs;
    try {
      const raw = localStorage.getItem(StandaloneSwarmMesh.PREFS_KEY);
      this._filePrefs = raw ? JSON.parse(raw) : {};
    } catch { this._filePrefs = {}; }
    return this._filePrefs!;
  }

  private saveFilePrefs(): void {
    try { localStorage.setItem(StandaloneSwarmMesh.PREFS_KEY, JSON.stringify(this._filePrefs ?? {})); } catch {}
  }

  setFilePref(fileId: string, key: 'paused' | 'ignored' | 'hostFirst', value: boolean): void {
    const prefs = this.loadFilePrefs();

    // Enforce single-star: un-star any previously starred file first
    if (key === 'hostFirst' && value) {
      for (const [existingId, existingPref] of Object.entries(prefs)) {
        if (existingId !== fileId && existingPref.hostFirst) {
          existingPref.hostFirst = false;
        }
      }
    }

    if (!prefs[fileId]) prefs[fileId] = {};
    prefs[fileId][key] = value;
    this._filePrefs = prefs;
    this.saveFilePrefs();

    // If ignoring, cancel any pending retry
    if (key === 'ignored' && value) {
      this.clearAssetRetry(fileId);
    }
    // If pausing, cancel pending retry (will resume when unpaused)
    if (key === 'paused' && value) {
      this.clearAssetRetry(fileId);
    }
  }

  getFilePref(fileId: string): { paused: boolean; ignored: boolean; hostFirst: boolean } {
    const prefs = this.loadFilePrefs();
    const p = prefs[fileId];
    return { paused: p?.paused ?? false, ignored: p?.ignored ?? false, hostFirst: p?.hostFirst ?? false };
  }

  isFileBlocked(fileId: string): boolean {
    const p = this.getFilePref(fileId);
    return p.paused || p.ignored;
  }

  isHostFirst(fileId: string): boolean {
    return this.getFilePref(fileId).hostFirst;
  }

  /**
   * Returns per-file transfer info for the dashboard.
   */
  async getFileTransferList(): Promise<Array<{
    fileId: string;
    name: string;
    mime: string;
    totalChunks: number;
    receivedChunks: number;
    size: number;
    percent: number;
    retrying: boolean;
    owner: string;
    createdAt: number;
    prefs: { paused: boolean; ignored: boolean; hostFirst: boolean };
  }>> {
    try {
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('manifests')) { db.close(); return []; }
      const manifests = await new Promise<StoredManifestLike[]>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
      });

      // Build a set of all existing chunk refs in one pass for performance
      const hasChunkStore = db.objectStoreNames.contains('chunks');
      const existingChunkRefs = new Set<string>();
      if (hasChunkStore) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            for (const key of (req.result ?? [])) {
              if (typeof key === 'string') existingChunkRefs.add(key);
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
      }

      const results: Array<{
        fileId: string; name: string; mime: string;
        totalChunks: number; receivedChunks: number; size: number;
        percent: number; retrying: boolean;
        owner: string; createdAt: number;
        prefs: { paused: boolean; ignored: boolean; hostFirst: boolean };
      }> = [];

      for (const m of manifests) {
        const fileId = m.fileId ?? '';
        if (!fileId) continue;
        const chunkRefs = Array.isArray(m.chunks) ? m.chunks.filter((r): r is string => typeof r === 'string') : [];
        const received = chunkRefs.filter(ref => existingChunkRefs.has(ref)).length;
        const mRec = m as Record<string, unknown>;
        const fileSize = typeof mRec.size === 'number' ? mRec.size as number : 0;
        // Fixed 1 MiB chunk size — 1:1 ratio of chunks to file size in MiB (rounded up)
        const total = fileSize > 0 ? Math.max(1, Math.ceil(fileSize / 1_048_576)) : chunkRefs.length;
        // Scale received count proportionally if DB refs use different chunk size
        const scaledReceived = chunkRefs.length > 0 && chunkRefs.length !== total
          ? Math.min(total, Math.round((received / chunkRefs.length) * total))
          : received;
        results.push({
          fileId,
          name: mRec.originalName as string ?? fileId.slice(0, 12),
          mime: mRec.mime as string ?? 'unknown',
          totalChunks: total,
          receivedChunks: scaledReceived,
          size: fileSize,
          percent: total > 0 ? Math.round((scaledReceived / total) * 100) : 100,
          retrying: this.assetRetryTimers.has(fileId),
          owner: (mRec.owner as string) ?? '',
          createdAt: typeof mRec.createdAt === 'string' ? new Date(mRec.createdAt as string).getTime() : (typeof mRec.createdAt === 'number' ? mRec.createdAt as number : 0),
          prefs: this.getFilePref(fileId),
        });
      }
      db.close();
      return results;
    } catch {
      return [];
    }
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  getConnectedPeerIds(): string[] {
    return this.getConnectedPeers();
  }

  getPeerDetails(): SwarmPeer[] {
    return Array.from(this.peerData.values());
  }

  getContentBlockCount(): number {
    return this.contentStore.size;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TORRENT SWARM — Multi-peer content distribution
  // ═══════════════════════════════════════════════════════════════════

  private torrentSwarmInstance: import('./torrentSwarm.standalone').TorrentSwarm | null = null;
  private torrentSwarmUnsub: (() => void) | null = null;

  private startTorrentSwarm(): void {
    if (this.torrentSwarmInstance) return;
    try {
      // Lazy import to preserve standalone pattern
      import('./meshTorrentAdapter').then(({ createMeshTorrentAdapter }) => {
        import('./torrentSwarm.standalone').then(({ TorrentSwarm }) => {
          if (this.phase !== 'online') return;
          const adapter = createMeshTorrentAdapter(this, this.peerId);
          this.torrentSwarmInstance = new TorrentSwarm(adapter);
          this.torrentSwarmInstance.start();
          console.log('[SwarmMesh] 🌊 TorrentSwarm started — multi-peer content distribution active');

          // Wire Gun relay for secondary content delivery
          this.attachGunRelayToTorrent();

          // Auto re-seed legacy files that used larger chunk sizes
          this.autoReseedLegacyFiles();
        });
      });
    } catch (err) {
      console.warn('[SwarmMesh] Failed to start TorrentSwarm:', err);
    }
  }

  private attachGunRelayToTorrent(): void {
    if (!this.torrentSwarmInstance) return;
    import('./transports/gunAdapter').then(({ GunAdapter }) => {
      if (!this.torrentSwarmInstance) return;
      const gun = new GunAdapter({
        peers: ['https://gun-manhattan.herokuapp.com/gun'],
        graphKey: 'swarm-space/torrent',
      });
      gun.start({ peerId: this.peerId }).then(() => {
        if (!this.torrentSwarmInstance) return;
        this.torrentSwarmInstance.attachGunRelay(gun);
        console.log('[SwarmMesh] 🔗 Gun relay wired to TorrentSwarm');
      }).catch(err => {
        console.warn('[SwarmMesh] Gun relay attach failed:', err);
      });
    }).catch(err => {
      console.warn('[SwarmMesh] Failed to import GunAdapter for torrent relay:', err);
    });
  }

  private stopTorrentSwarm(): void {
    if (this.torrentSwarmInstance) {
      this.torrentSwarmInstance.stop();
      this.torrentSwarmInstance = null;
      console.log('[SwarmMesh] 🌊 TorrentSwarm stopped');
    }
  }

  getTorrentSwarm(): import('./torrentSwarm.standalone').TorrentSwarm | null {
    return this.torrentSwarmInstance;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DELETE / RESEED — Exposed to dashboard
  // ═══════════════════════════════════════════════════════════════════

  async deleteFile(fileId: string): Promise<void> {
    // Remove from TorrentSwarm in-memory state
    if (this.torrentSwarmInstance) {
      // Try to find manifest by fileId (torrent manifests use their own IDs)
      const allManifests = this.torrentSwarmInstance.getAllManifests();
      for (const m of allManifests) {
        if (m.id === fileId || m.name === fileId) {
          this.torrentSwarmInstance.remove(m.id);
        }
      }
    }

    // Remove file prefs
    const prefs = this.loadFilePrefs();
    delete prefs[fileId];
    this._filePrefs = prefs;
    this.saveFilePrefs();

    // Cancel any pending asset retries
    const retryTimer = this.assetRetryTimers.get(fileId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.assetRetryTimers.delete(fileId);
      this.assetRetryAttempts.delete(fileId);
    }

    // Delete from IndexedDB (manifest + chunks)
    try {
      const { deleteManifest } = await import('../fileEncryption');
      await deleteManifest(fileId);
      console.log(`[SwarmMesh] 🗑️ Deleted file ${fileId} from IndexedDB`);
    } catch (err) {
      console.warn('[SwarmMesh] Failed to delete file from IndexedDB:', err);
    }
  }

  async reseedFile(fileId: string): Promise<void> {
    if (!this.torrentSwarmInstance) {
      console.warn('[SwarmMesh] Cannot reseed — TorrentSwarm not running');
      return;
    }
    const allManifests = this.torrentSwarmInstance.getAllManifests();
    for (const m of allManifests) {
      if (m.id === fileId || m.name === fileId) {
        const result = await this.torrentSwarmInstance.reseed(m.id);
        if (result) {
          this.emitAlert(`Re-seeded "${m.name}" with ${result.totalChunks} chunks`, 'info');
        }
        return;
      }
    }
    console.warn(`[SwarmMesh] File "${fileId}" not found in TorrentSwarm for reseed`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO RE-SEED — Migrate legacy files to 1 MiB chunk standard
  // ═══════════════════════════════════════════════════════════════════

  private autoReseedLegacyFiles(): void {
    if (!this.torrentSwarmInstance) return;
    const ts = this.torrentSwarmInstance;
    const allManifests = ts.getAllManifests();
    if (allManifests.length === 0) return;

    console.log(`[SwarmMesh] 🔄 Checking ${allManifests.length} file(s) for legacy chunk migration…`);

    let reseedQueue: Array<{ id: string; name: string; currentChunks: number; expectedChunks: number }> = [];

    for (const m of allManifests) {
      const size = (m as unknown as Record<string, unknown>).size as number | undefined;
      if (!size || size <= 0) continue;
      const expectedChunks = Math.max(1, Math.ceil(size / 1_048_576));
      if (m.totalChunks !== expectedChunks) {
        reseedQueue.push({
          id: m.id,
          name: m.name,
          currentChunks: m.totalChunks,
          expectedChunks,
        });
      }
    }

    if (reseedQueue.length === 0) {
      console.log('[SwarmMesh] ✅ All files already use 1 MiB chunk standard');
      return;
    }

    console.log(`[SwarmMesh] 🔄 Auto re-seeding ${reseedQueue.length} legacy file(s)…`);

    // Process sequentially with delays to avoid UI freezing
    const processNext = async (index: number) => {
      if (index >= reseedQueue.length || !this.torrentSwarmInstance) return;
      const item = reseedQueue[index];
      try {
        const result = await this.torrentSwarmInstance.reseed(item.id);
        if (result) {
          console.log(`[SwarmMesh] ✅ Re-seeded "${item.name}": ${item.currentChunks} → ${result.totalChunks} chunks`);
          this.emitAlert(`Auto re-seeded "${item.name}" (${item.currentChunks}→${result.totalChunks} chunks)`, 'info');
        }
      } catch (err) {
        console.warn(`[SwarmMesh] ⚠️ Failed to re-seed "${item.name}":`, err);
      }
      // Small delay between files to keep UI responsive
      setTimeout(() => processNext(index + 1), 500);
    };

    // Start after a 2s delay to let the TorrentSwarm fully initialize
    setTimeout(() => processNext(0), 2000);
  }



  addTransaction(actionType: string, _target: string, meta: Record<string, unknown>): string {
    const txId = `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[SwarmMesh] ⛓️ TX: ${actionType} (${txId})`);
    this.broadcastInternal({ type: 'blockchain-tx', txId, actionType, meta });
    return txId;
  }

  async send(channel: string, peerId: string, payload: unknown): Promise<boolean> {
    const conn = this.connections.get(peerId);
    if (!conn) return false;
    try {
      conn.send(JSON.stringify({ type: `channel:${channel}`, payload, from: this.peerId }));
      return true;
    } catch { return false; }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const peerId of this.getConnectedPeerIds()) {
      void this.send(channel, peerId, payload);
    }
  }

  private channelHandlers = new Map<string, Set<(peerId: string, payload: unknown) => void>>();

  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void {
    if (!this.channelHandlers.has(channel)) this.channelHandlers.set(channel, new Set());
    this.channelHandlers.get(channel)!.add(handler);
    return () => { this.channelHandlers.get(channel)?.delete(handler); };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INDEXEDDB BRIDGE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Broadcast attachment manifest metadata so peers can request chunks on-demand.
   */
  private async broadcastFileDataForPost(manifestIds: string[]): Promise<void> {
    try {
      const db = await this.openDB();
      for (const fileId of manifestIds) {
        if (!db.objectStoreNames.contains('manifests')) continue;
        const manifest = await new Promise<Record<string, unknown> | null>(resolve => {
          const tx = db.transaction('manifests', 'readonly');
          const req = tx.objectStore('manifests').get(fileId);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        });
        if (!manifest) continue;

        // Broadcast manifest only; peers pull chunks individually to avoid large payload failures.
        this.broadcastInternal({
          type: 'file-manifest',
          manifest,
          fileId,
        });
        console.log(`[SwarmMesh] 📎 Broadcast file manifest ${fileId}`);
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] Failed to broadcast file manifest:', err);
    }
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('imagination-db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async loadPostsFromDB(): Promise<void> {
    try {
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) { db.close(); return; }
      const tx = db.transaction('posts', 'readonly');
      const req = tx.objectStore('posts').getAll();
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const posts = req.result as Array<{ id: string; author?: string; createdAt?: string; [key: string]: unknown }>;
          let n = 0;
          for (const post of posts) {
            if (!post.id || this.contentStore.has(post.id)) continue;
            this.contentStore.set(post.id, {
              id: post.id, type: 'post', data: post,
              author: post.author ?? 'unknown',
              timestamp: post.createdAt ? new Date(post.createdAt).getTime() : Date.now(),
              hash: `${post.id}-${post.createdAt ?? Date.now()}`,
            });
            n++;
          }
          console.log(`[SwarmMesh] 📂 Loaded ${n} posts from IndexedDB`);
          this.emitContentChange();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] DB load error:', err);
    }
  }

  private async writePostToDB(postData: Record<string, unknown>, sourcePeerId?: string): Promise<void> {
    try {
      if (!postData.id) return;

      const manifestIds = Array.isArray(postData.manifestIds)
        ? postData.manifestIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (manifestIds.length > 0) {
        void this.ensurePostAssets(manifestIds, sourcePeerId);
      }

      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) { db.close(); return; }
      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');
      const existing = await new Promise<unknown>(resolve => {
        const req = store.get(postData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      const existingRecord = (existing ?? null) as Record<string, unknown> | null;
      const incomingTs = Date.parse(String(postData.editedAt ?? postData.createdAt ?? '')) || 0;
      const existingTs = existingRecord
        ? Date.parse(String(existingRecord.editedAt ?? existingRecord.createdAt ?? '')) || 0
        : 0;
      const changed = !existingRecord || JSON.stringify(existingRecord) !== JSON.stringify(postData);

      if (changed && (incomingTs >= existingTs || !existingRecord)) {
        store.put(postData);
        console.log(`[SwarmMesh] 💾 Upserted post ${postData.id} in IndexedDB`);
        window.dispatchEvent(new Event('p2p-posts-updated'));

        // If this post carries stream metadata, notify the streaming layer
        // so peers can hydrate the room and show Join controls
        const streamMeta = postData.stream as Record<string, unknown> | undefined;
        if (streamMeta && typeof streamMeta === 'object' && streamMeta.roomId) {
          window.dispatchEvent(new CustomEvent('p2p-stream-post-received', { detail: postData }));
        }
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] DB write error:', err);
    }
  }

  private async writeCommentToDB(commentData: Record<string, unknown>): Promise<void> {
    try {
      if (!commentData.id) return;
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('comments')) { db.close(); return; }
      const tx = db.transaction('comments', 'readwrite');
      const store = tx.objectStore('comments');
      const existing = await new Promise<unknown>(resolve => {
        const req = store.get(commentData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!existing) {
        store.put(commentData);
        console.log(`[SwarmMesh] 💾 Saved comment ${commentData.id} to IndexedDB`);
        window.dispatchEvent(new Event('p2p-comments-updated'));
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] Comment DB write error:', err);
    }
  }

  private clearPendingAssetRequests(): void {
    for (const pending of this.pendingAssetRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(null);
    }
    this.pendingAssetRequests.clear();
  }

  private clearAssetRetry(manifestId: string): void {
    const timer = this.assetRetryTimers.get(manifestId);
    if (timer) {
      clearTimeout(timer);
      this.assetRetryTimers.delete(manifestId);
    }
    this.assetRetryAttempts.delete(manifestId);
  }

  private clearAssetRetryTimers(): void {
    for (const timer of this.assetRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.assetRetryTimers.clear();
    this.assetRetryAttempts.clear();
  }

  private scheduleAssetRetry(manifestId: string, sourcePeerId?: string): void {
    if (this.assetRetryTimers.has(manifestId)) {
      return;
    }

    const attempt = (this.assetRetryAttempts.get(manifestId) ?? 0) + 1;
    if (attempt > ASSET_RETRY_MAX_ATTEMPTS) {
      console.warn(`[SwarmMesh] ⚠️ Exhausted asset retries for ${manifestId}`);
      this.assetRetryAttempts.delete(manifestId);
      return;
    }

    this.assetRetryAttempts.set(manifestId, attempt);
    const timer = setTimeout(() => {
      this.assetRetryTimers.delete(manifestId);
      void this.ensurePostAssets([manifestId], sourcePeerId);
    }, ASSET_RETRY_INTERVAL_MS);
    this.assetRetryTimers.set(manifestId, timer);
  }

  private createAssetRequestId(): string {
    return `asset-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getAssetCandidatePeers(sourcePeerId?: string): string[] {
    const ordered: string[] = [];
    if (sourcePeerId && this.connections.has(sourcePeerId)) {
      ordered.push(sourcePeerId);
    }
    for (const peerId of this.connections.keys()) {
      if (!ordered.includes(peerId)) {
        ordered.push(peerId);
      }
    }
    return ordered;
  }

  private async sendAssetRequest(
    peerId: string,
    payload: Record<string, unknown>,
    expectedType: PendingAssetRequest['expectedType']
  ): Promise<Record<string, unknown> | null> {
    const conn = this.connections.get(peerId);
    if (!conn || conn.open !== true) {
      return null;
    }

    const requestId = this.createAssetRequestId();
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pendingAssetRequests.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingAssetRequests.delete(requestId);
        pending.resolve(null);
      }, ASSET_REQUEST_TIMEOUT_MS);

      this.pendingAssetRequests.set(requestId, {
        resolve,
        timeoutId,
        expectedType,
      });

      try {
        conn.send(JSON.stringify({
          ...payload,
          requestId,
          from: this.peerId,
        }));
      } catch {
        clearTimeout(timeoutId);
        this.pendingAssetRequests.delete(requestId);
        resolve(null);
      }
    });
  }

  private resolveAssetRequest(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : null;
    const type = typeof message.type === 'string' ? message.type : null;
    if (!requestId || !type) {
      return;
    }

    const pending = this.pendingAssetRequests.get(requestId);
    if (!pending || pending.expectedType !== type) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingAssetRequests.delete(requestId);
    pending.resolve(message);
  }

  private async getManifestFromDB(fileId: string): Promise<StoredManifestLike | null> {
    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('manifests')) {
        return null;
      }
      return await new Promise<StoredManifestLike | null>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').get(fileId);
        req.onsuccess = () => resolve((req.result as StoredManifestLike | null) ?? null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }

  private async saveManifestToDB(manifest: StoredManifestLike): Promise<boolean> {
    const fileId = typeof manifest.fileId === 'string' ? manifest.fileId : null;
    if (!fileId) {
      return false;
    }

    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('manifests')) {
        return false;
      }

      const existing = await new Promise<StoredManifestLike | null>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').get(fileId);
        req.onsuccess = () => resolve((req.result as StoredManifestLike | null) ?? null);
        req.onerror = () => resolve(null);
      });

      const shouldWrite = !existing || (!existing.fileKey && Boolean(manifest.fileKey));
      if (!shouldWrite) {
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('manifests', 'readwrite');
        tx.objectStore('manifests').put(manifest);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  }

  private async getChunkFromDB(chunkRef: string): Promise<StoredChunkLike | null> {
    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('chunks')) {
        return null;
      }
      return await new Promise<StoredChunkLike | null>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').get(chunkRef);
        req.onsuccess = () => resolve((req.result as StoredChunkLike | null) ?? null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }

  private async saveChunkToDB(chunk: StoredChunkLike): Promise<boolean> {
    const chunkRef = typeof chunk.ref === 'string' ? chunk.ref : null;
    if (!chunkRef) {
      return false;
    }

    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('chunks')) {
        return false;
      }

      const existing = await new Promise<StoredChunkLike | null>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').get(chunkRef);
        req.onsuccess = () => resolve((req.result as StoredChunkLike | null) ?? null);
        req.onerror = () => resolve(null);
      });

      if (existing) {
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').put(chunk);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  }

  private async requestManifestFromPeers(manifestId: string, sourcePeerId?: string): Promise<StoredManifestLike | null> {
    const candidates = this.getAssetCandidatePeers(sourcePeerId);
    for (const peerId of candidates) {
      const response = await this.sendAssetRequest(
        peerId,
        { type: 'manifest-request', manifestId },
        'manifest-response',
      );

      if (!response || response.found !== true) {
        continue;
      }

      const manifest = response.manifest as StoredManifestLike | undefined;
      if (manifest && typeof manifest.fileId === 'string') {
        return manifest;
      }
    }

    return null;
  }

  private async requestChunkFromPeers(chunkRef: string, sourcePeerId?: string): Promise<StoredChunkLike | null> {
    const candidates = this.getAssetCandidatePeers(sourcePeerId);
    for (const peerId of candidates) {
      const response = await this.sendAssetRequest(
        peerId,
        { type: 'chunk-request', chunkRef },
        'chunk-response',
      );

      if (!response || response.found !== true) {
        continue;
      }

      const chunk = response.chunk as StoredChunkLike | undefined;
      if (chunk && typeof chunk.ref === 'string') {
        return chunk;
      }
    }

    return null;
  }

  private async ensureManifestAndChunks(
    manifestId: string,
    sourcePeerId?: string
  ): Promise<{ changed: boolean; complete: boolean }> {
    // Respect user file preferences
    if (this.isFileBlocked(manifestId)) {
      return { changed: false, complete: false };
    }

    let changed = false;
    let manifest = await this.getManifestFromDB(manifestId);
    let complete = true;

    if (!manifest) {
      const fetchedManifest = await this.requestManifestFromPeers(manifestId, sourcePeerId);
      if (!fetchedManifest) {
        return { changed: false, complete: false };
      }

      manifest = fetchedManifest;
      changed = (await this.saveManifestToDB(fetchedManifest)) || changed;
      console.log(`[SwarmMesh] 📎 Pulled missing manifest ${manifestId}`);
      this._assetSyncCounters.manifestsPulled++;
    }

    const chunkRefs = Array.isArray(manifest.chunks)
      ? manifest.chunks.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
      : [];

    for (const chunkRef of chunkRefs) {
      const existingChunk = await this.getChunkFromDB(chunkRef);
      if (existingChunk) {
        continue;
      }

      const fetchedChunk = await this.requestChunkFromPeers(chunkRef, sourcePeerId);
      if (!fetchedChunk) {
        complete = false;
        continue;
      }

      const saved = await this.saveChunkToDB(fetchedChunk);
      changed = saved || changed;
      if (saved) {
        console.log(`[SwarmMesh] 📦 Pulled missing chunk ${chunkRef}`);
        this._assetSyncCounters.chunksPulled++;
        // Emit incremental progress every few chunks
        if (this._assetSyncCounters.chunksPulled % 3 === 0) {
          void this.emitTransferProgress(manifestId);
        }
      }
    }

    return { changed, complete };
  }

  private async ensurePostAssets(manifestIds: string[], sourcePeerId?: string): Promise<void> {
    let changed = false;

    // Sort by priority: starred first, then smallest size first
    const prioritized = await this.prioritizeManifests(manifestIds);

    for (const manifestId of prioritized) {
      const result = await this.ensureManifestAndChunks(manifestId, sourcePeerId);
      changed = result.changed || changed;

      if (result.complete) {
        this.clearAssetRetry(manifestId);
        this.announceSeeding(manifestId);
      } else {
        this.scheduleAssetRetry(manifestId, sourcePeerId);
      }

      // Dispatch progress event for UI
      this.emitTransferProgress(manifestId);
    }

    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('p2p-posts-updated'));
    }
  }

  /**
   * Sort manifest IDs by priority:
   *   1. Host-first starred item (only one allowed)
   *   2. Smallest file size first
   */
  private async prioritizeManifests(manifestIds: string[]): Promise<string[]> {
    if (manifestIds.length <= 1) return manifestIds;

    const entries: { id: string; starred: boolean; size: number }[] = [];
    for (const id of manifestIds) {
      const pref = this.getFilePref(id);
      let size = Infinity;
      try {
        const manifest = await this.getManifestFromDB(id);
        if (manifest && typeof (manifest as Record<string, unknown>).size === 'number') {
          size = (manifest as Record<string, unknown>).size as number;
        }
      } catch { /* noop */ }
      entries.push({ id, starred: pref.hostFirst, size });
    }

    entries.sort((a, b) => {
      // Starred items always first
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      // Then smaller files first
      return a.size - b.size;
    });

    return entries.map(e => e.id);
  }

  /**
   * Once a file is fully downloaded, announce to all peers
   * that we can now seed it — enabling auto-seeding.
   */
  private announceSeeding(manifestId: string): void {
    this.broadcastInternal({
      type: 'seeding-available',
      manifestId,
      peerId: this.peerId,
    });
  }

  /**
   * Emit a content-transfer-progress event for UI components (e.g. stream cards).
   */
  private async emitTransferProgress(manifestId: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const manifest = await this.getManifestFromDB(manifestId);
      if (!manifest) return;
      const chunkRefs = Array.isArray(manifest.chunks)
        ? manifest.chunks.filter((r): r is string => typeof r === 'string')
        : [];
      const total = chunkRefs.length;
      if (total === 0) return;

      let received = 0;
      const db = await this.openDB();
      if (db.objectStoreNames.contains('chunks')) {
        const existingKeys = await new Promise<Set<string>>((resolve) => {
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            const s = new Set<string>();
            for (const k of (req.result ?? [])) {
              if (typeof k === 'string') s.add(k);
            }
            resolve(s);
          };
          req.onerror = () => resolve(new Set());
        });
        received = chunkRefs.filter(r => existingKeys.has(r)).length;
      }
      db.close();

      const mRec = manifest as Record<string, unknown>;
      window.dispatchEvent(new CustomEvent('content-transfer-progress', {
        detail: {
          manifestId,
          fileName: (mRec.originalName as string) ?? manifestId.slice(0, 12),
          mime: (mRec.mime as string) ?? 'unknown',
          totalChunks: total,
          receivedChunks: received,
          percent: Math.round((received / total) * 100),
          size: typeof mRec.size === 'number' ? mRec.size : 0,
          complete: received >= total,
        },
      }));
    } catch { /* noop */ }
  }

  private async handleFileManifest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const incomingManifest = msg.manifest as StoredManifestLike | undefined;
    const fileIdFromMessage = typeof msg.fileId === 'string' ? msg.fileId : null;
    const manifestFileId = typeof incomingManifest?.fileId === 'string' ? incomingManifest.fileId : null;
    const fileId = fileIdFromMessage ?? manifestFileId;

    if (!incomingManifest || !fileId) {
      return;
    }

    const normalizedManifest: StoredManifestLike = {
      ...incomingManifest,
      fileId,
    };
    const saved = await this.saveManifestToDB(normalizedManifest);
    if (saved) {
      console.log(`[SwarmMesh] 📎 Received manifest ${fileId} from ${fromPeerId}`);
    }

    void this.ensurePostAssets([fileId], fromPeerId);
  }

  private async handleManifestRequest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
    const manifestId = typeof msg.manifestId === 'string' ? msg.manifestId : null;
    if (!requestId || !manifestId) {
      return;
    }

    const manifest = await this.getManifestFromDB(manifestId);
    const conn = this.connections.get(fromPeerId);
    if (!conn) {
      return;
    }

    try {
      conn.send(JSON.stringify({
        type: 'manifest-response',
        requestId,
        manifestId,
        found: Boolean(manifest),
        manifest: manifest ?? undefined,
        from: this.peerId,
      }));
    } catch {
      // noop
    }
  }

  private async handleChunkRequest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
    const chunkRef = typeof msg.chunkRef === 'string' ? msg.chunkRef : null;
    if (!requestId || !chunkRef) {
      return;
    }

    const chunk = await this.getChunkFromDB(chunkRef);
    const conn = this.connections.get(fromPeerId);
    if (!conn) {
      return;
    }

    try {
      const found = Boolean(chunk);
      conn.send(JSON.stringify({
        type: 'chunk-response',
        requestId,
        chunkRef,
        found,
        chunk: chunk ?? undefined,
        from: this.peerId,
      }));
      if (found) this._assetSyncCounters.chunksServed++;
    } catch {
      // noop
    }
  }

  /**
   * Handle a peer announcing they finished downloading a file and can now seed it.
   * We can request missing chunks from them.
   */
  private handleSeedingAvailable(fromPeerId: string, msg: Record<string, unknown>): void {
    const manifestId = typeof msg.manifestId === 'string' ? msg.manifestId : null;
    if (!manifestId) return;
    if (this.isFileBlocked(manifestId)) return;

    // If we have an incomplete copy, try to pull from this new seeder
    void this.ensureManifestAndChunks(manifestId, fromPeerId).then(({ complete, changed }) => {
      if (complete) this.clearAssetRetry(manifestId);
      if (changed && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
    });
  }

  /**
   * Handle incoming file data (manifest + chunks) from a peer.
   */
  private async handleFileData(msg: Record<string, unknown>): Promise<void> {
    try {
      const manifest = msg.manifest as Record<string, unknown> | undefined;
      const chunks = msg.chunks as Record<string, unknown>[] | undefined;
      const fileId = msg.fileId as string | undefined;
      if (!manifest || !fileId) return;

      const db = await this.openDB();

      // Write manifest to IndexedDB
      if (db.objectStoreNames.contains('manifests')) {
        const existing = await new Promise<unknown>(resolve => {
          const tx = db.transaction('manifests', 'readonly');
          const req = tx.objectStore('manifests').get(fileId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });

        // Only write if manifest doesn't exist or existing one lacks fileKey
        const existingManifest = existing as Record<string, unknown> | null;
        if (!existingManifest || !existingManifest.fileKey) {
          const tx = db.transaction('manifests', 'readwrite');
          tx.objectStore('manifests').put(manifest);
          console.log(`[SwarmMesh] 📎 Saved manifest ${fileId}`);
        }
      }

      // Write chunks to IndexedDB
      if (Array.isArray(chunks) && chunks.length > 0 && db.objectStoreNames.contains('chunks')) {
        const tx = db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        for (const chunk of chunks) {
          if (chunk.ref) {
            store.put(chunk);
          }
        }
        console.log(`[SwarmMesh] 📎 Saved ${chunks.length} chunks for ${fileId}`);
      }

      db.close();

      // Notify UI to re-attempt loading attachments
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
    } catch (err) {
      console.warn('[SwarmMesh] File data handling error:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneSwarmMesh | null = null;

export function getSwarmMeshStandalone(): StandaloneSwarmMesh {
  if (!_instance) _instance = new StandaloneSwarmMesh();
  return _instance;
}

export function destroySwarmMeshStandalone(): void {
  _instance?.stop();
  _instance = null;
}
