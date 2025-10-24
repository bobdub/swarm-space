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
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;
  private peerId: string | null = null;

  constructor(private localUserId: string) {
    console.log('[P2P] Initializing P2P Manager with PeerJS');
    console.log('[P2P] 🌐 Using PeerJS cloud signaling (zero config)');
    console.log('[P2P] User ID:', localUserId);
    
    this.peerjs = new PeerJSAdapter(localUserId);
    this.discovery = new PeerDiscovery('pending', localUserId);

    // Chunk protocol sends messages via PeerJS
    this.chunkProtocol = new ChunkProtocol(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'chunk', message)
    );

    // Post sync sends messages via PeerJS
    this.postSync = new PostSyncManager(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'post', message),
      () => this.peerjs.getConnectedPeers()
    );

    this.setupEventHandlers();
  }

  /**
   * Start P2P networking
   */
  async start(): Promise<void> {
    console.log('[P2P] Starting P2P manager...');
    this.status = 'connecting';
    
    try {
      // Initialize PeerJS connection
      this.peerId = await this.peerjs.initialize();
      console.log('[P2P] ✅ PeerJS initialized with ID:', this.peerId);
      
      // Update discovery with our peer ID
      this.discovery = new PeerDiscovery(this.peerId, this.localUserId);
      
      // Scan local content
      await this.discovery.scanLocalContent();
      const localContent = this.discovery.getLocalContent();
      console.log('[P2P] Local content count:', localContent.length);
      
      // Announce presence to all connected peers
      this.announcePresence();
      
      // Set up periodic announcements
      let announceCount = 0;
      this.announceInterval = window.setInterval(() => {
        announceCount++;
        const content = this.discovery.getLocalContent();
        console.log(`[P2P] Announcing (${announceCount}): ${content.length} items`);
        this.announcePresence();
        
        // Log stats periodically
        if (announceCount % 3 === 0) {
          const stats = this.getStats();
          console.log('[P2P] Stats:', stats);
        }
      }, 30000); // Every 30 seconds
      
      // Set up cleanup
      this.cleanupInterval = window.setInterval(() => {
        this.discovery.cleanup();
        this.chunkProtocol.cleanup();
      }, 60000); // Every minute
      
      this.status = 'online';
      console.log('[P2P] ✅ P2P manager started successfully');
      console.log('[P2P] 💡 Share your Peer ID to connect with others:', this.peerId);
      
    } catch (error) {
      console.error('[P2P] Failed to start:', error);
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
      this.announcePresence(); // Send our content inventory
      this.postSync.handlePeerConnected(peerId).catch(err => 
        console.error('[P2P] Error handling peer connection:', err)
      );
    });

    // Handle peer disconnections
    this.peerjs.onDisconnection((peerId) => {
      console.log(`[P2P] Peer disconnected: ${peerId}`);
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
      
      if (this.isChunkMessage(msg.payload)) {
        await this.chunkProtocol.handleMessage(peerId, msg.payload as ChunkMessage);
      }
    });

    // Handle post sync messages
    this.peerjs.onMessage('post', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      
      if (this.postSync.isPostSyncMessage(msg.payload)) {
        await this.postSync.handleMessage(peerId, msg.payload as PostSyncMessage);
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
}
