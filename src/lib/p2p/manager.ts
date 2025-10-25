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
import { BootstrapRegistry } from './bootstrap';
import { ConnectionHealthMonitor } from './connectionHealth';
import { PeerExchangeProtocol, type PEXMessage } from './peerExchange';
import { GossipProtocol, type GossipMessage } from './gossip';
import type { Post } from '@/types';

export type P2PStatus = 'offline' | 'connecting' | 'online';

export interface P2PStats {
  status: P2PStatus;
  connectedPeers: number;
  discoveredPeers: number;
  localContent: number;
  networkContent: number;
  activeRequests: number;
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
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;
  private reconnectInterval?: number;
  private peerId: string | null = null;

  constructor(private localUserId: string) {
    console.log('[P2P] Initializing P2P Manager with PeerJS');
    console.log('[P2P] 🌐 Using PeerJS cloud signaling (zero config)');
    console.log('[P2P] 🔄 Pure P2P discovery via PEX + Gossip');
    console.log('[P2P] User ID:', localUserId);
    
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
      
      // Automatic peer discovery from PeerJS network
      console.log('[P2P] 🔍 Starting automatic peer discovery...');
      await this.discoverAndConnectPeers();
      
      // Attempt automatic connections to bootstrap peers
      this.connectToBootstrapPeers();
      
      // Set up periodic reconnection and discovery attempts
      this.reconnectInterval = window.setInterval(() => {
        this.connectToBootstrapPeers();
        this.discoverAndConnectPeers();
      }, 120000); // Every 2 minutes
      
      this.status = 'online';
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
      const connectedPeers = new Set(this.peerjs.getConnectedPeers());
      
      // Filter out ourselves and already connected peers
      const availablePeers = allPeers.filter(
        id => id !== this.peerId && !connectedPeers.has(id)
      );
      
      if (availablePeers.length === 0) {
        console.log('[P2P] ℹ️ No other peers discovered via network listing');
        console.log('[P2P] 💡 Relying on bootstrap registry and PEX/Gossip for peer discovery');
        return;
      }
      
      console.log(`[P2P] 🎉 Found ${availablePeers.length} available peers!`);
      
      // Connect to up to 5 random peers to bootstrap the swarm
      const peersToConnect = availablePeers
        .sort(() => Math.random() - 0.5) // Randomize
        .slice(0, 5);
      
      console.log(`[P2P] 🔗 Auto-connecting to ${peersToConnect.length} peers...`);
      for (const peerId of peersToConnect) {
        console.log(`[P2P] Connecting to discovered peer: ${peerId}`);
        this.connectToPeer(peerId);
      }
    } catch (error) {
      console.log('[P2P] ℹ️ Automatic peer discovery unavailable (this is normal)');
      console.log('[P2P] 💡 Using bootstrap registry + PEX/Gossip for peer discovery instead');
      // Non-fatal - we'll use bootstrap + PEX/Gossip instead
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
    this.peerjs.broadcast('announce', {
      userId: this.localUserId,
      peerId: this.peerId,
      availableContent: localContent,
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

  /**
   * Get P2P statistics
   */
  getStats(): P2PStats {
    const connectedPeers = this.peerjs.getConnectedPeers();
    const discoveredPeers = this.discovery.getAllPeers();
    const discoveryStats = this.discovery.getStats();
    const chunkStats = this.chunkProtocol.getStats();

    return {
      status: this.status,
      connectedPeers: connectedPeers.length,
      discoveredPeers: discoveredPeers.length,
      localContent: discoveryStats.localContent,
      networkContent: discoveryStats.totalContent,
      activeRequests: chunkStats.activeRequests
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

  // Private methods

  private setupEventHandlers(): void {
    // Handle new peer connections
    this.peerjs.onConnection((peerId) => {
      console.log(`[P2P] ✅ Peer connected: ${peerId}`);
      
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
    });

    // Handle peer ready
    this.peerjs.onReady(() => {
      console.log('[P2P] PeerJS ready for connections');
    });

    // Handle announce messages
    this.peerjs.onMessage('announce', (msg) => {
      const { userId, peerId, availableContent } = msg.payload as {
        userId: string;
        peerId: string;
        availableContent: string[];
      };
      
      console.log(`[P2P] Peer ${peerId} (user: ${userId}) announced ${availableContent.length} items`);
      
      // Update activity in health monitor
      this.healthMonitor.updateActivity(peerId);
      
      // Add to bootstrap registry
      this.bootstrap.addPeer(peerId, userId, true);
      
      const isNewPeer = this.discovery.registerPeer(
        peerId,
        userId,
        availableContent
      );

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
