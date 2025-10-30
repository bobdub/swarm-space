/**
 * P2P Manager - PeerJS Edition
 * 
 * Orchestrates peer-to-peer networking using PeerJS for signaling and discovery.
 * 
 * Architecture:
 * - PeerJS handles WebRTC signaling via cloud infrastructure (zero config)
 * - Direct P2P data channels for content transfer
 * - Local discovery tracking and content inventory
 * - Chunk protocol for file distribution
 * - Post synchronization across peers
 * 
 * External Dependency: PeerJS Cloud Signaling
 * This app uses PeerJS's free cloud-hosted signaling server for initial
 * peer discovery. Once peers connect, all data flows directly P2P.
 */

import { PeerJSAdapter } from './peerjs-adapter';
import { ChunkProtocol, type ChunkMessage, type ChunkTransferUpdate } from './chunkProtocol';
import { PeerDiscovery } from './discovery';
import { PostSyncManager, type PostSyncMessage } from './postSync';
import { CommentSync, type CommentSyncMessage } from './commentSync';
import {
  BootstrapRegistry,
  fetchBeaconPeers,
  fetchCapsulePeers,
  type BeaconEndpoint,
  type CapsuleSource,
  type RendezvousPeerRecord
} from './bootstrap';
import { ConnectionHealthMonitor } from './connectionHealth';
import { PeerExchangeProtocol, type PEXMessage } from './peerExchange';
import { GossipProtocol, type GossipMessage } from './gossip';
import { RoomDiscovery } from './roomDiscovery';
import {
  createPresenceTicket,
  type PresenceTicketEnvelope,
  type PresenceTicketSigner
} from './presenceTicket';
import { getRendezvousSigner as loadRendezvousSigner } from './rendezvousIdentity';
import { loadRendezvousConfig, type RendezvousMeshConfig } from './rendezvousConfig';
import type { Post } from '@/types';
import type { Comment } from '@/types';
import { createConnection, getConnectionByPeerId, updateConnectionPeerId } from '../connections';
import { get, type Manifest, type Chunk } from '../store';

export interface P2PControlState {
  autoConnect: boolean;
  manualAccept: boolean;
  isolate: boolean;
  paused: boolean;
}

export interface ConnectOptions {
  manual?: boolean;
  source?: string;
  allowDuringIsolation?: boolean;
}
import { NodeMetricsTracker } from './nodeMetrics';

export type P2PStatus = 'offline' | 'connecting' | 'waiting' | 'online';

export interface P2PStats {
  status: P2PStatus;
  connectedPeers: number;
  discoveredPeers: number;
  localContent: number;
  networkContent: number;
  activeRequests: number;
  rendezvousPeers: number;
  lastRendezvousSync: number | null;
  uptimeMs: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  relayCount: number;
  pingCount: number;
}

export interface PendingPeer {
  peerId: string;
  userId?: string | null;
  queuedAt: number;
}

export interface EnsureManifestOptions {
  includeChunks?: boolean;
  sourcePeerId?: string;
}

interface RendezvousOptions {
  enabled: boolean;
  config?: RendezvousMeshConfig;
}

interface P2PManagerOptions {
  rendezvous?: RendezvousOptions;
  controls?: P2PControlState;
}

export class P2PManager {
  private peerjs: PeerJSAdapter;
  private chunkProtocol: ChunkProtocol;
  private discovery: PeerDiscovery;
  private postSync: PostSyncManager;
  private commentSync: CommentSync;
  private bootstrap: BootstrapRegistry;
  private healthMonitor: ConnectionHealthMonitor;
  private peerExchange: PeerExchangeProtocol;
  private gossip: GossipProtocol;
  private roomDiscovery: RoomDiscovery;
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;
  private reconnectInterval?: number;
  private pingInterval?: number;
  private peerId: string | null = null;
  private options: P2PManagerOptions;
  private rendezvousConfig: RendezvousMeshConfig;
  private rendezvousEnabled: boolean;
  private rendezvousSignerPromise?: Promise<PresenceTicketSigner>;
  private rendezvousTicket?: PresenceTicketEnvelope;
  private rendezvousPeerCache: Map<string, RendezvousPeerRecord> = new Map();
  private lastRendezvousSync = 0;
  private rendezvousPollInterval?: number;
  private rendezvousInFlight = false;
  private rendezvousPendingStart = false;
  private desiredConnectionFloor = 3;
  private maxMeshConnections = 8;
  private metrics: NodeMetricsTracker;
  private pendingPings: Map<string, number> = new Map();
  private controlState: P2PControlState;
  private blockedPeers: Set<string> = new Set();
  private pendingInboundPeers: Map<string, PendingPeer> = new Map();
  private pendingPeerListeners = new Set<(peers: PendingPeer[]) => void>();
  private pendingOutboundConnections: Set<string> = new Set();
  private commentCleanup?: () => void;

  constructor(private localUserId: string, options: P2PManagerOptions = {}) {
    console.log('[P2P] Initializing P2P Manager with PeerJS');
    console.log('[P2P] 🌐 Using PeerJS cloud signaling (zero config)');
    console.log('[P2P] 🔄 Pure P2P discovery via PEX + Gossip');
    console.log('[P2P] User ID:', localUserId);

    this.options = options;
    const rendezvousConfig = options.rendezvous?.config ?? loadRendezvousConfig();
    this.rendezvousConfig = rendezvousConfig;
    this.rendezvousEnabled = options.rendezvous?.enabled ?? false;

    this.metrics = new NodeMetricsTracker(localUserId);

    this.controlState = options.controls ?? {
      autoConnect: true,
      manualAccept: false,
      isolate: false,
      paused: false,
    };

    this.peerjs = new PeerJSAdapter(localUserId);
    this.discovery = new PeerDiscovery('pending', localUserId);
    this.bootstrap = new BootstrapRegistry();
    this.healthMonitor = new ConnectionHealthMonitor((peerId) => {
      console.log(`[P2P] Health monitor requesting reconnect to ${peerId}`);
      this.reconnectToPeer(peerId);
    });

    // Chunk protocol sends messages via PeerJS
    this.chunkProtocol = new ChunkProtocol(
      (peerId, message) => {
        const sent = this.peerjs.sendToPeer(peerId, 'chunk', message);
        if (sent && message.type === 'request_chunk') {
          this.discovery.updatePeerSeen(peerId);
        }
        return sent;
      },
      (update) => this.handleChunkTransfer(update)
    );

    // Post sync sends messages via PeerJS
    this.postSync = new PostSyncManager(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'post', message),
      () => this.peerjs.getConnectedPeers(),
      (manifestIds, sourcePeerId) => this.ensureManifestsAvailable(manifestIds, sourcePeerId)
    );

    // Comment sync sends messages via PeerJS
    this.commentSync = new CommentSync(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'comment', message),
      () => this.peerjs.getConnectedPeers()
    );

    // Peer Exchange Protocol - discover peers from peers
    this.peerExchange = new PeerExchangeProtocol(
      (peerId, type, payload) => this.peerjs.sendToPeer(peerId, type, payload),
      (newPeers) => this.handlePEXDiscovery(newPeers)
    );

    // Gossip Protocol - continuous peer broadcasting
    this.gossip = new GossipProtocol(
      () => this.getGossipPeerList(),
      (type, payload) => this.peerjs.broadcast(type, payload),
      (peers) => this.handleGossipPeers(peers)
    );

    // Room-based discovery for easy peer finding
    this.roomDiscovery = new RoomDiscovery((peerId) => {
      console.log('[P2P] Room discovery found peer:', peerId);
      this.connectToPeer(peerId, { source: 'room-discovery' });
    });

    this.setupEventHandlers();
  }

  setCommentCleanup(cleanup: (() => void) | null): void {
    this.commentCleanup = cleanup ?? undefined;
  }

  runCommentCleanup(): void {
    this.commentCleanup?.();
    this.commentCleanup = undefined;
  }

  getControlState(): P2PControlState {
    return { ...this.controlState };
  }

  updateControlState(update: Partial<P2PControlState>): void {
    const previous = this.controlState;
    this.controlState = { ...this.controlState, ...update };
    console.log('[P2P] ⚙️ Control state updated:', this.controlState);

    if (update.paused !== undefined && update.paused !== previous.paused) {
      if (update.paused) {
        this.status = 'waiting';
      }
    }

    if (previous.manualAccept && !this.controlState.manualAccept) {
      this.releasePendingPeers('manual-accept-disabled');
    }
  }

  setBlockedPeers(peers: string[]): void {
    this.blockedPeers = new Set((peers || []).filter(Boolean));
    this.enforceBlockedPeers();
    let queueChanged = false;
    for (const peerId of Array.from(this.pendingInboundPeers.keys())) {
      if (this.blockedPeers.has(peerId)) {
        this.pendingInboundPeers.delete(peerId);
        queueChanged = true;
      }
    }
    if (queueChanged) {
      this.emitPendingPeerUpdate();
    }
  }

  private isPeerBlocked(peerId: string | null | undefined): boolean {
    return !!peerId && this.blockedPeers.has(peerId);
  }

  getPendingPeers(): PendingPeer[] {
    return Array.from(this.pendingInboundPeers.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  subscribeToPendingPeers(listener: (peers: PendingPeer[]) => void): () => void {
    this.pendingPeerListeners.add(listener);
    try {
      listener(this.getPendingPeers());
    } catch (error) {
      console.warn('[P2P] Pending peer listener threw during initial emit', error);
    }
    return () => {
      this.pendingPeerListeners.delete(listener);
    };
  }

  approvePendingPeer(peerId: string): boolean {
    const pending = this.pendingInboundPeers.get(peerId);
    if (!pending) {
      return false;
    }

    const connected = this.connectToPeer(peerId, {
      manual: true,
      source: 'manual-approval',
      allowDuringIsolation: true,
    });

    if (connected) {
      this.pendingInboundPeers.delete(peerId);
      this.emitPendingPeerUpdate();
    }

    return connected;
  }

  rejectPendingPeer(peerId: string): void {
    if (this.pendingInboundPeers.delete(peerId)) {
      console.log(`[P2P] ❎ Pending peer rejected: ${peerId}`);
      this.emitPendingPeerUpdate();
    }
    this.peerjs.disconnectFrom(peerId);
  }

  private emitPendingPeerUpdate(): void {
    const snapshot = this.getPendingPeers();
    for (const listener of this.pendingPeerListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[P2P] Pending peer listener error', error);
      }
    }
  }

  private queueInboundPeer(peerId: string): void {
    const metadata = this.peerjs.getConnectionMetadata(peerId);
    const userId = this.extractUserId(metadata);
    const existing = this.pendingInboundPeers.get(peerId);
    const queuedAt = existing?.queuedAt ?? Date.now();
    this.pendingInboundPeers.set(peerId, {
      peerId,
      userId: userId ?? existing?.userId ?? null,
      queuedAt,
    });
    console.log(`[P2P] ⏳ Queued inbound peer ${peerId}${userId ? ` (user: ${userId})` : ''} for manual approval`);
    this.emitPendingPeerUpdate();
  }

  private extractUserId(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }
    const candidate = (metadata as { userId?: unknown }).userId;
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private releasePendingPeers(source: string): void {
    if (this.pendingInboundPeers.size === 0) {
      return;
    }

    console.log(`[P2P] Releasing ${this.pendingInboundPeers.size} pending peers (${source})`);
    let changed = false;
    for (const pending of this.getPendingPeers()) {
      const connected = this.connectToPeer(pending.peerId, {
        manual: true,
        source,
        allowDuringIsolation: true,
      });
      if (connected) {
        this.pendingInboundPeers.delete(pending.peerId);
        changed = true;
      }
    }

    if (changed) {
      this.emitPendingPeerUpdate();
    }
  }

  private enforceBlockedPeers(): void {
    const connected = this.peerjs.getConnectedPeers();
    for (const peerId of connected) {
      if (this.blockedPeers.has(peerId)) {
        console.log(`[P2P] 🚫 Disconnecting blocked peer: ${peerId}`);
        this.peerjs.disconnectFrom(peerId);
        this.discovery.removePeer(peerId);
      }
    }
  }

  private isPaused(): boolean {
    return this.controlState.paused;
  }

  private canAutoConnect(): boolean {
    if (this.controlState.paused) {
      return false;
    }
    if (!this.controlState.autoConnect) {
      return false;
    }
    if (this.controlState.manualAccept) {
      return false;
    }
    if (this.controlState.isolate) {
      return false;
    }
    return true;
  }

  /**
   * Start P2P networking
   */
  async start(): Promise<void> {
    console.log('[P2P] 🚀 Starting P2P manager...');
    console.log('[P2P] User ID:', this.localUserId);
    this.status = 'connecting';

    try {
      await this.metrics.initialize();
      // Initialize PeerJS connection
      console.log('[P2P] 🔌 Initializing PeerJS...');
      this.peerId = await this.peerjs.initialize();
      console.log('[P2P] ✅ PeerJS initialized with ID:', this.peerId);

      this.metrics.startSession();

      // Update discovery with our peer ID
      console.log('[P2P] 🔍 Creating discovery manager...');
      this.discovery = new PeerDiscovery(this.peerId, this.localUserId);
      
      // Scan local content - THIS IS CRITICAL
      console.log('[P2P] 📂 Scanning local content from IndexedDB...');
      const startScan = performance.now();
      const localContent = await this.discovery.scanLocalContent();
      const scanDuration = performance.now() - startScan;
      console.log(`[P2P] ✅ Content scan complete in ${scanDuration.toFixed(2)}ms`);
      console.log(`[P2P] 📊 Found ${localContent.length} local items:`, localContent.slice(0, 5));

      // Verify stats immediately
      const initialStats = this.discovery.getStats();
      console.log('[P2P] 📊 Initial discovery stats:', initialStats);

      if (localContent.length === 0) {
        console.warn('[P2P] ⚠️ WARNING: No local content found! This may indicate:');
        console.warn('  - No posts or files have been created yet');
        console.warn('  - IndexedDB is empty or not accessible');
        console.warn('  - Content scanning failed');
      }

      const shouldStartRendezvous = this.rendezvousEnabled || this.rendezvousPendingStart;

      if (shouldStartRendezvous) {
        this.rendezvousEnabled = true;
        this.rendezvousPendingStart = false;
        console.log('[P2P] 🌐 Rendezvous mesh enabled, initializing...');
        try {
          await this.initializeRendezvousMesh();
        } catch (error) {
          console.error('[P2P] ❌ Rendezvous mesh initialization failed:', error);
        }
      } else {
        console.log('[P2P] 🌐 Rendezvous mesh disabled for this session');
      }

      // Announce presence to all connected peers
      console.log('[P2P] 📢 Announcing presence to network...');
      this.announcePresence();
      
      // Set up periodic announcements
      let announceCount = 0;
      this.announceInterval = window.setInterval(() => {
        announceCount++;
        const content = this.discovery.getLocalContent();
        console.log(`[P2P] 📢 Periodic announce #${announceCount}: ${content.length} items`);
        this.announcePresence();
        
        // Log stats periodically
        if (announceCount % 3 === 0) {
          const stats = this.getStats();
          console.log('[P2P] 📊 Current stats:', JSON.stringify(stats, null, 2));
        }
      }, 30000); // Every 30 seconds
      
      // Set up cleanup
      this.cleanupInterval = window.setInterval(() => {
        this.discovery.cleanup();
        this.chunkProtocol.cleanup();
      }, 60000); // Every minute
      
      // Start health monitoring
      this.healthMonitor.start();

      this.startPingInterval();

      // Start gossip protocol for continuous peer discovery
      console.log('[P2P] 🗣️ Starting gossip protocol...');
      this.gossip.start();
      
      // Auto-join global room for easy peer discovery
      console.log('[P2P] 🚪 Auto-joining global discovery room...');
      this.roomDiscovery.joinRoom('swarm-space-global');
      
      // State 1→2: Connected to signaling, now waiting for peers
      this.status = 'waiting';
      console.log('[P2P] 📡 State 1→2: Connected to signaling, waiting for peer discovery...');
      
      // Automatic peer discovery via rendezvous mesh when available
      const rendezvousReady = this.rendezvousEnabled && this.hasRendezvousEndpoints();
      const discoveryMode = rendezvousReady ? 'rendezvous mesh' : 'bootstrap registry';
      console.log(`[P2P] 🔍 Starting automatic peer discovery via ${discoveryMode}...`);
      const discoveryAttempt = this.discoverAndConnectPeers('initial').catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        console.log('[P2P] ℹ️ Automatic discovery attempt failed:', message);
      });

      // Attempt automatic connections to bootstrap peers
      this.connectToBootstrapPeers();
      this.maintainMeshConnectivity('startup');

      // Wait briefly for discovery to complete, then check for connections
      setTimeout(() => {
        const connectedPeers = this.peerjs.getConnectedPeers();
        console.log(`[P2P] 🔍 Post-discovery check: ${connectedPeers.length} peers connected`);

        if (connectedPeers.length === 0) {
          console.log('[P2P] 💡 No peers found via initial discovery.');
          console.log('[P2P] 🔄 Will continue trying via periodic reconnect and gossip...');
        }
      }, 5000);
      
      // Set up periodic reconnection and discovery attempts
      this.reconnectInterval = window.setInterval(() => {
        this.connectToBootstrapPeers();
        this.discoverAndConnectPeers('interval').catch(() => {});
        this.maintainMeshConnectivity('interval');

        // Update status based on peer count
        const connectedPeers = this.peerjs.getConnectedPeers();
        if (connectedPeers.length > 0 && this.status === 'waiting') {
          this.status = 'online';
          console.log('[P2P] 🎉 State 2→3: Swarm formation! Connected to peers.');
        } else if (connectedPeers.length === 0 && this.status === 'online') {
          this.status = 'waiting';
          console.log('[P2P] ⚠️ State 3→2: All peers disconnected, waiting for reconnection...');
        }
      }, 30000); // Every 30 seconds
      const finalStats = this.getStats();
      console.log('[P2P] ✅ P2P MANAGER STARTED SUCCESSFULLY!');
      console.log('[P2P] 📊 Final stats:', JSON.stringify(finalStats, null, 2));
      console.log('[P2P] 💡 Your Peer ID:', this.peerId);
      console.log('[P2P] 🔗 Share this ID with others to connect!');
      console.log('[P2P] 🌐 Bootstrap registry:', this.bootstrap.getStats());
      
    } catch (error) {
      console.error('[P2P] ❌ FAILED TO START:', error);
      this.status = 'offline';
      throw error;
    }
  }

  /**
   * Stop P2P networking
   */
  stop(): void {
    console.log('[P2P] Stopping P2P manager...');

    if (this.announceInterval) {
      clearInterval(this.announceInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    this.stopPingInterval();
    this.pendingPings.clear();
    this.clearRendezvousTimers();
    this.rendezvousPeerCache.clear();
    this.rendezvousTicket = undefined;
    this.lastRendezvousSync = 0;
    this.rendezvousPendingStart = false;

    this.gossip.stop();
    this.healthMonitor.stop();
    this.peerjs.destroy();
    this.status = 'offline';
    this.peerId = null;

    this.pendingInboundPeers.clear();
    this.pendingOutboundConnections.clear();
    this.emitPendingPeerUpdate();

    void this.metrics.stopSession();

    console.log('[P2P] P2P manager stopped');
  }

  /**
   * Connect to a peer by their ID
   */
  connectToPeer(peerId: string, options: ConnectOptions = {}): boolean {
    const { manual = false, source = manual ? 'manual' : 'auto', allowDuringIsolation = false } = options;

    if (!peerId) {
      console.warn('[P2P] ⚠️ connectToPeer called without a peer ID');
      return false;
    }

    if (this.isPeerBlocked(peerId)) {
      console.log(`[P2P] 🚫 Connection to ${peerId} blocked by user control.`);
      return false;
    }

    if (this.isPaused()) {
      console.log(`[P2P] ⏸️ Connection to ${peerId} blocked (${source}) because networking is paused.`);
      return false;
    }

    if (!manual && !this.canAutoConnect()) {
      console.log(`[P2P] ⛔ Auto-connection to ${peerId} ignored (${source}) due to user controls`, this.controlState);
      return false;
    }

    if (!manual && this.controlState.isolate && !allowDuringIsolation) {
      console.log(`[P2P] 🛡️ Isolation active - skipping auto connection to ${peerId} (${source})`);
      return false;
    }

    console.log(`[P2P] Connecting to peer (${source}):`, peerId);
    this.pendingOutboundConnections.add(peerId);
    this.peerjs.connectToPeer(peerId);
    return true;
  }

  /**
   * Manually disconnect from a peer
   */
  disconnectFromPeer(peerId: string): void {
    if (!peerId) {
      return;
    }

    console.log('[P2P] Manually disconnecting from peer:', peerId);
    this.pendingOutboundConnections.delete(peerId);
    this.peerjs.disconnectFrom(peerId);
  }

  /**
   * Reconnect to a peer (after connection loss)
   */
  private reconnectToPeer(peerId: string): void {
    console.log('[P2P] Attempting reconnection to peer:', peerId);
    this.healthMonitor.removeConnection(peerId);
    this.peerjs.connectToPeer(peerId);
  }

  /**
   * Discover and connect to peers automatically using the rendezvous mesh.
   * Falls back to bootstrap registry + gossip when mesh is disabled.
   */
  private async discoverAndConnectPeers(trigger: 'initial' | 'interval' = 'interval'): Promise<void> {
    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Auto-discovery skipped (${trigger}) due to user controls`, this.controlState);
      return;
    }

    const rendezvousConfigured = this.rendezvousEnabled && this.hasRendezvousEndpoints();

    if (!rendezvousConfigured) {
      console.log('[P2P] ℹ️ Rendezvous mesh disabled or not configured; relying on bootstrap registry and gossip');
      return;
    }

    console.log(`[P2P] 🔍 Triggering rendezvous mesh refresh (${trigger})...`);
    await this.refreshRendezvousMesh(`discover:${trigger}`);
  }

  /**
   * Connect to bootstrap peers automatically
   */
  private connectToBootstrapPeers(): void {
    if (!this.canAutoConnect()) {
      console.log('[P2P] ⏸️ Bootstrap auto-connect suppressed due to user controls', this.controlState);
      return;
    }

    const connectedPeers = new Set(this.peerjs.getConnectedPeers());
    const bestPeers = this.bootstrap.getBestPeers(5);
    
    console.log(`[P2P] 🔄 Auto-connect: ${connectedPeers.size} connected, ${bestPeers.length} in registry`);
    
    // Connect to best peers that we're not already connected to
    let attempted = 0;
    for (const peer of bestPeers) {
      if (!connectedPeers.has(peer.peerId) && peer.peerId !== this.peerId) {
        console.log(`[P2P] 🔗 Auto-connecting to peer: ${peer.peerId} (reliability: ${peer.reliability.toFixed(2)})`);
        if (this.connectToPeer(peer.peerId, { source: 'bootstrap' })) {
          attempted++;
        }
      }
    }
    
    if (attempted === 0 && bestPeers.length === 0) {
      console.log('[P2P] ℹ️ No bootstrap peers in registry');
    }
  }

  /**
   * Announce presence with available content
   */
  private announcePresence(): void {
    if (this.isPaused()) {
      return;
    }

    const localContent = this.discovery.getLocalContent();
    const currentRoom = this.roomDiscovery.getCurrentRoom();

    this.peerjs.broadcast('announce', {
      userId: this.localUserId,
      peerId: this.peerId,
      availableContent: localContent,
      room: currentRoom,
      timestamp: Date.now()
    });
  }

  /**
   * Request a chunk from the P2P network
   */
  async requestChunk(chunkHash: string): Promise<Uint8Array | null> {
    const peerId = this.discovery.getBestPeerForContent(chunkHash);

    if (!peerId) {
      console.log(`[P2P] No peers have chunk ${chunkHash}`);
      return null;
    }

    console.log(`[P2P] Requesting chunk ${chunkHash} from peer ${peerId}`);
    return await this.chunkProtocol.requestChunk(peerId, chunkHash);
  }

  async ensureManifest(
    manifestId: string,
    options: EnsureManifestOptions = {}
  ): Promise<Manifest | null> {
    if (!manifestId) {
      return null;
    }

    const manifest = await this.ensureSingleManifest(manifestId, options.sourcePeerId);
    if (!manifest) {
      return null;
    }

    if (options.includeChunks !== false) {
      await this.ensureChunksForManifest(manifest, options.sourcePeerId);
    }

    return manifest;
  }

  /**
   * Announce new local content
   */
  announceContent(manifestHash: string): void {
    this.discovery.addLocalContent(manifestHash);
    this.peerjs.broadcast('content-available', {
      manifestHashes: [manifestHash]
    });
  }

  /**
   * Check if content is available on network
   */
  isContentAvailable(manifestHash: string): boolean {
    return this.discovery.isContentAvailable(manifestHash);
  }

  /**
   * Get peers that have specific content
   */
  getPeersWithContent(manifestHash: string): string[] {
    return this.discovery.getPeersWithContent(manifestHash);
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  async setRendezvousEnabled(enabled: boolean): Promise<void> {
    if (this.rendezvousEnabled === enabled && (!enabled || !this.rendezvousPendingStart)) {
      return;
    }

    this.rendezvousEnabled = enabled;
    this.options.rendezvous = {
      ...(this.options.rendezvous ?? {}),
      enabled
    };

    if (!enabled) {
      this.rendezvousPendingStart = false;
      this.clearRendezvousTimers();
      this.rendezvousPeerCache.clear();
      this.lastRendezvousSync = 0;
      return;
    }

    if (!this.peerId) {
      console.log('[P2P] Rendezvous mesh will start once PeerJS is ready');
      this.rendezvousPendingStart = true;
      return;
    }

    this.rendezvousPendingStart = false;
    await this.initializeRendezvousMesh();
  }

  private async initializeRendezvousMesh(): Promise<void> {
    if (!this.peerId) {
      throw new Error('Cannot initialize rendezvous mesh without a peer ID');
    }

    const beaconEndpoints = this.getBeaconEndpoints();
    const capsuleSources = this.getCapsuleSources();

    if (beaconEndpoints.length === 0 && capsuleSources.length === 0) {
      console.warn('[P2P] Rendezvous mesh enabled but no endpoints configured');
      return;
    }

    try {
      await this.refreshRendezvousMesh('startup');
    } catch (error) {
      console.error('[P2P] Rendezvous mesh refresh failed during initialization:', error);
    }

    this.clearRendezvousTimers();
    const interval = Math.max(30_000, this.rendezvousConfig.refreshIntervalMs);
    this.rendezvousPollInterval = window.setInterval(() => {
      void this.refreshRendezvousMesh('interval');
    }, interval);
  }

  private ensureRendezvousSigner(): Promise<PresenceTicketSigner> {
    if (!this.rendezvousSignerPromise) {
      this.rendezvousSignerPromise = loadRendezvousSigner();
    }
    return this.rendezvousSignerPromise;
  }

  private async refreshRendezvousMesh(reason: string): Promise<void> {
    if (!this.peerId || !this.rendezvousEnabled) {
      return;
    }
    if (this.rendezvousInFlight) {
      console.log('[P2P] Rendezvous refresh already running, skipping', reason);
      return;
    }

    this.rendezvousInFlight = true;

    try {
      const now = Date.now();
      const records: RendezvousPeerRecord[] = [];
      const beaconEndpoints = this.getBeaconEndpoints();

      if (beaconEndpoints.length > 0) {
        let announcement = this.rendezvousTicket;
        if (!announcement || announcement.payload.expiresAt - 5000 < now) {
          try {
            announcement = await this.createPresenceAnnouncement(now);
          } catch (error) {
            console.error('[P2P] Unable to create presence ticket for rendezvous mesh:', error);
            announcement = undefined;
          }
        }

        if (!announcement) {
          console.warn('[P2P] Rendezvous mesh could not create presence ticket; requesting anonymous peer list');
        }
        try {
          const trustedTickets = this.rendezvousConfig.trustedTicketPublicKeys;
          const beaconRecords = await fetchBeaconPeers(beaconEndpoints, announcement, {
            now,
            trustedPublicKeys: trustedTickets.length > 0 ? trustedTickets : undefined
          });
          records.push(...beaconRecords);
        } catch (error) {
          console.error('[P2P] Beacon rendezvous fetch failed:', error);
        }
      }

      const capsuleSources = this.getCapsuleSources();
      if (capsuleSources.length > 0) {
        try {
          const trustedCapsules = this.rendezvousConfig.trustedCapsulePublicKeys;
          const capsuleRecords = await fetchCapsulePeers(capsuleSources, {
            now,
            trustedPublicKeys: trustedCapsules.length > 0 ? trustedCapsules : undefined
          });
          records.push(...capsuleRecords);
        } catch (error) {
          console.error('[P2P] Capsule rendezvous fetch failed:', error);
        }
      }

      if (records.length > 0) {
        this.mergeRendezvousRecords(records);
        this.lastRendezvousSync = now;
      }
    } finally {
      this.rendezvousInFlight = false;
    }
  }

  private async createPresenceAnnouncement(now: number): Promise<PresenceTicketEnvelope> {
    if (!this.peerId) {
      throw new Error('Cannot create presence announcement without a peer ID');
    }
    const signer = await this.ensureRendezvousSigner();
    this.rendezvousTicket = await createPresenceTicket({
      peerId: this.peerId,
      userId: this.localUserId,
      signer,
      ttlMs: this.rendezvousConfig.ticketTtlMs,
      now
    });
    return this.rendezvousTicket;
  }

  private mergeRendezvousRecords(records: RendezvousPeerRecord[]): void {
    const now = Date.now();
    const connectedPeers = new Set(this.peerjs.getConnectedPeers());

    for (const record of records) {
      const key = `${record.peerId}:${record.userId}`;
      const existing = this.rendezvousPeerCache.get(key);
      if (!existing || existing.expiresAt < record.expiresAt) {
        this.rendezvousPeerCache.set(key, record);
      }

      if (record.peerId === this.peerId) {
        continue;
      }

      this.bootstrap.addPeer(record.peerId, record.userId, true);
      this.discovery.registerPeer(record.peerId, record.userId, []);

      this.peerExchange.updatePeer({
        peerId: record.peerId,
        userId: record.userId,
        lastSeen: now,
        reliability: 0.8,
        contentCount: 0
      });

      if (!connectedPeers.has(record.peerId)) {
        this.connectToPeer(record.peerId, { source: 'rendezvous' });
      }
    }

    if (records.length > 0) {
      this.gossip.triggerGossip();
      const peerIds = Array.from(new Set(records
        .map(record => record.peerId)
        .filter(peerId => peerId && peerId !== this.peerId)));
      if (peerIds.length > 0) {
        this.maintainMeshConnectivity('rendezvous', peerIds);
      }
    }

    for (const [key, record] of this.rendezvousPeerCache.entries()) {
      if (record.expiresAt < now) {
        this.rendezvousPeerCache.delete(key);
      }
    }
  }

  private clearRendezvousTimers(): void {
    if (this.rendezvousPollInterval) {
      clearInterval(this.rendezvousPollInterval);
      this.rendezvousPollInterval = undefined;
    }
  }

  private getBeaconEndpoints(): BeaconEndpoint[] {
    return this.rendezvousConfig.beacons.map(endpoint => ({
      ...endpoint,
      community: endpoint.community ?? this.rendezvousConfig.community
    }));
  }

  private getCapsuleSources(): CapsuleSource[] {
    return this.rendezvousConfig.capsules;
  }

  private hasRendezvousEndpoints(): boolean {
    return this.rendezvousConfig.beacons.length > 0 || this.rendezvousConfig.capsules.length > 0;
  }

  private startPingInterval(): void {
    if (typeof window === 'undefined') return;
    if (this.pingInterval) return;
    this.pingInterval = window.setInterval(() => {
      this.sendPings();
    }, 20000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  private sendPings(): void {
    if (this.isPaused()) {
      return;
    }

    const peers = this.peerjs.getConnectedPeers();
    for (const peerId of peers) {
      this.sendPing(peerId);
    }
  }

  private sendPing(peerId: string): void {
    const sentAt = Date.now();
    const sent = this.peerjs.sendToPeer(peerId, 'ping', { sentAt });
    if (sent) {
      this.pendingPings.set(peerId, sentAt);
      this.healthMonitor.recordPing(peerId);
      this.metrics.recordPing();
    }
  }

  private handleChunkTransfer(update: ChunkTransferUpdate): void {
    if (update.direction === 'upload') {
      this.metrics.recordBytesUploaded(update.bytes);
      this.metrics.recordRelay();
    } else {
      this.metrics.recordBytesDownloaded(update.bytes);
    }
  }

  /**
   * Get P2P statistics
   */
  getStats(): P2PStats {
    const connectedPeers = this.peerjs.getConnectedPeers();
    const discoveredPeers = this.discovery.getAllPeers();
    const discoveryStats = this.discovery.getStats();
    const chunkStats = this.chunkProtocol.getStats();

    // Update status based on signaling connection and peer count
    const hasSignaling = this.peerjs.isSignalingActive();
    const hasPeers = connectedPeers.length > 0;

    if (this.isPaused()) {
      this.status = 'waiting';
    } else if (!hasSignaling) {
      // Lost signaling connection
      this.status = 'connecting';
    } else if (hasSignaling && !hasPeers) {
      // Connected to signaling but no peers yet - always set to waiting
      this.status = 'waiting';
    } else if (hasSignaling && hasPeers) {
      // Has both signaling and peers - full swarm mode
      this.status = 'online';
    }

    const metricsSnapshot = this.metrics.getSnapshot();

    return {
      status: this.status,
      connectedPeers: connectedPeers.length,
      discoveredPeers: discoveredPeers.length,
      localContent: discoveryStats.localContent,
      networkContent: discoveryStats.totalContent,
      activeRequests: chunkStats.activeRequests,
      rendezvousPeers: this.rendezvousPeerCache.size,
      lastRendezvousSync: this.lastRendezvousSync === 0 ? null : this.lastRendezvousSync,
      uptimeMs: metricsSnapshot.uptimeMs,
      bytesUploaded: metricsSnapshot.bytesUploaded,
      bytesDownloaded: metricsSnapshot.bytesDownloaded,
      relayCount: metricsSnapshot.relayCount,
      pingCount: metricsSnapshot.pingCount
    };
  }

  /**
   * Get discovered peers
   */
  getDiscoveredPeers() {
    return this.discovery.getAllPeers();
  }

  /**
   * Broadcast a post to all connected peers
   */
  broadcastPost(post: Post): void {
    this.postSync.broadcastPost(post);
  }

  /**
   * Broadcast a comment to all connected peers
   */
  broadcastComment(comment: Comment): void {
    this.commentSync.broadcastComment(comment);
  }

  /**
   * Join a discovery room
   */
  joinRoom(roomName: string): void {
    this.roomDiscovery.joinRoom(roomName);
    // Announce immediately so others in the room can find us
    this.announcePresence();
  }

  /**
   * Leave current discovery room
   */
  leaveRoom(): void {
    this.roomDiscovery.leaveRoom();
  }

  /**
   * Get current room name
   */
  getCurrentRoom(): string | null {
    return this.roomDiscovery.getCurrentRoom();
  }

  // Private methods

  private resolvePeerUserId(peerId: string, providedUserId?: string | null): string | null {
    if (providedUserId && typeof providedUserId === 'string') {
      return providedUserId;
    }

    const metadataUserId = this.extractUserId(this.peerjs.getConnectionMetadata(peerId));
    if (metadataUserId) {
      return metadataUserId;
    }

    const discovered = this.discovery.getPeer(peerId);
    if (discovered?.userId) {
      return discovered.userId;
    }

    const pending = this.pendingInboundPeers.get(peerId);
    if (pending?.userId) {
      return pending.userId ?? null;
    }

    const bootstrapPeer = this.bootstrap.getPeer(peerId);
    if (bootstrapPeer?.userId) {
      return bootstrapPeer.userId;
    }

    return null;
  }

  private async syncConnectionRecord(peerId: string, providedUserId?: string | null): Promise<void> {
    try {
      const resolvedUserId = this.resolvePeerUserId(peerId, providedUserId);
      if (!resolvedUserId || resolvedUserId === this.localUserId) {
        return;
      }

      await createConnection(this.localUserId, resolvedUserId, resolvedUserId, peerId);
    } catch (error) {
      console.warn('[P2P] Failed to sync connection record for peer', peerId, error);
    }
  }

  private async clearConnectionPeer(peerId: string): Promise<void> {
    try {
      const connection = await getConnectionByPeerId(peerId);
      if (!connection) {
        return;
      }

      await updateConnectionPeerId(connection.id, null);
    } catch (error) {
      console.warn('[P2P] Failed to clear peer ID for connection', peerId, error);
    }
  }

  private setupEventHandlers(): void {
    // Handle new peer connections
    this.peerjs.onConnection((peerId) => {
      const initiatedLocally = this.pendingOutboundConnections.delete(peerId);

      if (this.isPeerBlocked(peerId)) {
        console.log(`[P2P] 🚫 Blocked peer attempted connection: ${peerId}`);
        this.peerjs.disconnectFrom(peerId);
        this.discovery.removePeer(peerId);
        return;
      }

      if (!initiatedLocally && this.controlState.manualAccept) {
        this.queueInboundPeer(peerId);
        this.peerjs.disconnectFrom(peerId);
        return;
      }

      if (this.pendingInboundPeers.delete(peerId)) {
        this.emitPendingPeerUpdate();
      }
      const wasWaiting = this.status === 'waiting';
      console.log(`[P2P] ✅ Peer connected: ${peerId}`);
      const resolvedUserId = this.resolvePeerUserId(peerId);
      
      // State transition: waiting → online when first peer connects
      if (wasWaiting) {
        this.status = 'online';
        console.log('[P2P] 🎉 State 2→3: First peer connected! Swarm formation begins.');
      }
      
      // Register with health monitor
      this.healthMonitor.registerConnection(peerId);
      void this.syncConnectionRecord(peerId, resolvedUserId);

      // Add to bootstrap registry (successful connection)
      this.bootstrap.addPeer(peerId, resolvedUserId ?? 'unknown', true);

      // Request peer list via PEX
      console.log(`[P2P] 🔄 Requesting peer list from ${peerId} (PEX)`);
      this.peerExchange.requestPeers(peerId);

      this.announcePresence(); // Send our content inventory
      this.postSync.handlePeerConnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer connection (posts):', err)
      );
      this.commentSync.handlePeerConnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer connection (comments):', err)
      );

      this.sendPing(peerId);
    });

    // Handle peer disconnections
    this.peerjs.onDisconnection((peerId) => {
      this.pendingOutboundConnections.delete(peerId);
      console.log(`[P2P] Peer disconnected: ${peerId}`);

      // Remove from health monitor
      this.healthMonitor.removeConnection(peerId);
      void this.clearConnectionPeer(peerId);
      this.pendingPings.delete(peerId);

      this.discovery.removePeer(peerId);
      this.postSync.handlePeerDisconnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer disconnection:', err)
      );
      
      // Check if we lost all peers
      const remainingPeers = this.peerjs.getConnectedPeers();
      if (remainingPeers.length === 0 && this.status === 'online') {
        this.status = 'waiting';
        console.log('[P2P] ⚠️ State 3→2: All peers disconnected, back to waiting state.');
      }
    });

    // Handle peer ready
    this.peerjs.onReady(() => {
      console.log('[P2P] PeerJS ready for connections');
    });

    // Handle signaling disconnection
    this.peerjs.onSignalingDisconnected(() => {
      console.log('[P2P] ⚠️ State N→1: Signaling lost, attempting reconnection...');
      this.status = 'connecting';
    });

    // Handle announce messages
    this.peerjs.onMessage('announce', (msg) => {
      const { userId, peerId, availableContent, room } = msg.payload as {
        userId: string;
        peerId: string;
        availableContent: string[];
        room?: string;
      };
      
      console.log(`[P2P] 📢 Received announce from peer ${peerId} (user: ${userId})`);
      console.log(`[P2P] 📢 Announce details: ${availableContent.length} items, room: ${room || 'none'}`);
      
      // Handle room-based discovery
      if (room) {
        console.log(`[P2P] 🚪 Processing room announcement for room: ${room}`);
        this.roomDiscovery.handleAnnouncement(peerId, userId, room);
      }
      
      // Update activity in health monitor
      this.healthMonitor.updateActivity(peerId);
      
      // Add to bootstrap registry
      this.bootstrap.addPeer(peerId, userId, true);
      
      const isNewPeer = this.discovery.registerPeer(
        peerId,
        userId,
        availableContent
      );
      void this.syncConnectionRecord(peerId, userId);

      // Update PEX knowledge so this peer can be shared with others
      this.peerExchange.updatePeer({
        peerId,
        userId,
        lastSeen: Date.now(),
        reliability: 1,
        contentCount: availableContent.length
      });

      if (isNewPeer) {
        console.log('[P2P] New peer discovered! Announcing back...');
        this.announcePresence();
      }

      this.maintainMeshConnectivity('announce', [peerId]);
    });

    // Handle content availability announcements
    this.peerjs.onMessage('content-available', (msg) => {
      const { manifestHashes } = msg.payload as { manifestHashes: string[] };
      const peerId = msg.from;
      
      console.log(`[P2P] Peer ${peerId} has ${manifestHashes.length} new items`);
      
      this.discovery.registerPeer(
        peerId,
        'unknown', // userId not provided in this message
        manifestHashes
      );
    });

    // Handle chunk protocol messages
    this.peerjs.onMessage('chunk', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      
      if (this.isChunkMessage(msg.payload)) {
        await this.chunkProtocol.handleMessage(peerId, msg.payload as ChunkMessage);
      }
    });

    // Handle post sync messages
    this.peerjs.onMessage('post', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      
      if (this.postSync.isPostSyncMessage(msg.payload)) {
        await this.postSync.handleMessage(peerId, msg.payload as PostSyncMessage);
      }
    });

    // Handle comment sync messages
    this.peerjs.onMessage('comment', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      
      if (this.commentSync.isCommentSyncMessage(msg.payload)) {
        await this.commentSync.handleMessage(peerId, msg.payload as CommentSyncMessage);
      }
    });

    // Handle PEX messages
    this.peerjs.onMessage('pex', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      
      if (this.isPEXMessage(msg.payload)) {
        await this.peerExchange.handleMessage(peerId, msg.payload as PEXMessage);
      }
    });

    // Handle gossip messages
    this.peerjs.onMessage('gossip', (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      
      if (this.isGossipMessage(msg.payload)) {
        this.gossip.handleMessage(msg.payload as GossipMessage, peerId);
      }
    });

    this.peerjs.onMessage('ping', (msg) => {
      const peerId = msg.from;
      const payload = msg.payload as { sentAt?: number } | undefined;
      const sentAt = typeof payload?.sentAt === 'number' ? payload.sentAt : Date.now();
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.peerjs.sendToPeer(peerId, 'pong', { sentAt, receivedAt: Date.now() });
    });

    this.peerjs.onMessage('pong', (msg) => {
      const peerId = msg.from;
      const payload = msg.payload as { sentAt?: number } | undefined;
      const fallback = this.pendingPings.get(peerId) ?? Date.now();
      const sentAt = typeof payload?.sentAt === 'number' ? payload.sentAt : fallback;
      const rtt = Math.max(0, Date.now() - sentAt);
      this.pendingPings.delete(peerId);
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.recordPong(peerId, rtt);
    });
  }

  private isChunkMessage(payload: unknown): payload is ChunkMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }

    const chunkTypes: Set<ChunkMessage['type']> = new Set([
      'request_chunk',
      'chunk_data',
      'chunk_not_found',
      'request_manifest',
      'manifest_data'
    ]);

    return chunkTypes.has((payload as ChunkMessage).type);
  }

  private isPEXMessage(payload: unknown): payload is PEXMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }
    const msg = payload as PEXMessage;
    return msg.type === 'pex_request' || msg.type === 'pex_response';
  }

  private isGossipMessage(payload: unknown): payload is GossipMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }
    return (payload as GossipMessage).type === 'gossip_peers';
  }

  /**
   * Handle peers discovered via PEX
   */
  private handlePEXDiscovery(newPeers: Array<{ peerId: string; userId: string; lastSeen: number; reliability: number; contentCount: number }>): void {
    console.log(`[P2P] 🎉 PEX discovered ${newPeers.length} new peers!`);
    
    for (const peer of newPeers) {
      // Add to bootstrap registry
      this.bootstrap.addPeer(peer.peerId, peer.userId, true);

      // Update PEX knowledge
      this.peerExchange.updatePeer(peer);

      // Attempt connection if not already connected
      if (!this.peerjs.isConnectedTo(peer.peerId) && peer.peerId !== this.peerId) {
        console.log(`[P2P] Auto-connecting to PEX peer: ${peer.peerId}`);
        this.connectToPeer(peer.peerId, { source: 'pex' });
      }
    }

    if (newPeers.length > 0) {
      this.maintainMeshConnectivity('pex');
    }
  }

  /**
   * Get peer list for gossip broadcasting
   */
  private getGossipPeerList(): Array<{ peerId: string; userId: string; lastSeen: number; contentCount: number }> {
    const peers = this.peerExchange.getKnownPeers();
    return peers.map(p => ({
      peerId: p.peerId,
      userId: p.userId,
      lastSeen: p.lastSeen,
      contentCount: p.contentCount
    }));
  }

  /**
   * Handle peers received via gossip
   */
  private handleGossipPeers(peers: Array<{ peerId: string; userId: string; lastSeen: number; contentCount: number }>): void {
    console.log(`[P2P] 📨 Gossip received ${peers.length} peer updates`);

    for (const peer of peers) {
      // Update bootstrap registry
      this.bootstrap.addPeer(peer.peerId, peer.userId, true);

      // Update PEX knowledge
      this.peerExchange.updatePeer({
        ...peer,
        reliability: 0.5 // Default reliability for gossiped peers
      });

      // Opportunistically connect to highly available peers
      if (!this.peerjs.isConnectedTo(peer.peerId) &&
          peer.peerId !== this.peerId &&
          peer.contentCount > 5) {
        console.log(`[P2P] Auto-connecting to gossiped peer: ${peer.peerId} (${peer.contentCount} items)`);
        this.connectToPeer(peer.peerId, { source: 'gossip' });
      }
    }

    if (peers.length > 0) {
      this.maintainMeshConnectivity('gossip');
    }
  }

  private maintainMeshConnectivity(reason: string, preferredPeerIds: string[] = []): void {
    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Mesh maintenance skipped (${reason}) due to user controls`, this.controlState);
      return;
    }

    const connected = new Set(this.peerjs.getConnectedPeers());
    const target = this.calculateTargetConnections();

    console.log(`[P2P] 🔧 Mesh maintenance (${reason}) - have ${connected.size}, target ${target}`);

    const tryConnect = (peerId: string | null | undefined) => {
      if (!peerId || peerId === this.peerId || connected.has(peerId)) {
        return;
      }
      if (this.isPeerBlocked(peerId)) {
        console.log(`[P2P] 🚫 Skipping blocked peer ${peerId}`);
        return;
      }
      if (this.connectToPeer(peerId, { source: `mesh:${reason}` })) {
        console.log(`[P2P] 🔗 Mesh connect (${reason}): ${peerId}`);
        connected.add(peerId);
      }
    };

    preferredPeerIds.forEach(tryConnect);

    if (connected.size >= target) {
      return;
    }

    const candidateScores = new Map<string, number>();
    const addCandidate = (peerId: string, score: number) => {
      if (!peerId || peerId === this.peerId || connected.has(peerId)) {
        return;
      }
      if (this.isPeerBlocked(peerId)) {
        return;
      }
      const existing = candidateScores.get(peerId);
      if (existing === undefined || score > existing) {
        candidateScores.set(peerId, score);
      }
    };

    for (const peer of this.discovery.getAllPeers()) {
      addCandidate(peer.peerId, peer.availableContent.size + 10);
    }

    for (const peer of this.bootstrap.getBestPeers(10)) {
      addCandidate(peer.peerId, peer.reliability * 100 + 5);
    }

    for (const peer of this.peerExchange.getKnownPeers()) {
      addCandidate(peer.peerId, peer.contentCount + peer.reliability * 50);
    }

    const sortedCandidates = Array.from(candidateScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxMeshConnections);

    for (const [peerId] of sortedCandidates) {
      if (connected.size >= target) {
        break;
      }
      tryConnect(peerId);
    }
  }

  private calculateTargetConnections(): number {
    const discovered = this.discovery.getAllPeers().length;
    const dynamicTarget = Math.max(this.desiredConnectionFloor, Math.ceil(discovered / 2));
    return Math.min(this.maxMeshConnections, Math.max(2, dynamicTarget));
  }

  private getManifestCandidatePeers(manifestId: string, sourcePeerId?: string): string[] {
    const candidates = new Set<string>();
    if (sourcePeerId) {
      candidates.add(sourcePeerId);
    }
    this.discovery.getPeersWithContent(manifestId).forEach(peerId => candidates.add(peerId));
    this.peerjs.getConnectedPeers().forEach(peerId => candidates.add(peerId));
    if (this.peerId) {
      candidates.delete(this.peerId);
    }
    return Array.from(candidates);
  }

  private async ensureManifestsAvailable(manifestIds: string[], sourcePeerId?: string): Promise<void> {
    const uniqueIds = Array.from(new Set(manifestIds.filter(Boolean)));

    for (const manifestId of uniqueIds) {
      try {
        const manifest = await this.ensureSingleManifest(manifestId, sourcePeerId);
        if (manifest) {
          await this.ensureChunksForManifest(manifest, sourcePeerId);
        }
      } catch (error) {
        console.error(`[P2P] Failed to synchronize manifest ${manifestId}:`, error);
      }
    }
  }

  private async ensureSingleManifest(manifestId: string, sourcePeerId?: string): Promise<Manifest | null> {
    const existing = await get<Manifest>('manifests', manifestId);
    const existingIsComplete =
      !!existing &&
      typeof existing.fileKey === 'string' &&
      existing.fileKey.length > 0 &&
      Array.isArray(existing.chunks) &&
      existing.chunks.length > 0;

    if (existingIsComplete) {
      return existing;
    }

    const candidates = this.getManifestCandidatePeers(manifestId, sourcePeerId);

    for (const peerId of candidates) {
      if (!peerId || peerId === this.peerId) {
        continue;
      }

      try {
        const manifest = await this.chunkProtocol.requestManifest(peerId, manifestId);
        if (manifest) {
          console.log(`[P2P] ✅ Retrieved manifest ${manifestId} from ${peerId}`);
          return manifest;
        }
      } catch (error) {
        console.error(`[P2P] Manifest request to ${peerId} failed:`, error);
      }
    }

    console.warn(`[P2P] ⚠️ Unable to retrieve manifest ${manifestId} from peers`);
    return existing ?? null;
  }

  private async ensureChunksForManifest(manifest: Manifest, sourcePeerId?: string): Promise<void> {
    const candidates = this.getManifestCandidatePeers(manifest.fileId, sourcePeerId);

    for (const chunkRef of manifest.chunks) {
      const existingChunk = await get<Chunk>('chunks', chunkRef);
      if (existingChunk) {
        continue;
      }

      let fulfilled = false;

      for (const peerId of candidates) {
        if (!peerId || peerId === this.peerId) {
          continue;
        }

        try {
          const data = await this.chunkProtocol.requestChunk(peerId, chunkRef);
          if (data) {
            console.log(`[P2P] ✅ Retrieved chunk ${chunkRef} from ${peerId}`);
            fulfilled = true;
            break;
          }
        } catch (error) {
          console.error(`[P2P] Chunk request ${chunkRef} from ${peerId} failed:`, error);
        }
      }

      if (!fulfilled) {
        console.warn(`[P2P] ⚠️ Chunk ${chunkRef} for manifest ${manifest.fileId} could not be synchronized`);
      }
    }
  }
}
