/**
 * ═══════════════════════════════════════════════════════════════════════
 * TEST MODE — Cornerstone P2P Connection & Content Serving Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Fully self-contained. Zero imports from other project modules.
 * Built from scratch as the stability cornerstone for PeerJS connections.
 *
 * Focus areas:
 *   1. Stable PeerJS connection with never-rotate identity
 *   2. Content serving (post sync, chunk exchange)
 *   3. Strong flag management (single source of truth)
 *   4. Dynamic reconnect: 15s → 30s → 60s → fail + flag off
 *
 * Design principles:
 *   - No abort controllers that cascade — clean lifecycle
 *   - No shared state with other modules
 *   - Connection state is guarded by a finite state machine
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

function timestamp(): number {
  return Date.now();
}

// ── Storage Keys ───────────────────────────────────────────────────────

const KEYS = {
  NODE_ID: 'test-mode-node-id',
  FLAGS: 'test-mode-flags',
  KNOWN_PEERS: 'test-mode-known-peers',
  CONNECTION_LIBRARY: 'test-mode-connection-library',
  BLOCKED_PEERS: 'test-mode-blocked-peers',
} as const;

// ── Types ──────────────────────────────────────────────────────────────

export type TestModePhase =
  | 'off'          // not running
  | 'connecting'   // PeerJS handshake in progress
  | 'online'       // signaling connected, serving content
  | 'reconnecting' // lost connection, retrying at intervals
  | 'failed';      // all retries exhausted, flag turned off

export interface TestModeFlags {
  /** User wants the network ON */
  enabled: boolean;
  /** Timestamp of last successful connection */
  lastOnlineAt: number | null;
}

export interface TestModePeer {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  messagesReceived: number;
  messagesSent: number;
}

/** A saved peer in the connection library (persisted) */
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

export interface TestModeStats {
  phase: TestModePhase;
  peerId: string | null;
  nodeId: string;
  connectedPeers: number;
  contentItems: number;
  uptimeMs: number;
  reconnectAttempt: number;
  flags: TestModeFlags;
}

type PhaseHandler = (phase: TestModePhase) => void;
type PeerHandler = (peers: TestModePeer[]) => void;
type ContentHandler = (item: ContentItem) => void;
type ContentChangeHandler = (items: ContentItem[]) => void;
type AlertHandler = (message: string, level: 'info' | 'warn' | 'error') => void;

// ── Constants ──────────────────────────────────────────────────────────

const RECONNECT_INTERVALS = [15_000, 30_000, 60_000] as const;
const PEERJS_INIT_TIMEOUT = 12_000;
const CONTENT_SYNC_INTERVAL = 10_000;
const HEARTBEAT_INTERVAL = 8_000;
const PEER_STALE_THRESHOLD = 30_000;

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ═══════════════════════════════════════════════════════════════════════
// TEST MODE CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneTestMode {
  // ── Identity (sacred, never changes) ──────────────────────────────
  private readonly nodeId: string;
  private readonly peerId: string;

  // ── PeerJS ────────────────────────────────────────────────────────
  private peer: import('peerjs').default | null = null;
  private connections = new Map<string, import('peerjs').DataConnection>();
  private peerData = new Map<string, TestModePeer>();

  // ── State Machine ─────────────────────────────────────────────────
  private phase: TestModePhase = 'off';
  private flags: TestModeFlags;
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
  private libraryHandlers = new Set<(peers: LibraryPeer[]) => void>();

  // ── Guard against concurrent init ─────────────────────────────────
  private initInProgress = false;

  constructor() {
    this.nodeId = this.loadOrCreateNodeId();
    this.peerId = `peer-${this.nodeId}`;
    this.flags = this.loadFlags();
    this.loadLibrary();
    this.loadBlockedPeers();

    console.log(`[TestMode] Identity: nodeId=${this.nodeId} peerId=${this.peerId}, library=${this.library.size} peers, blocked=${this.blockedPeers.size}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // IDENTITY — Never rotates
  // ═══════════════════════════════════════════════════════════════════

  private loadOrCreateNodeId(): string {
    try {
      const stored = localStorage.getItem(KEYS.NODE_ID);
      if (stored && stored.length >= 8) return stored;
    } catch { /* ignore */ }

    const id = hexId(8);
    try { localStorage.setItem(KEYS.NODE_ID, id); } catch { /* ignore */ }
    console.log('[TestMode] Generated new node ID:', id);
    return id;
  }

  getNodeId(): string { return this.nodeId; }
  getPeerId(): string { return this.peerId; }

  // ═══════════════════════════════════════════════════════════════════
  // FLAGS — Single source of truth
  // ═══════════════════════════════════════════════════════════════════

  private loadFlags(): TestModeFlags {
    try {
      const raw = localStorage.getItem(KEYS.FLAGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
          lastOnlineAt: typeof parsed.lastOnlineAt === 'number' ? parsed.lastOnlineAt : null,
        };
      }
    } catch { /* ignore */ }
    return { enabled: false, lastOnlineAt: null };
  }

  private saveFlags(): void {
    try {
      localStorage.setItem(KEYS.FLAGS, JSON.stringify(this.flags));
    } catch { /* ignore */ }
  }

  getFlags(): TestModeFlags { return { ...this.flags }; }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS — Finite State Machine
  // ═══════════════════════════════════════════════════════════════════

  private setPhase(next: TestModePhase): void {
    if (this.phase === next) return;
    const prev = this.phase;
    this.phase = next;
    console.log(`[TestMode] Phase: ${prev} → ${next}`);
    for (const handler of this.phaseHandlers) {
      try { handler(next); } catch (e) { console.warn('[TestMode] phase handler error', e); }
    }
  }

  getPhase(): TestModePhase { return this.phase; }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start the test mode. Sets flag to enabled and connects.
   * If already connecting/online, this is a no-op.
   */
  async start(): Promise<void> {
    if (this.phase === 'connecting' || this.phase === 'online' || this.initInProgress) {
      console.log('[TestMode] Already active, ignoring start()');
      return;
    }

    this.flags.enabled = true;
    this.saveFlags();
    this.startedAt = timestamp();
    this.reconnectAttempt = 0;

    // Load existing posts from IndexedDB into content store
    await this.loadPostsFromDB();

    await this.connect();
  }

  /**
   * Stop the test mode. Cleans up everything, sets flag to disabled.
   */
  stop(): void {
    this.flags.enabled = false;
    this.saveFlags();
    this.clearReconnectTimer();
    this.clearIntervals();
    this.destroyPeer();
    this.peerData.clear();
    this.connections.clear();
    this.setPhase('off');
    this.emitPeers();
    this.emitAlert('Network disconnected', 'info');
    console.log('[TestMode] ⏹️ Stopped');
  }

  /**
   * Auto-start if flags say enabled (call on page load).
   */
  async autoStart(): Promise<void> {
    if (!this.flags.enabled) {
      console.log('[TestMode] Flags say offline, not auto-starting');
      return;
    }
    console.log('[TestMode] Flags say online, auto-starting...');
    await this.start();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEERJS CONNECTION — Clean lifecycle, no abort controllers
  // ═══════════════════════════════════════════════════════════════════

  private async connect(): Promise<void> {
    if (this.initInProgress) {
      console.warn('[TestMode] Connection already in progress, skipping');
      return;
    }

    this.initInProgress = true;
    this.setPhase(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    // CRITICAL: Destroy any existing peer COMPLETELY before creating new one
    this.destroyPeer();

    // Wait for PeerJS server to release the old session
    if (this.reconnectAttempt > 0) {
      const cooldown = Math.min(2000 + this.reconnectAttempt * 500, 5000);
      console.log(`[TestMode] Waiting ${cooldown}ms for server to release session...`);
      await this.sleep(cooldown);
    }

    try {
      const Peer = (await import('peerjs')).default;

      console.log(`[TestMode] 🔌 Creating PeerJS instance with ID: ${this.peerId}`);

      const peer = new Peer(this.peerId, {
        debug: 1,
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
        config: { iceServers: DEFAULT_ICE },
      });

      // Set up a clean timeout
      const initResult = await this.waitForPeerOpen(peer);

      if (!initResult.success) {
        // Connection failed — don't throw, handle gracefully
        console.warn(`[TestMode] ❌ PeerJS init failed: ${initResult.error}`);
        this.destroyPeerInstance(peer);
        this.initInProgress = false;
        this.scheduleReconnect();
        return;
      }

      // SUCCESS — wire up event handlers
      this.peer = peer;
      this.initInProgress = false;

      this.setupPeerEventHandlers(peer);
      this.startIntervals();

      this.flags.lastOnlineAt = timestamp();
      this.saveFlags();
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();

      this.setPhase('online');
      this.emitAlert('Connected to P2P network', 'info');
      console.log(`[TestMode] ✅ Online as ${this.peerId}`);

    } catch (err) {
      console.error('[TestMode] Unexpected init error:', err);
      this.initInProgress = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Wait for PeerJS 'open' event with a clean timeout.
   * No abort controllers — just a promise race.
   */
  private waitForPeerOpen(peer: import('peerjs').default): Promise<{ success: boolean; error?: string }> {
    return new Promise(resolve => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.removeAllListeners?.();
        resolve({ success: false, error: 'Timeout waiting for signaling server' });
      }, PEERJS_INIT_TIMEOUT);

      peer.on('open', (_id: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({ success: true });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        const msg = err?.message || 'Unknown error';
        const isIdTaken = err?.type === 'unavailable-id' || /ID.*taken|unavailable/i.test(msg);

        if (isIdTaken) {
          resolve({ success: false, error: `ID "${this.peerId}" still held by server — will retry` });
        } else {
          resolve({ success: false, error: msg });
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DYNAMIC RECONNECT — 15s → 30s → 60s → fail
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (!this.flags.enabled) {
      this.setPhase('off');
      return;
    }

    if (this.reconnectAttempt >= RECONNECT_INTERVALS.length) {
      // All retries exhausted
      console.error('[TestMode] 🚫 All reconnect attempts exhausted');
      this.flags.enabled = false;
      this.saveFlags();
      this.setPhase('failed');
      this.emitAlert('Connection failed, try refreshing your browser', 'error');
      return;
    }

    const delay = RECONNECT_INTERVALS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.setPhase('reconnecting');

    console.log(`[TestMode] 🔄 Reconnect attempt ${this.reconnectAttempt}/${RECONNECT_INTERVALS.length} in ${delay / 1000}s`);
    this.emitAlert(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt}/${RECONNECT_INTERVALS.length})...`, 'warn');

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.flags.enabled) {
        void this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  private setupPeerEventHandlers(peer: import('peerjs').default): void {
    peer.on('connection', (conn: import('peerjs').DataConnection) => {
      console.log('[TestMode] 📥 Incoming connection from:', conn.peer);
      this.handleConnection(conn);
    });

    peer.on('disconnected', () => {
      console.warn('[TestMode] ⚠️ Signaling disconnected');
      // Don't destroy — try to reconnect the same peer instance first
      if (this.peer && !this.peer.destroyed) {
        console.log('[TestMode] Attempting peer.reconnect()...');
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            try {
              this.peer.reconnect();
            } catch (e) {
              console.warn('[TestMode] reconnect() failed, scheduling full reconnect', e);
              this.handleConnectionLost();
            }
          } else {
            this.handleConnectionLost();
          }
        }, 3000);
      } else {
        this.handleConnectionLost();
      }
    });

    peer.on('error', (err: Error & { type?: string }) => {
      console.error('[TestMode] PeerJS error:', err?.type, err?.message);

      // Fatal errors that need a full reconnect
      if (err?.type === 'network' || err?.type === 'server-error' || err?.type === 'socket-error') {
        this.handleConnectionLost();
      }
      // 'peer-unavailable' errors are for outbound connections — not fatal
    });

    peer.on('close', () => {
      console.warn('[TestMode] Peer instance closed');
      this.handleConnectionLost();
    });
  }

  private handleConnectionLost(): void {
    if (this.phase === 'reconnecting' || this.phase === 'off' || this.phase === 'failed') return;

    console.log('[TestMode] Connection lost, entering reconnect cycle');
    this.clearIntervals();
    this.peer = null; // Don't destroy — it's already closed/disconnected
    this.connections.clear();
    this.peerData.clear();
    this.emitPeers();

    this.reconnectAttempt = 0; // Reset for fresh reconnect cycle
    this.scheduleReconnect();
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA CONNECTION HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleConnection(conn: import('peerjs').DataConnection): void {
    const remotePeerId = conn.peer;

    conn.on('open', () => {
      console.log(`[TestMode] ✅ Data channel open with ${remotePeerId}`);
      this.connections.set(remotePeerId, conn);
      this.peerData.set(remotePeerId, {
        peerId: remotePeerId,
        connectedAt: timestamp(),
        lastActivity: timestamp(),
        messagesReceived: 0,
        messagesSent: 0,
      });
      this.emitPeers();

      // Send our content inventory
      this.sendContentInventory(conn);
    });

    conn.on('data', (rawData: unknown) => {
      const peer = this.peerData.get(remotePeerId);
      if (peer) {
        peer.lastActivity = timestamp();
        peer.messagesReceived++;
      }
      this.handleMessage(remotePeerId, rawData);
    });

    conn.on('close', () => {
      console.log(`[TestMode] 🔌 Peer disconnected: ${remotePeerId}`);
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    });

    conn.on('error', (err: Error) => {
      console.warn(`[TestMode] Connection error with ${remotePeerId}:`, err?.message);
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT SERVING — Post sync & chunk exchange
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Add content to the local store and broadcast to peers.
   */
  addContent(item: Omit<ContentItem, 'hash'>): void {
    const hash = `${item.id}-${item.timestamp}`;
    const fullItem: ContentItem = { ...item, hash };
    this.contentStore.set(item.id, fullItem);

    // Broadcast to all connected peers
    this.broadcast({
      type: 'content-push',
      items: [fullItem],
    });

    for (const handler of this.contentHandlers) {
      try { handler(fullItem); } catch { /* ignore */ }
    }
    this.emitContentChange();
  }

  /**
   * Get all local content items.
   */
  getContent(): ContentItem[] {
    return Array.from(this.contentStore.values());
  }

  private sendContentInventory(conn: import('peerjs').DataConnection): void {
    const ids = Array.from(this.contentStore.keys());
    try {
      conn.send(JSON.stringify({
        type: 'content-inventory',
        ids,
        from: this.peerId,
      }));
    } catch { /* ignore */ }
  }

  private handleMessage(fromPeerId: string, rawData: unknown): void {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      if (!data || typeof data !== 'object') return;

      const msg = data as { type?: string; [key: string]: unknown };

      switch (msg.type) {
        case 'content-inventory':
          this.handleContentInventory(fromPeerId, msg);
          break;
        case 'content-request':
          this.handleContentRequest(fromPeerId, msg);
          break;
        case 'content-push':
          this.handleContentPush(msg);
          break;
        case 'heartbeat':
          this.handleHeartbeat(fromPeerId);
          break;
        case 'heartbeat-ack':
          // Peer is alive
          break;
        default:
          console.log(`[TestMode] Unknown message type: ${msg.type} from ${fromPeerId}`);
      }
    } catch (e) {
      console.warn('[TestMode] Failed to parse message from', fromPeerId, e);
    }
  }

  private handleContentInventory(fromPeerId: string, msg: Record<string, unknown>): void {
    const remoteIds = msg.ids as string[] | undefined;
    if (!Array.isArray(remoteIds)) return;

    // Find items we don't have
    const needed = remoteIds.filter(id => !this.contentStore.has(id));
    if (needed.length === 0) return;

    const conn = this.connections.get(fromPeerId);
    if (!conn) return;

    try {
      conn.send(JSON.stringify({
        type: 'content-request',
        ids: needed,
        from: this.peerId,
      }));
    } catch { /* ignore */ }
  }

  private handleContentRequest(fromPeerId: string, msg: Record<string, unknown>): void {
    const requestedIds = msg.ids as string[] | undefined;
    if (!Array.isArray(requestedIds)) return;

    const conn = this.connections.get(fromPeerId);
    if (!conn) return;

    const items = requestedIds
      .map(id => this.contentStore.get(id))
      .filter((item): item is ContentItem => !!item);

    if (items.length === 0) return;

    try {
      conn.send(JSON.stringify({
        type: 'content-push',
        items,
        from: this.peerId,
      }));
      const peer = this.peerData.get(fromPeerId);
      if (peer) peer.messagesSent++;
    } catch { /* ignore */ }
  }

  private handleContentPush(msg: Record<string, unknown>): void {
    const items = msg.items as ContentItem[] | undefined;
    if (!Array.isArray(items)) return;

    let newCount = 0;
    for (const item of items) {
      if (!item.id || this.contentStore.has(item.id)) continue;
      this.contentStore.set(item.id, item);
      newCount++;

      // Write received posts back to IndexedDB so they appear in the feed
      if (item.type === 'post' && item.data) {
        this.writePostToDB(item.data as Record<string, unknown>);
      }

      for (const handler of this.contentHandlers) {
        try { handler(item); } catch { /* ignore */ }
      }
    }

    if (newCount > 0) {
      console.log(`[TestMode] 📦 Received ${newCount} new content item(s), total: ${this.contentStore.size}`);
      this.emitContentChange();
    }
  }

  private handleHeartbeat(fromPeerId: string): void {
    const conn = this.connections.get(fromPeerId);
    if (!conn) return;
    try {
      conn.send(JSON.stringify({ type: 'heartbeat-ack', from: this.peerId }));
    } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // OUTBOUND CONNECTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Connect to a specific peer by their peer ID.
   */
  connectToPeer(remotePeerId: string): void {
    if (!this.peer || this.peer.destroyed) {
      console.warn('[TestMode] Cannot connect — not initialized');
      return;
    }

    if (remotePeerId === this.peerId) return;

    if (this.connections.has(remotePeerId)) {
      console.log(`[TestMode] Already connected to ${remotePeerId}`);
      return;
    }

    console.log(`[TestMode] 🔗 Connecting to ${remotePeerId}...`);
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: { nodeId: this.nodeId },
    });

    this.handleConnection(conn);
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERVALS — Heartbeat & Content Sync
  // ═══════════════════════════════════════════════════════════════════

  private startIntervals(): void {
    this.clearIntervals();

    // Heartbeat — keep connections alive and prune stale peers
    this.heartbeatTimer = setInterval(() => {
      const now = timestamp();

      for (const [peerId, peer] of this.peerData) {
        if (now - peer.lastActivity > PEER_STALE_THRESHOLD) {
          console.log(`[TestMode] Pruning stale peer: ${peerId}`);
          const conn = this.connections.get(peerId);
          try { conn?.close(); } catch { /* ignore */ }
          this.connections.delete(peerId);
          this.peerData.delete(peerId);
          this.emitPeers();
          continue;
        }

        const conn = this.connections.get(peerId);
        if (conn) {
          try {
            conn.send(JSON.stringify({ type: 'heartbeat', from: this.peerId }));
          } catch { /* ignore */ }
        }
      }
    }, HEARTBEAT_INTERVAL);

    // Content sync — periodically exchange inventories
    this.contentSyncTimer = setInterval(() => {
      for (const [, conn] of this.connections) {
        this.sendContentInventory(conn);
      }
    }, CONTENT_SYNC_INTERVAL);
  }

  private clearIntervals(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.contentSyncTimer !== null) {
      clearInterval(this.contentSyncTimer);
      this.contentSyncTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BROADCAST UTILITY
  // ═══════════════════════════════════════════════════════════════════

  private broadcast(msg: Record<string, unknown>): void {
    const payload = JSON.stringify({ ...msg, from: this.peerId });
    for (const [peerId, conn] of this.connections) {
      try {
        conn.send(payload);
        const peer = this.peerData.get(peerId);
        if (peer) peer.messagesSent++;
      } catch {
        console.warn(`[TestMode] Failed to send to ${peerId}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER INSTANCE MANAGEMENT — Clean lifecycle
  // ═══════════════════════════════════════════════════════════════════

  private destroyPeer(): void {
    if (this.peer) {
      this.destroyPeerInstance(this.peer);
      this.peer = null;
    }
  }

  private destroyPeerInstance(peer: import('peerjs').default): void {
    try {
      peer.removeAllListeners?.();
      if (!peer.destroyed) {
        peer.destroy();
      }
    } catch (e) {
      console.warn('[TestMode] Error destroying peer instance:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════

  onPhaseChange(handler: PhaseHandler): () => void {
    this.phaseHandlers.add(handler);
    handler(this.phase); // immediate sync
    return () => { this.phaseHandlers.delete(handler); };
  }

  onPeersChange(handler: PeerHandler): () => void {
    this.peerHandlers.add(handler);
    handler(Array.from(this.peerData.values())); // immediate sync
    return () => { this.peerHandlers.delete(handler); };
  }

  onContent(handler: ContentHandler): () => void {
    this.contentHandlers.add(handler);
    return () => { this.contentHandlers.delete(handler); };
  }

  onAlert(handler: AlertHandler): () => void {
    this.alertHandlers.add(handler);
    return () => { this.alertHandlers.delete(handler); };
  }

  private emitPeers(): void {
    const peers = Array.from(this.peerData.values());
    for (const handler of this.peerHandlers) {
      try { handler(peers); } catch { /* ignore */ }
    }
  }

  private emitAlert(message: string, level: 'info' | 'warn' | 'error'): void {
    console.log(`[TestMode] Alert (${level}): ${message}`);
    for (const handler of this.alertHandlers) {
      try { handler(message, level); } catch { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════

  getStats(): TestModeStats {
    return {
      phase: this.phase,
      peerId: this.phase === 'online' ? this.peerId : null,
      nodeId: this.nodeId,
      connectedPeers: this.connections.size,
      contentItems: this.contentStore.size,
      uptimeMs: this.startedAt ? timestamp() - this.startedAt : 0,
      reconnectAttempt: this.reconnectAttempt,
      flags: this.getFlags(),
    };
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
      if (!db.objectStoreNames.contains('posts')) {
        db.close();
        console.log('[TestMode] No posts store in IndexedDB');
        return;
      }

      const tx = db.transaction('posts', 'readonly');
      const store = tx.objectStore('posts');
      const req = store.getAll();

      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const posts = req.result as Array<{ id: string; content?: string; author?: string; createdAt?: string; [key: string]: unknown }>;
          let loaded = 0;
          for (const post of posts) {
            if (!post.id || this.contentStore.has(post.id)) continue;
            this.contentStore.set(post.id, {
              id: post.id,
              type: 'post',
              data: post,
              author: post.author ?? 'unknown',
              timestamp: post.createdAt ? new Date(post.createdAt).getTime() : Date.now(),
              hash: `${post.id}-${post.createdAt ?? Date.now()}`,
            });
            loaded++;
          }
          console.log(`[TestMode] 📂 Loaded ${loaded} posts from IndexedDB (total store: ${this.contentStore.size})`);
          this.emitContentChange();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });

      db.close();
    } catch (err) {
      console.warn('[TestMode] Failed to load posts from IndexedDB:', err);
    }
  }

  private async writePostToDB(postData: Record<string, unknown>): Promise<void> {
    try {
      if (!postData.id) return;

      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) {
        db.close();
        return;
      }

      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');

      // Check if post already exists
      const existing = await new Promise<unknown>((resolve) => {
        const req = store.get(postData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (!existing) {
        store.put(postData);
        console.log(`[TestMode] 💾 Wrote received post ${postData.id} to IndexedDB`);

        // Dispatch the SAME event the feeds already listen for
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }

      db.close();
    } catch (err) {
      console.warn('[TestMode] Failed to write post to IndexedDB:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT CHANGE EVENTS
  // ═══════════════════════════════════════════════════════════════════

  onContentChange(handler: ContentChangeHandler): () => void {
    this.contentChangeHandlers.add(handler);
    handler(this.getContent()); // immediate sync
    return () => { this.contentChangeHandlers.delete(handler); };
  }

  private emitContentChange(): void {
    const items = this.getContent();
    for (const handler of this.contentChangeHandlers) {
      try { handler(items); } catch { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Broadcast a Post object that was just created locally.
   * Called from PostComposer so the post reaches connected peers instantly.
   */
  broadcastNewPost(post: Record<string, unknown>): void {
    if (this.phase !== 'online') return;
    const id = post.id as string;
    if (!id) return;

    // Add to content store if not already present
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

    // Broadcast to peers
    const item = this.contentStore.get(id);
    if (item) {
      this.broadcast({ type: 'content-push', items: [item] });
      console.log(`[TestMode] 📤 Broadcast new post ${id} to ${this.connections.size} peer(s)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON — Use this everywhere
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneTestMode | null = null;

export function getTestMode(): StandaloneTestMode {
  if (!_instance) {
    _instance = new StandaloneTestMode();
  }
  return _instance;
}
