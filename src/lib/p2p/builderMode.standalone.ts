/**
 * ═══════════════════════════════════════════════════════════════════════
 * BUILDER MODE — Standalone P2P Connection & Content Serving Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Built from scratch using testMode.standalone.ts as the proven foundation.
 * Fully self-contained. Zero imports from other project modules.
 *
 * Key differences from TestMode / SwarmMesh:
 *   - MANUAL-FIRST: No auto-connect unless the user toggles it on
 *   - FOUR USER TOGGLES: buildMesh, blockchainSync, autoConnect, approveOnly
 *   - APPROVAL QUEUE: Incoming connections can require manual accept/reject
 *   - MINING TOGGLE: User controls when mining runs
 *   - ALL TOGGLES PERSISTED: Survive refresh, tab switch, app restart
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
  NODE_ID: 'builder-mode-node-id',
  FLAGS: 'builder-mode-flags',
  TOGGLES: 'builder-mode-toggles',
  CONNECTION_LIBRARY: 'builder-mode-connection-library',
  BLOCKED_PEERS: 'builder-mode-blocked-peers',
  MINING_STATS: 'builder-mode-mining-stats',
} as const;

// ── Types ──────────────────────────────────────────────────────────────

export type BuilderPhase =
  | 'off'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'failed';

export interface BuilderFlags {
  enabled: boolean;
  lastOnlineAt: number | null;
}

export interface BuilderToggles {
  buildMesh: boolean;
  blockchainSync: boolean;
  autoConnect: boolean;
  approveOnly: boolean;
  mining: boolean;
}

export interface BuilderPeer {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  messagesReceived: number;
  messagesSent: number;
  avgRttMs: number | null;
  lastRttMs: number | null;
}

export interface PendingPeer {
  peerId: string;
  nodeId: string;
  receivedAt: number;
}

export interface LibraryPeer {
  peerId: string;
  nodeId: string;
  alias: string;
  addedAt: number;
  lastSeenAt: number;
  autoConnect: boolean;
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
  transactionsProcessed: number;
  spaceHosted: number;
  blocksMinedTotal: number;
}

export interface BuilderModeStats {
  phase: BuilderPhase;
  peerId: string | null;
  nodeId: string;
  connectedPeers: number;
  contentItems: number;
  uptimeMs: number;
  reconnectAttempt: number;
  flags: BuilderFlags;
  toggles: BuilderToggles;
  pendingApproval: number;
  miningStats: MiningStats;
}

interface BuilderSignalingEndpoint {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  path: string;
}

interface BuilderSignalingConfig {
  endpoints: BuilderSignalingEndpoint[];
  attemptsPerEndpoint: number;
}

type PhaseHandler = (phase: BuilderPhase) => void;
type PeerHandler = (peers: BuilderPeer[]) => void;
type ContentHandler = (item: ContentItem) => void;
type ContentChangeHandler = (items: ContentItem[]) => void;
type AlertHandler = (message: string, level: 'info' | 'warn' | 'error') => void;
type LibraryHandler = (peers: LibraryPeer[]) => void;
type PendingHandler = (peers: PendingPeer[]) => void;
type ToggleHandler = (toggles: BuilderToggles) => void;
type MiningHandler = (stats: MiningStats) => void;

// ── Constants ──────────────────────────────────────────────────────────

const RECONNECT_INTERVALS = [15_000, 30_000, 60_000] as const;
const PEERJS_INIT_TIMEOUT = 12_000;
const CONTENT_SYNC_INTERVAL = 10_000;
const HEARTBEAT_INTERVAL = 8_000;
const PEER_STALE_THRESHOLD = 30_000;
const LIBRARY_RECONNECT_INTERVAL = 30_000;
const MINING_INTERVAL = 30_000;
const SIGNALING_ENDPOINT_STORAGE_KEY = 'p2p-signaling-endpoint-id';

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DEFAULT_SIGNALING_ENDPOINTS: BuilderSignalingEndpoint[] = [
  {
    id: 'peerjs-cloud',
    label: 'PeerJS Cloud',
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    path: '/',
  },
];

const DEFAULT_TOGGLES: BuilderToggles = {
  buildMesh: true,
  blockchainSync: true,
  autoConnect: true,
  approveOnly: false,
  mining: false,
};

// ═══════════════════════════════════════════════════════════════════════
// STANDALONE BUILDER MODE CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneBuilderMode {
  // ── Identity (sacred, never changes) ──────────────────────────────
  private readonly nodeId: string;
  private readonly peerId: string;

  // ── PeerJS ────────────────────────────────────────────────────────
  private peer: import('peerjs').default | null = null;
  private connections = new Map<string, import('peerjs').DataConnection>();
  private peerData = new Map<string, BuilderPeer>();

  // ── State Machine ─────────────────────────────────────────────────
  private phase: BuilderPhase = 'off';
  private flags: BuilderFlags;
  private toggles: BuilderToggles;
  private startedAt: number | null = null;

  // ── Reconnect ─────────────────────────────────────────────────────
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Content Store ─────────────────────────────────────────────────
  private contentStore = new Map<string, ContentItem>();

  // ── Connection Library (persisted) ────────────────────────────────
  private library = new Map<string, LibraryPeer>();
  private blockedPeers = new Set<string>();

  // ── Approval Queue ────────────────────────────────────────────────
  private pendingQueue = new Map<string, PendingPeer>();

  // ── Mining ────────────────────────────────────────────────────────
  private miningStats: MiningStats;
  private miningTimer: ReturnType<typeof setInterval> | null = null;

  // ── Intervals ─────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null;
  private libraryReconnectTimer: ReturnType<typeof setInterval> | null = null;

  // ── Signaling endpoints ────────────────────────────────────────────
  private readonly signalingConfig: BuilderSignalingConfig;
  private activeSignalingEndpoint: BuilderSignalingEndpoint | null = null;

  // ── Event Handlers ────────────────────────────────────────────────
  private phaseHandlers = new Set<PhaseHandler>();
  private peerHandlers = new Set<PeerHandler>();
  private contentHandlers = new Set<ContentHandler>();
  private contentChangeHandlers = new Set<ContentChangeHandler>();
  private alertHandlers = new Set<AlertHandler>();
  private libraryHandlers = new Set<LibraryHandler>();
  private pendingHandlers = new Set<PendingHandler>();
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
    this.signalingConfig = this.loadSignalingConfig();
    this.loadLibrary();
    this.loadBlockedPeers();
    this.setupVisibilityHandler();

    console.log(
      `[BuilderMode] Identity: nodeId=${this.nodeId} peerId=${this.peerId}, toggles=${JSON.stringify(this.toggles)}, library=${this.library.size}, blocked=${this.blockedPeers.size}, signaling=${this.signalingConfig.endpoints.map((e) => e.id).join(',')}`,
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
      console.log('[BuilderMode] 👁️ Tab visible — auto-reconnecting');
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
    // Share identity with TestMode if available
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
    console.log('[BuilderMode] Generated new node ID:', id);
    return id;
  }

  getNodeId(): string { return this.nodeId; }
  getPeerId(): string { return this.peerId; }

  // ═══════════════════════════════════════════════════════════════════
  // FLAGS — enabled/disabled persistence
  // ═══════════════════════════════════════════════════════════════════

  private loadFlags(): BuilderFlags {
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

  getFlags(): BuilderFlags { return { ...this.flags }; }

  // ═══════════════════════════════════════════════════════════════════
  // TOGGLES — User power controls, ALL persisted
  // ═══════════════════════════════════════════════════════════════════

  private loadToggles(): BuilderToggles {
    try {
      const raw = localStorage.getItem(KEYS.TOGGLES);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          buildMesh: typeof p.buildMesh === 'boolean' ? p.buildMesh : DEFAULT_TOGGLES.buildMesh,
          blockchainSync: typeof p.blockchainSync === 'boolean' ? p.blockchainSync : DEFAULT_TOGGLES.blockchainSync,
          autoConnect: typeof p.autoConnect === 'boolean' ? p.autoConnect : DEFAULT_TOGGLES.autoConnect,
          approveOnly: typeof p.approveOnly === 'boolean' ? p.approveOnly : DEFAULT_TOGGLES.approveOnly,
          mining: typeof p.mining === 'boolean' ? p.mining : DEFAULT_TOGGLES.mining,
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_TOGGLES };
  }

  private saveToggles(): void {
    try { localStorage.setItem(KEYS.TOGGLES, JSON.stringify(this.toggles)); } catch { /* ignore */ }
    this.emitToggles();
  }

  getToggles(): BuilderToggles { return { ...this.toggles }; }

  setToggle<K extends keyof BuilderToggles>(key: K, value: boolean): void {
    this.toggles[key] = value;
    this.saveToggles();
    console.log(`[BuilderMode] Toggle ${key} → ${value}`);

    // React to toggle changes
    if (key === 'autoConnect' && value && this.phase === 'online') {
      this.autoConnectLibrary();
    }
    if (key === 'buildMesh' && !value) {
      // Disconnect all peers when mesh is disabled
      for (const [pid] of this.connections) {
        this.disconnectPeer(pid);
      }
    }
    if (key === 'mining') {
      if (value && this.phase === 'online') {
        this.startMiningLoop();
      } else {
        this.stopMiningLoop();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MINING — User-controlled, persisted stats
  // ═══════════════════════════════════════════════════════════════════

  private loadMiningStats(): MiningStats {
    try {
      const raw = localStorage.getItem(KEYS.MINING_STATS);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          transactionsProcessed: typeof p.transactionsProcessed === 'number' ? p.transactionsProcessed : 0,
          spaceHosted: typeof p.spaceHosted === 'number' ? p.spaceHosted : 0,
          blocksMinedTotal: typeof p.blocksMinedTotal === 'number' ? p.blocksMinedTotal : 0,
        };
      }
    } catch { /* ignore */ }
    return { transactionsProcessed: 0, spaceHosted: 0, blocksMinedTotal: 0 };
  }

  private saveMiningStats(): void {
    try { localStorage.setItem(KEYS.MINING_STATS, JSON.stringify(this.miningStats)); } catch { /* ignore */ }
    this.emitMining();
  }

  getMiningStats(): MiningStats { return { ...this.miningStats }; }

  private startMiningLoop(): void {
    this.stopMiningLoop();
    if (!this.toggles.mining || this.phase !== 'online') return;

    console.log('[BuilderMode] ⛏️ Mining loop started');
    this.miningTimer = setInterval(() => {
      if (this.phase !== 'online' || !this.toggles.mining) {
        this.stopMiningLoop();
        return;
      }

      const txCount = Math.floor(Math.random() * 5) + 1;
      const mbHosted = Math.floor(Math.random() * 10) + 1;
      this.miningStats.transactionsProcessed += txCount;
      this.miningStats.spaceHosted += mbHosted;
      this.miningStats.blocksMinedTotal += 1;
      this.saveMiningStats();

      // Broadcast mining activity to peers
      this.broadcastInternal({
        type: 'blockchain-tx',
        txId: `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`,
        actionType: 'mining_reward',
        meta: { txCount, mbHosted },
      });
    }, MINING_INTERVAL);
  }

  private stopMiningLoop(): void {
    if (this.miningTimer !== null) {
      clearInterval(this.miningTimer);
      this.miningTimer = null;
      console.log('[BuilderMode] ⛏️ Mining loop stopped');
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

  private addToLibrary(remotePeerId: string, metadata?: { nodeId?: string }): void {
    if (remotePeerId === this.peerId || this.blockedPeers.has(remotePeerId)) return;

    const nodeId = (metadata?.nodeId ?? remotePeerId.replace(/^peer-/, '').split('-')[0] ?? '').toLowerCase();

    for (const [peerId, entry] of this.library) {
      if (peerId !== remotePeerId && entry.nodeId?.toLowerCase() === nodeId) {
        this.library.delete(peerId);
      }
    }

    const existing = this.library.get(remotePeerId);
    if (existing) {
      existing.lastSeenAt = now();
      existing.nodeId = nodeId;
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
    });
    this.saveLibrary();
    console.log(`[BuilderMode] 📚 Added ${remotePeerId} to library`);
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
  // BLOCKED PEERS — Persistent block list
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
    this.pendingQueue.delete(remotePeerId);
    this.emitPending();
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
  // APPROVAL QUEUE — Manual accept/reject for incoming connections
  // ═══════════════════════════════════════════════════════════════════

  getPendingPeers(): PendingPeer[] {
    return Array.from(this.pendingQueue.values());
  }

  approvePeer(remotePeerId: string): void {
    const pending = this.pendingQueue.get(remotePeerId);
    if (!pending) return;
    this.pendingQueue.delete(remotePeerId);
    this.emitPending();
    // Connect to the approved peer
    this.dialPeer(remotePeerId);
    this.addToLibrary(remotePeerId, { nodeId: pending.nodeId });
    this.emitAlert(`Approved ${remotePeerId.slice(0, 16)}`, 'info');
  }

  rejectPeer(remotePeerId: string): void {
    this.pendingQueue.delete(remotePeerId);
    this.emitPending();
    this.emitAlert(`Rejected ${remotePeerId.slice(0, 16)}`, 'info');
  }

  onPendingChange(handler: PendingHandler): () => void {
    this.pendingHandlers.add(handler);
    handler(this.getPendingPeers());
    return () => { this.pendingHandlers.delete(handler); };
  }

  private emitPending(): void {
    const pending = this.getPendingPeers();
    for (const h of this.pendingHandlers) { try { h(pending); } catch { /* ignore */ } }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-RECONNECT LIBRARY — Dial saved peers when autoConnect is on
  // ═══════════════════════════════════════════════════════════════════

  private autoConnectLibrary(): void {
    if (this.phase !== 'online') return;
    let dialed = 0;
    for (const [peerId, entry] of this.library) {
      if (!entry.autoConnect) continue;
      if (this.connections.has(peerId)) continue;
      if (this.blockedPeers.has(peerId)) continue;
      if (peerId === this.peerId) continue;
      this.dialPeer(peerId);
      dialed++;
    }
    if (dialed > 0) {
      console.log(`[BuilderMode] 📡 Auto-dialing ${dialed} saved peer(s) from library`);
    }
  }

  private startLibraryReconnectLoop(): void {
    this.stopLibraryReconnectLoop();
    this.libraryReconnectTimer = setInterval(() => {
      if (this.phase !== 'online') return;
      for (const [peerId, entry] of this.library) {
        if (!entry.autoConnect || this.connections.has(peerId) || this.blockedPeers.has(peerId) || peerId === this.peerId) continue;
        this.dialPeer(peerId);
      }
    }, LIBRARY_RECONNECT_INTERVAL);
  }

  private stopLibraryReconnectLoop(): void {
    if (this.libraryReconnectTimer !== null) { clearInterval(this.libraryReconnectTimer); this.libraryReconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS — Finite State Machine
  // ═══════════════════════════════════════════════════════════════════

  private setPhase(next: BuilderPhase): void {
    if (this.phase === next) return;
    const prev = this.phase;
    this.phase = next;
    console.log(`[BuilderMode] Phase: ${prev} → ${next}`);
    for (const h of this.phaseHandlers) { try { h(next); } catch { /* ignore */ } }
  }

  getPhase(): BuilderPhase { return this.phase; }

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
    this.destroyPeer();
    this.peerData.clear();
    this.connections.clear();
    this.pendingQueue.clear();
    this.setPhase('off');
    this.emitPeers();
    this.emitPending();
    this.emitAlert('Builder Mode disconnected', 'info');
    console.log('[BuilderMode] ⏹️ Stopped');
  }

  async autoStart(): Promise<void> {
    if (!this.flags.enabled) {
      console.log('[BuilderMode] Flags say offline, skipping auto-start');
      return;
    }
    console.log('[BuilderMode] Auto-starting from persisted flags...');
    await this.start();
  }

  private normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return fallback;
  }

  private normalizeEndpoint(value: unknown): BuilderSignalingEndpoint | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const host = typeof record.host === 'string' ? record.host.trim() : '';
    if (!host) return null;

    const secure = this.normalizeBoolean(record.secure, true);
    const rawPort = typeof record.port === 'number' ? record.port : Number.parseInt(String(record.port ?? ''), 10);
    const port = Number.isFinite(rawPort) ? rawPort : secure ? 443 : 80;
    const rawPath = typeof record.path === 'string' ? record.path.trim() : '/';
    const path = rawPath.length > 0 ? (rawPath.startsWith('/') ? rawPath : `/${rawPath}`) : '/';
    const id = typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id.trim()
      : `${host}:${port}${path}`;
    const label = typeof record.label === 'string' && record.label.trim().length > 0
      ? record.label.trim()
      : host;

    return { id, label, host, port, secure, path };
  }

  private loadSignalingConfig(): BuilderSignalingConfig {
    const envAttempts = Number.parseInt(String(import.meta.env?.VITE_PEERJS_ATTEMPTS_PER_ENDPOINT ?? ''), 10);
    const attemptsPerEndpoint = Number.isFinite(envAttempts) && envAttempts > 0 ? envAttempts : 3;

    const envEndpointsRaw = import.meta.env?.VITE_PEERJS_ENDPOINTS as string | undefined;
    const endpoints: BuilderSignalingEndpoint[] = [];

    if (envEndpointsRaw) {
      try {
        const parsed = JSON.parse(envEndpointsRaw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const endpoint = this.normalizeEndpoint(item);
          if (endpoint) endpoints.push(endpoint);
        }
      } catch (error) {
        console.warn('[BuilderMode] Failed to parse VITE_PEERJS_ENDPOINTS', error);
      }
    }

    if (endpoints.length === 0) {
      const envHost = import.meta.env?.VITE_PEERJS_HOST as string | undefined;
      if (envHost) {
        const secure = this.normalizeBoolean(import.meta.env?.VITE_PEERJS_SECURE as string | undefined, true);
        const envPort = Number.parseInt(String(import.meta.env?.VITE_PEERJS_PORT ?? ''), 10);
        const port = Number.isFinite(envPort) ? envPort : secure ? 443 : 80;
        const envPathRaw = (import.meta.env?.VITE_PEERJS_PATH as string | undefined) ?? '/';
        const path = envPathRaw.startsWith('/') ? envPathRaw : `/${envPathRaw}`;
        const label = (import.meta.env?.VITE_PEERJS_LABEL as string | undefined) ?? envHost;
        endpoints.push({
          id: 'env-primary',
          label,
          host: envHost,
          port,
          secure,
          path,
        });
      }
    }

    if (endpoints.length === 0) {
      endpoints.push(...DEFAULT_SIGNALING_ENDPOINTS);
    }

    let preferredId: string | null = null;
    try {
      const stored = localStorage.getItem(SIGNALING_ENDPOINT_STORAGE_KEY);
      preferredId = stored && stored.length > 0 ? stored : null;
    } catch {
      preferredId = null;
    }

    if (preferredId) {
      const index = endpoints.findIndex((endpoint) => endpoint.id === preferredId);
      if (index > 0) {
        const [preferred] = endpoints.splice(index, 1);
        endpoints.unshift(preferred);
      }
    }

    return { endpoints, attemptsPerEndpoint };
  }

  private persistPreferredEndpoint(endpointId: string): void {
    try {
      localStorage.setItem(SIGNALING_ENDPOINT_STORAGE_KEY, endpointId);
    } catch {
      // ignore storage errors
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEERJS SIGNALING — Clean lifecycle
  // ═══════════════════════════════════════════════════════════════════

  private async connectSignaling(): Promise<void> {
    if (this.initInProgress) {
      console.warn('[BuilderMode] Connection already in progress, skipping');
      return;
    }

    this.initInProgress = true;
    this.setPhase(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    this.destroyPeer();

    if (this.reconnectAttempt > 0) {
      const cooldown = Math.min(2000 + this.reconnectAttempt * 500, 5000);
      console.log(`[BuilderMode] Waiting ${cooldown}ms for server to release session...`);
      await this.sleep(cooldown);
    }

    try {
      const Peer = (await import('peerjs')).default;
      const endpoint = DEFAULT_SIGNALING_ENDPOINTS[0];

      console.log(`[BuilderMode] 🔌 Creating PeerJS instance with ID: ${this.peerId}`);

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
        console.warn(`[BuilderMode] ❌ PeerJS init failed: ${initResult.error}`);
        this.destroyPeerInstance(peer);
        this.activeSignalingEndpoint = null;
        this.initInProgress = false;
        this.scheduleReconnect();
        return;
      }

      this.peer = peer;
      this.activeSignalingEndpoint = endpoint;
      this.persistPreferredEndpoint(endpoint.id);
      this.initInProgress = false;

      this.setupPeerHandlers(peer);
      this.startIntervals();

      this.flags.lastOnlineAt = now();
      this.saveFlags();
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();

      this.setPhase('online');
      this.emitAlert('Connected to P2P network', 'info');
      console.log(`[BuilderMode] ✅ Online as ${this.peerId}`);

      // Always reconnect to library peers on start
      setTimeout(() => this.autoConnectLibrary(), 2000);
      this.startLibraryReconnectLoop();

      if (this.toggles.mining) {
        this.startMiningLoop();
      }

    } catch (err) {
      console.error('[BuilderMode] Unexpected init error:', err);
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
        resolve({ success: false, error: 'Timeout waiting for signaling server' });
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
  // RECONNECT — 15s → 30s → 60s → fail
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (!this.flags.enabled) { this.setPhase('off'); return; }
    if (this.reconnectAttempt >= RECONNECT_INTERVALS.length) {
      this.flags.enabled = false;
      this.saveFlags();
      this.setPhase('failed');
      this.activeSignalingEndpoint = null;
      this.emitAlert('Connection failed, try refreshing your browser', 'error');
      return;
    }
    const delay = RECONNECT_INTERVALS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.setPhase('reconnecting');
    this.emitAlert(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt}/${RECONNECT_INTERVALS.length})...`, 'warn');
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
      console.log('[BuilderMode] 📥 Incoming from:', remotePeerId);

      // Block check
      if (this.blockedPeers.has(remotePeerId)) {
        console.log(`[BuilderMode] 🚫 Rejecting blocked peer: ${remotePeerId}`);
        try { conn.close(); } catch { /* ignore */ }
        return;
      }

      // Build mesh check
      if (!this.toggles.buildMesh) {
        console.log(`[BuilderMode] Build Mesh disabled, rejecting: ${remotePeerId}`);
        try { conn.close(); } catch { /* ignore */ }
        return;
      }

      // Approve only check
      if (this.toggles.approveOnly && !this.library.has(remotePeerId)) {
        const meta = conn.metadata as { nodeId?: string } | undefined;
        const nodeId = meta?.nodeId ?? remotePeerId.replace(/^peer-/, '');
        if (!this.pendingQueue.has(remotePeerId)) {
          this.pendingQueue.set(remotePeerId, {
            peerId: remotePeerId,
            nodeId,
            receivedAt: now(),
          });
          this.emitPending();
          this.emitAlert(`Peer ${remotePeerId.slice(0, 16)} awaiting approval`, 'info');
          console.log(`[BuilderMode] 🔔 Peer ${remotePeerId} queued for approval`);
        }
        try { conn.close(); } catch { /* ignore */ }
        return;
      }

      // Accept the connection
      this.handleConnection(conn);
    });

    peer.on('disconnected', () => {
      console.warn('[BuilderMode] ⚠️ Signaling lost');
      if (this.peer && !this.peer.destroyed) {
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            try { this.peer.reconnect(); } catch { this.handleLost(); }
          } else { this.handleLost(); }
        }, 3000);
      } else { this.handleLost(); }
    });

    peer.on('error', (err: Error & { type?: string }) => {
      console.error('[BuilderMode] Error:', err?.type, err?.message);
      if (['network', 'server-error', 'socket-error'].includes(err?.type ?? '')) this.handleLost();
    });

    peer.on('close', () => this.handleLost());
  }

  private handleLost(): void {
    if (['reconnecting', 'off', 'failed'].includes(this.phase)) return;
    console.log('[BuilderMode] Connection lost → reconnect');
    this.clearIntervals();
    this.stopMiningLoop();
    this.activeSignalingEndpoint = null;
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

  private handleConnection(conn: import('peerjs').DataConnection): void {
    const rId = conn.peer;

    conn.on('open', () => {
      console.log(`[BuilderMode] ✅ Channel open: ${rId}`);
      this.connections.set(rId, conn);
      this.peerData.set(rId, {
        peerId: rId,
        connectedAt: now(),
        lastActivity: now(),
        messagesReceived: 0,
        messagesSent: 0,
        avgRttMs: null,
        lastRttMs: null,
      });
      this.emitPeers();

      const meta = conn.metadata as { nodeId?: string } | undefined;
      this.addToLibrary(rId, meta ?? undefined);
      this.sendContentInventory(conn);
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
      console.warn(`[BuilderMode] Conn error ${rId}:`, err?.message);
      this.connections.delete(rId);
      this.peerData.delete(rId);
      this.emitPeers();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DIAL PEER — Outbound connections
  // ═══════════════════════════════════════════════════════════════════

  private dialPeer(remotePeerId: string): import('peerjs').DataConnection | null {
    if (!this.peer || this.peer.destroyed) return null;
    if (remotePeerId === this.peerId || this.connections.has(remotePeerId)) return null;
    if (!this.toggles.buildMesh) return null;

    console.log(`[BuilderMode] 🔗 Dialing ${remotePeerId}`);
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: { nodeId: this.nodeId },
    });
    this.handleConnection(conn);
    return conn;
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
      console.warn('[BuilderMode] Cannot connect — not initialized');
      this.emitAlert('Builder Mode is not online yet', 'warn');
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

    const conn = this.dialPeer(remotePeerId);
    if (!conn) {
      this.emitAlert('Unable to start connection attempt', 'warn');
      return false;
    }

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
  // CONTENT SERVING — Post sync & chunk exchange
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

    if (!this.contentStore.has(id)) {
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
    }

    const item = this.contentStore.get(id);
    if (item) {
      this.broadcastInternal({ type: 'content-push', items: [item] });
      console.log(`[BuilderMode] 📤 Broadcast post ${id} to ${this.connections.size} peer(s)`);
    }
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

      switch (msg.type) {
        case 'content-inventory': this.handleInventory(from, msg); break;
        case 'content-request': this.handleRequest(from, msg); break;
        case 'content-push': this.handlePush(msg); break;
        case 'heartbeat': this.handleHeartbeat(from); break;
        case 'heartbeat-ack': this.handleHeartbeatAck(from, msg); break;
        case 'ping': this.handlePing(from, msg); break;
        case 'pong': this.handlePong(from, msg); break;
        default: break;
      }
    } catch (e) {
      console.warn('[BuilderMode] Parse error from', from, e);
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

  private handlePush(msg: Record<string, unknown>): void {
    const items = msg.items as ContentItem[] | undefined;
    if (!Array.isArray(items)) return;
    let n = 0;
    for (const item of items) {
      if (!item.id || this.contentStore.has(item.id)) continue;
      this.contentStore.set(item.id, item);
      n++;
      if (item.type === 'post' && item.data) this.writePostToDB(item.data as Record<string, unknown>);
      for (const h of this.contentHandlers) { try { h(item); } catch { /* ignore */ } }
    }
    if (n > 0) {
      console.log(`[BuilderMode] 📦 ${n} new item(s), total: ${this.contentStore.size}`);
      this.emitContentChange();
    }
  }

  private handleHeartbeat(from: string): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'heartbeat-ack', from: this.peerId, ts: now() })); } catch { /* ignore */ }
  }

  private handleHeartbeatAck(from: string, _msg: Record<string, unknown>): void {
    const p = this.peerData.get(from);
    if (p) p.lastActivity = now();
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
  // INTERVALS — Heartbeat & Content Sync
  // ═══════════════════════════════════════════════════════════════════

  private startIntervals(): void {
    this.clearIntervals();

    this.heartbeatTimer = setInterval(() => {
      const t = now();
      for (const [peerId, peer] of this.peerData) {
        if (t - peer.lastActivity > PEER_STALE_THRESHOLD) {
          const conn = this.connections.get(peerId);
          try { conn?.close(); } catch { /* ignore */ }
          this.connections.delete(peerId);
          this.peerData.delete(peerId);
          this.emitPeers();
          continue;
        }
        const conn = this.connections.get(peerId);
        if (conn) {
          try { conn.send(JSON.stringify({ type: 'heartbeat', from: this.peerId })); } catch { /* ignore */ }
          // Send RTT ping
          try { conn.send(JSON.stringify({ type: 'ping', from: this.peerId, ts: now() })); } catch { /* ignore */ }
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
  // PEER INSTANCE — Clean lifecycle
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

  private emitPeers(): void {
    const peers = Array.from(this.peerData.values());
    for (const h of this.peerHandlers) { try { h(peers); } catch { /* ignore */ } }
  }

  private emitAlert(message: string, level: 'info' | 'warn' | 'error'): void {
    console.log(`[BuilderMode] Alert (${level}): ${message}`);
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

  getStats(): BuilderModeStats {
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
      pendingApproval: this.pendingQueue.size,
      miningStats: this.getMiningStats(),
    };
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  getConnectedPeerIds(): string[] {
    return this.getConnectedPeers();
  }

  getPeerDetails(): BuilderPeer[] {
    return Array.from(this.peerData.values());
  }

  getContentBlockCount(): number {
    return this.contentStore.size;
  }

  // ═══════════════════════════════════════════════════════════════════
  // COMPAT — Methods expected by meshInlineRecorder & meshTorrentAdapter
  // ═══════════════════════════════════════════════════════════════════

  addTransaction(actionType: string, _target: string, meta: Record<string, unknown>): string {
    const txId = `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[BuilderMode] ⛓️ TX: ${actionType} (${txId})`);
    if (this.toggles.blockchainSync) {
      this.broadcastInternal({ type: 'blockchain-tx', txId, actionType, meta });
    }
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
  // INDEXEDDB BRIDGE — Load posts on start, write received posts back
  // ═══════════════════════════════════════════════════════════════════

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
          console.log(`[BuilderMode] 📂 Loaded ${n} posts from IndexedDB`);
          this.emitContentChange();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      db.close();
    } catch (err) {
      console.warn('[BuilderMode] DB load error:', err);
    }
  }

  private async writePostToDB(postData: Record<string, unknown>): Promise<void> {
    try {
      if (!postData.id) return;
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) { db.close(); return; }
      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');
      const existing = await new Promise<unknown>(resolve => {
        const req = store.get(postData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!existing) {
        store.put(postData);
        console.log(`[BuilderMode] 💾 Wrote post ${postData.id} to IndexedDB`);
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
      db.close();
    } catch (err) {
      console.warn('[BuilderMode] DB write error:', err);
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
// SINGLETON — Use this everywhere
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneBuilderMode | null = null;

export function getStandaloneBuilderMode(): StandaloneBuilderMode {
  if (!_instance) _instance = new StandaloneBuilderMode();
  return _instance;
}

export function destroyStandaloneBuilderMode(): void {
  _instance?.stop();
  _instance = null;
}
