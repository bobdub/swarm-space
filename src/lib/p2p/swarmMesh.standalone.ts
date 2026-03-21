/**
 * ═══════════════════════════════════════════════════════════════════════
 * SWARM MESH — Production P2P Connection & Content Serving Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Built from scratch using testMode.standalone.ts as the proven foundation.
 * Fully self-contained. Zero imports from other project modules.
 *
 * Key difference from TestMode:
 *   - AUTO-CONNECTS to a bootstrap peer list (no manual input needed)
 *   - Cascade: Bootstrap → Library → Manual fallback alert
 *   - Library Exchange: connected peers share their contact lists
 *   - Connection source notification: "Connected via bootstrap/library/manual"
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
  CONNECTION_LIBRARY: 'swarm-mesh-connection-library',
  BLOCKED_PEERS: 'swarm-mesh-blocked-peers',
} as const;

// ── Bootstrap Peer List ────────────────────────────────────────────────
// Known dev/seed nodes. New devs get added here.
// The mesh grows organically via library exchange.

const BOOTSTRAP_PEERS: string[] = [
  'peer-75b8a7c8113377cf',
  'peer-01e3f23e20fe0102',
];

// ── Types ──────────────────────────────────────────────────────────────

export type SwarmPhase =
  | 'off'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'failed';

export type ConnectionSource = 'bootstrap' | 'library' | 'manual' | 'exchange';

export interface SwarmFlags {
  enabled: boolean;
  lastOnlineAt: number | null;
}

export interface SwarmPeer {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  messagesReceived: number;
  messagesSent: number;
  source: ConnectionSource;
}

export interface LibraryPeer {
  peerId: string;
  nodeId: string;
  alias: string;
  addedAt: number;
  lastSeenAt: number;
  autoConnect: boolean;
  source: ConnectionSource;
}

export interface ContentItem {
  id: string;
  type: 'post' | 'chunk' | 'comment';
  data: unknown;
  author: string;
  timestamp: number;
  hash: string;
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
  bootstrapOnline: number;
  libraryOnline: number;
}

type PhaseHandler = (phase: SwarmPhase) => void;
type PeerHandler = (peers: SwarmPeer[]) => void;
type ContentHandler = (item: ContentItem) => void;
type ContentChangeHandler = (items: ContentItem[]) => void;
type AlertHandler = (message: string, level: 'info' | 'warn' | 'error') => void;
type LibraryHandler = (peers: LibraryPeer[]) => void;

// ── Constants ──────────────────────────────────────────────────────────

const RECONNECT_INTERVALS = [15_000, 30_000, 60_000] as const;
const PEERJS_INIT_TIMEOUT = 12_000;
const CONTENT_SYNC_INTERVAL = 10_000;
const HEARTBEAT_INTERVAL = 8_000;
const PEER_STALE_THRESHOLD = 30_000;
const BOOTSTRAP_DIAL_DELAY = 2_000;
const LIBRARY_RECONNECT_INTERVAL = 30_000;
const CASCADE_SETTLE_TIME = 12_000;

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ═══════════════════════════════════════════════════════════════════════
// STANDALONE SWARM MESH CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneSwarmMesh {
  // ── Identity ──────────────────────────────────────────────────────
  private readonly nodeId: string;
  private readonly peerId: string;

  // ── PeerJS ────────────────────────────────────────────────────────
  private peer: import('peerjs').default | null = null;
  private connections = new Map<string, import('peerjs').DataConnection>();
  private peerData = new Map<string, SwarmPeer>();

  // ── State Machine ─────────────────────────────────────────────────
  private phase: SwarmPhase = 'off';
  private flags: SwarmFlags;
  private startedAt: number | null = null;

  // ── Reconnect ─────────────────────────────────────────────────────
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Content Store ─────────────────────────────────────────────────
  private contentStore = new Map<string, ContentItem>();

  // ── Connection Library (persisted) ────────────────────────────────
  private library = new Map<string, LibraryPeer>();
  private blockedPeers = new Set<string>();

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

  // ── Guard ─────────────────────────────────────────────────────────
  private initInProgress = false;

  constructor() {
    this.nodeId = this.loadOrCreateNodeId();
    this.peerId = `peer-${this.nodeId}`;
    this.flags = this.loadFlags();
    this.loadLibrary();
    this.loadBlockedPeers();

    // Seed bootstrap peers into library
    for (const bp of BOOTSTRAP_PEERS) {
      if (bp === this.peerId) continue;
      if (!this.library.has(bp) && !this.blockedPeers.has(bp)) {
        this.library.set(bp, {
          peerId: bp,
          nodeId: bp.replace(/^peer-/, ''),
          alias: `Bootstrap ${bp.slice(5, 11)}`,
          addedAt: now(),
          lastSeenAt: 0,
          autoConnect: true,
          source: 'bootstrap',
        });
      }
    }
    this.saveLibrary();

    console.log(`[SwarmMesh] Identity: nodeId=${this.nodeId} peerId=${this.peerId}, library=${this.library.size}, blocked=${this.blockedPeers.size}`);
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
  // CONNECTION LIBRARY
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

    const nodeId = metadata?.nodeId ?? remotePeerId.replace(/^peer-/, '');
    const existing = this.library.get(remotePeerId);
    if (existing) {
      existing.lastSeenAt = now();
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
    if (this.initInProgress) return;
    this.initInProgress = true;
    this.setPhase(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    this.destroyPeer();

    if (this.reconnectAttempt > 0) {
      const cooldown = Math.min(2000 + this.reconnectAttempt * 500, 5000);
      await this.sleep(cooldown);
    }

    try {
      const Peer = (await import('peerjs')).default;
      console.log(`[SwarmMesh] 🔌 PeerJS ID: ${this.peerId}`);

      const peer = new Peer(this.peerId, {
        debug: 1,
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
        config: { iceServers: DEFAULT_ICE },
      });

      const result = await this.waitForOpen(peer);
      if (!result.success) {
        console.warn(`[SwarmMesh] ❌ Init failed: ${result.error}`);
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
      console.log(`[SwarmMesh] ✅ Online as ${this.peerId}`);

      // Cascade connect after a brief delay
      setTimeout(() => void this.cascadeConnect(), BOOTSTRAP_DIAL_DELAY);
      this.startLibraryReconnectLoop();

    } catch (err) {
      console.error('[SwarmMesh] Unexpected error:', err);
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

      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ success: true });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const msg = err?.message || 'Unknown';
        const idTaken = err?.type === 'unavailable-id' || /ID.*taken|unavailable/i.test(msg);
        resolve({ success: false, error: idTaken ? `ID held by server — will retry` : msg });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CASCADE CONNECT — Bootstrap → Library → Manual fallback
  // ═══════════════════════════════════════════════════════════════════

  private async cascadeConnect(): Promise<void> {
    if (this.phase !== 'online') return;
    console.log('[SwarmMesh] 🔀 Cascade connect starting...');

    // Phase 1: Bootstrap peers
    console.log(`[SwarmMesh] Phase 1: ${BOOTSTRAP_PEERS.length} bootstrap peer(s)`);
    for (const bp of BOOTSTRAP_PEERS) {
      if (bp === this.peerId || this.blockedPeers.has(bp) || this.connections.has(bp)) continue;
      this.dialPeer(bp, 'bootstrap');
    }

    // Wait for bootstrap to settle
    await this.sleep(CASCADE_SETTLE_TIME);

    if (this.connections.size > 0) {
      const sources = Array.from(this.peerData.values());
      const bCount = sources.filter(p => p.source === 'bootstrap').length;
      const msg = bCount > 0
        ? `Connected to Swarm Mesh via ${bCount} bootstrap node(s)`
        : `Connected to Swarm Mesh via contacts`;
      this.emitAlert(msg, 'info');
      return; // Success
    }

    // Phase 2: Library peers (non-bootstrap)
    console.log('[SwarmMesh] Phase 2: Library peers...');
    let libraryDialed = 0;
    for (const [peerId, entry] of this.library) {
      if (!entry.autoConnect || this.connections.has(peerId) || this.blockedPeers.has(peerId)) continue;
      if (peerId === this.peerId || BOOTSTRAP_PEERS.includes(peerId)) continue;
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

    // Phase 3: No one online
    console.log('[SwarmMesh] ⚠️ No online nodes found in cascade');
    this.emitAlert('No online nodes found — enter a Peer ID to connect to a known peer', 'warn');
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

  connectToPeer(remotePeerId: string): void {
    if (!remotePeerId.startsWith('peer-')) remotePeerId = `peer-${remotePeerId}`;
    if (this.phase !== 'online') {
      this.emitAlert('Start the mesh first', 'warn');
      return;
    }
    if (this.blockedPeers.has(remotePeerId)) {
      this.emitAlert('That peer is blocked', 'warn');
      return;
    }
    if (this.connections.has(remotePeerId)) {
      this.emitAlert('Already connected', 'info');
      return;
    }
    this.dialPeer(remotePeerId, 'manual');
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
      console.log('[SwarmMesh] 📥 Incoming from:', conn.peer);
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
      if (['network', 'server-error', 'socket-error'].includes(err?.type ?? '')) this.handleLost();
    });

    peer.on('close', () => this.handleLost());
  }

  private handleLost(): void {
    if (['reconnecting', 'off', 'failed'].includes(this.phase)) return;
    console.log('[SwarmMesh] Connection lost → reconnect');
    this.clearIntervals();
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
        source,
      });
      this.emitPeers();

      const meta = conn.metadata as { nodeId?: string } | undefined;
      this.addToLibrary(rId, source, meta ?? undefined);

      // Exchange content inventories
      this.sendContentInventory(conn);
      // Exchange libraries for mesh growth
      this.sendLibraryExchange(conn);

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

    let added = 0;
    for (const rp of remote) {
      if (!rp.peerId || rp.peerId === this.peerId || this.blockedPeers.has(rp.peerId) || this.library.has(rp.peerId)) continue;
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
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT SERVING
  // ═══════════════════════════════════════════════════════════════════

  addContent(item: Omit<ContentItem, 'hash'>): void {
    const hash = `${item.id}-${item.timestamp}`;
    const full: ContentItem = { ...item, hash };
    this.contentStore.set(item.id, full);
    this.broadcast({ type: 'content-push', items: [full] });
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
      this.broadcast({ type: 'content-push', items: [item] });
      console.log(`[SwarmMesh] 📤 Broadcast post ${id} to ${this.connections.size} peer(s)`);
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
        case 'library-exchange': this.handleLibraryExchange(from, msg); break;
        case 'heartbeat': this.handleHeartbeat(from); break;
        case 'heartbeat-ack': break;
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
      console.log(`[SwarmMesh] 📦 ${n} new item(s), total: ${this.contentStore.size}`);
      this.emitContentChange();
    }
  }

  private handleHeartbeat(from: string): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'heartbeat-ack', from: this.peerId })); } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIBRARY RECONNECT LOOP
  // ═══════════════════════════════════════════════════════════════════

  private startLibraryReconnectLoop(): void {
    this.stopLibraryReconnectLoop();
    this.libraryReconnectTimer = setInterval(() => {
      if (this.phase !== 'online') return;
      for (const [peerId, entry] of this.library) {
        if (!entry.autoConnect || this.connections.has(peerId) || this.blockedPeers.has(peerId) || peerId === this.peerId) continue;
        this.dialPeer(peerId, entry.source ?? 'library');
      }
    }, LIBRARY_RECONNECT_INTERVAL);
  }

  private stopLibraryReconnectLoop(): void {
    if (this.libraryReconnectTimer !== null) { clearInterval(this.libraryReconnectTimer); this.libraryReconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERVALS
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
        if (conn) try { conn.send(JSON.stringify({ type: 'heartbeat', from: this.peerId })); } catch { /* ignore */ }
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

  private broadcast(msg: Record<string, unknown>): void {
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
      bootstrapOnline: peers.filter(p => p.source === 'bootstrap').length,
      libraryOnline: peers.filter(p => p.source === 'library' || p.source === 'exchange').length,
    };
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  // ═══════════════════════════════════════════════════════════════════
  // INDEXEDDB BRIDGE
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
        console.log(`[SwarmMesh] 💾 Wrote post ${postData.id} to IndexedDB`);
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] DB write error:', err);
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
