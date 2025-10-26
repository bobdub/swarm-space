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
import { ChunkProtocol, type ChunkMessage } from './chunkProtocol';
import { PeerDiscovery } from './discovery';
import { PostSyncManager, type PostSyncMessage } from './postSync';
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
}

interface RendezvousOptions {
  enabled: boolean;
  config?: RendezvousMeshConfig;
}

interface P2PManagerOptions {
  rendezvous?: RendezvousOptions;
}

export class P2PManager {
  private peerjs: PeerJSAdapter;
  private chunkProtocol: ChunkProtocol;
  private discovery: PeerDiscovery;
  private postSync: PostSyncManager;
  private bootstrap: BootstrapRegistry;
  private healthMonitor: ConnectionHealthMonitor;
  private peerExchange: PeerExchangeProtocol;
  private gossip: GossipProtocol;
  private roomDiscovery: RoomDiscovery;
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;
  private reconnectInterval?: number;
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

  constructor(private localUserId: string, options: P2PManagerOptions = {}) {
    console.log('[P2P] Initializing P2P Manager with PeerJS');
    console.log('[P2P] 🌐 Using PeerJS cloud signaling (zero config)');
    console.log('[P2P] 🔄 Pure P2P discovery via PEX + Gossip');
    console.log('[P2P] User ID:', localUserId);

    this.options = options;
    const rendezvousConfig = options.rendezvous?.config ?? loadRendezvousConfig();
    this.rendezvousConfig = rendezvousConfig;
    this.rendezvousEnabled = options.rendezvous?.enabled ?? false;

    this.peerjs = new PeerJSAdapter(localUserId);
    this.discovery = new PeerDiscovery('pending', localUserId);
    this.bootstrap = new BootstrapRegistry();
    this.healthMonitor = new ConnectionHealthMonitor((peerId) => {
      console.log(`[P2P] Health monitor requesting reconnect to ${peerId}`);
      this.reconnectToPeer(peerId);
    });

    // Chunk protocol sends messages via PeerJS
    this.chunkProtocol = new ChunkProtocol(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'chunk', message)
    );

    // Post sync sends messages via PeerJS
    this.postSync = new PostSyncManager(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'post', message),
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
      this.connectToPeer(peerId);
    });

    this.setupEventHandlers();
  }

  /**
   * Start P2P networking
   */
  async start(): Promise<void> {
    console.log('[P2P] 🚀 Starting P2P manager...');
    console.log('[P2P] User ID:', this.localUserId);
    this.status = 'connecting';
    
    try {
      // Initialize PeerJS connection
      console.log('[P2P] 🔌 Initializing PeerJS...');
      this.peerId = await this.peerjs.initialize();
      console.log('[P2P] ✅ PeerJS initialized with ID:', this.peerId);
      
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

      if (this.rendezvousEnabled) {
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
      
      // Start gossip protocol for continuous peer discovery
      console.log('[P2P] 🗣️ Starting gossip protocol...');
      this.gossip.start();
      
      // Auto-join global room for easy peer discovery
      console.log('[P2P] 🚪 Auto-joining global discovery room...');
      this.roomDiscovery.joinRoom('swarm-space-global');
      
      // State 1→2: Connected to signaling, now waiting for peers
      this.status = 'waiting';
      console.log('[P2P] 📡 State 1→2: Connected to signaling, waiting for peer discovery...');
      
      // Automatic peer discovery from PeerJS network (non-blocking)
      console.log('[P2P] 🔍 Starting automatic peer discovery...');
      const discoveryAttempt = this.discoverAndConnectPeers().catch(err => {
        console.log('[P2P] ℹ️ Network discovery unavailable:', err.message);
      });
      
      // Attempt automatic connections to bootstrap peers
      this.connectToBootstrapPeers();
      
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
        this.discoverAndConnectPeers().catch(() => {});
        
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
    this.clearRendezvousTimers();
    this.rendezvousPeerCache.clear();
    this.rendezvousTicket = undefined;
    this.lastRendezvousSync = 0;

    this.gossip.stop();
    this.healthMonitor.stop();
    this.peerjs.destroy();
    this.status = 'offline';
    this.peerId = null;
    
    console.log('[P2P] P2P manager stopped');
  }

  /**
   * Connect to a peer by their ID
   */
  connectToPeer(peerId: string): void {
    console.log('[P2P] Connecting to peer:', peerId);
    this.peerjs.connectToPeer(peerId);
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
   * Discover and connect to peers automatically via PeerJS network listing
   * Note: This may not work on all PeerJS servers, so it's non-blocking
   */
  private async discoverAndConnectPeers(): Promise<void> {
    try {
      console.log('[P2P] 🔍 Attempting to discover active peers on network...');
      const allPeers = await this.peerjs.listAllPeers();
      console.log(`[P2P] 📋 listAllPeers returned: ${allPeers.length} total peers`);
      console.log(`[P2P] 📋 My peer ID: ${this.peerId}`);
      
      const connectedPeers = new Set(this.peerjs.getConnectedPeers());
      console.log(`[P2P] 🔗 Already connected to: ${connectedPeers.size} peers`);
      
      // Filter out ourselves and already connected peers
      const availablePeers = allPeers.filter(
        id => id !== this.peerId && !connectedPeers.has(id)
      );
      
      if (availablePeers.length === 0) {
        console.log('[P2P] ℹ️ No other peers discovered via network listing');
        console.log('[P2P] 💡 Relying on bootstrap registry and PEX/Gossip for peer discovery');
        return;
      }
      
      console.log(`[P2P] 🎉 Found ${availablePeers.length} available peers to connect to!`);
      console.log(`[P2P] 📋 Available peer IDs:`, availablePeers.slice(0, 10));
      
      // Connect to up to 5 random peers to bootstrap the swarm
      const peersToConnect = availablePeers
        .sort(() => Math.random() - 0.5) // Randomize
        .slice(0, 5);
      
      console.log(`[P2P] 🔗 Auto-connecting to ${peersToConnect.length} peers...`);
      for (const peerId of peersToConnect) {
        console.log(`[P2P] 🔗 Initiating connection to discovered peer: ${peerId}`);
        this.connectToPeer(peerId);
        
        // Small delay between connections to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log('[P2P] ✅ Discovery and connection attempts complete');
    } catch (error) {
      console.error('[P2P] ❌ Automatic peer discovery failed:', error);
      console.log('[P2P] 💡 Using bootstrap registry + PEX/Gossip for peer discovery instead');
      // Non-fatal - we'll use bootstrap + PEX/Gossip instead
      throw error;
    }
  }

  /**
   * Connect to bootstrap peers automatically
   */
  private connectToBootstrapPeers(): void {
    const connectedPeers = new Set(this.peerjs.getConnectedPeers());
    const bestPeers = this.bootstrap.getBestPeers(5);
    
    console.log(`[P2P] 🔄 Auto-connect: ${connectedPeers.size} connected, ${bestPeers.length} in registry`);
    
    // Connect to best peers that we're not already connected to
    let attempted = 0;
    for (const peer of bestPeers) {
      if (!connectedPeers.has(peer.peerId) && peer.peerId !== this.peerId) {
        console.log(`[P2P] 🔗 Auto-connecting to peer: ${peer.peerId} (reliability: ${peer.reliability.toFixed(2)})`);
        this.connectToPeer(peer.peerId);
        attempted++;
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
    if (this.rendezvousEnabled === enabled) {
      return;
    }

    this.rendezvousEnabled = enabled;
    this.options.rendezvous = {
      ...(this.options.rendezvous ?? {}),
      enabled
    };

    if (!enabled) {
      this.clearRendezvousTimers();
      this.rendezvousPeerCache.clear();
      this.lastRendezvousSync = 0;
      return;
    }

    if (!this.peerId) {
      console.log('[P2P] Rendezvous mesh will start once PeerJS is ready');
      return;
    }

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
          console.warn('[P2P] Rendezvous mesh skipped beacon announce: no valid ticket');
        } else {
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

      if (!connectedPeers.has(record.peerId)) {
        this.connectToPeer(record.peerId);
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
    
    if (!hasSignaling) {
      // Lost signaling connection
      this.status = 'connecting';
    } else if (hasSignaling && !hasPeers) {
      // Connected to signaling but no peers yet - always set to waiting
      this.status = 'waiting';
    } else if (hasSignaling && hasPeers) {
      // Has both signaling and peers - full swarm mode
      this.status = 'online';
    }

    return {
      status: this.status,
      connectedPeers: connectedPeers.length,
      discoveredPeers: discoveredPeers.length,
      localContent: discoveryStats.localContent,
      networkContent: discoveryStats.totalContent,
      activeRequests: chunkStats.activeRequests,
      rendezvousPeers: this.rendezvousPeerCache.size,
      lastRendezvousSync: this.lastRendezvousSync === 0 ? null : this.lastRendezvousSync
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

  private setupEventHandlers(): void {
    // Handle new peer connections
    this.peerjs.onConnection((peerId) => {
      const wasWaiting = this.status === 'waiting';
      console.log(`[P2P] ✅ Peer connected: ${peerId}`);
      
      // State transition: waiting → online when first peer connects
      if (wasWaiting) {
        this.status = 'online';
        console.log('[P2P] 🎉 State 2→3: First peer connected! Swarm formation begins.');
      }
      
      // Register with health monitor
      this.healthMonitor.registerConnection(peerId);
      
      // Add to bootstrap registry (successful connection)
      this.bootstrap.addPeer(peerId, 'unknown', true);
      
      // Request peer list via PEX
      console.log(`[P2P] 🔄 Requesting peer list from ${peerId} (PEX)`);
      this.peerExchange.requestPeers(peerId);
      
      this.announcePresence(); // Send our content inventory
      this.postSync.handlePeerConnected(peerId).catch(err => 
        console.error('[P2P] Error handling peer connection:', err)
      );
    });

    // Handle peer disconnections
    this.peerjs.onDisconnection((peerId) => {
      console.log(`[P2P] Peer disconnected: ${peerId}`);
      
      // Remove from health monitor
      this.healthMonitor.removeConnection(peerId);
      
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
        this.connectToPeer(peer.peerId);
      }
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
        this.connectToPeer(peer.peerId);
      }
    }
  }
}
