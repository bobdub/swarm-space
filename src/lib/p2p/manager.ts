/**
 * P2P Manager
 * Orchestrates all P2P components: signaling, connections, discovery, and chunk protocol
 */

import { PeerConnectionManager } from './peerConnection';
import { SignalingChannel, type SignalingChannelOptions, generatePeerId } from './signaling';
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
  private peerConnection: PeerConnectionManager;
  private signaling: SignalingChannel;
  private chunkProtocol: ChunkProtocol;
  private discovery: PeerDiscovery;
  private postSync: PostSyncManager;
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;

  constructor(private localUserId: string) {
    const peerId = generatePeerId();
    
    this.peerConnection = new PeerConnectionManager(localUserId);

    const signalingOptions: SignalingChannelOptions = {
      signalingUrl: import.meta.env?.VITE_SIGNALING_URL as string | undefined
    };

    this.signaling = new SignalingChannel(peerId, localUserId, signalingOptions);
    this.discovery = new PeerDiscovery(peerId, localUserId);

    this.chunkProtocol = new ChunkProtocol(
      (peerId, message) => this.peerConnection.sendMessage(peerId, message)
    );

    this.postSync = new PostSyncManager(
      (peerId, message) => this.peerConnection.sendMessage(peerId, message),
      () => this.peerConnection.getConnectedPeers().map(peer => peer.id)
    );

    this.setupEventHandlers();
  }

  /**
   * Start P2P networking
   */
  async start(): Promise<void> {
    console.log('[P2P] Starting P2P manager...');
    console.log('[P2P] User ID:', this.localUserId);
    if (import.meta.env?.VITE_SIGNALING_URL) {
      console.log('[P2P] Using remote signaling server at', import.meta.env.VITE_SIGNALING_URL);
    } else {
      console.log('[P2P] No remote signaling configured. Discovery is limited to same-browser tabs.');
    }
    
    // Scan local content
    await this.discovery.scanLocalContent();
    const localContent = this.discovery.getLocalContent();
    console.log('[P2P] Local content count:', localContent.length);
    
    // Announce presence
    this.signaling.announce(localContent);
    
    // Set up periodic announcements with more frequent initial announcements
    let announceCount = 0;
    this.announceInterval = window.setInterval(() => {
      announceCount++;
      const content = this.discovery.getLocalContent();
      console.log(`[P2P] Announcing (${announceCount}): ${content.length} items to network`);
      this.signaling.announce(content);
      
      // Log stats every few announcements
      if (announceCount % 3 === 0) {
        const stats = this.getStats();
        console.log('[P2P] Stats:', stats);
      }
    }, 30000); // Every 30 seconds
    
    // Set up cleanup
    this.cleanupInterval = window.setInterval(() => {
      this.discovery.cleanup();
      this.peerConnection.cleanup();
      this.chunkProtocol.cleanup();
    }, 60000); // Every minute
    
    this.status = 'online';
    console.log('[P2P] P2P manager started successfully');
    console.log('[P2P] Open multiple tabs to test peer discovery');
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
    
    this.signaling.close();
    
    // Close all peer connections
    const peers = this.peerConnection.getConnectedPeers();
    peers.forEach(p => this.peerConnection.closePeer(p.id));
    
    this.status = 'offline';
    console.log('[P2P] P2P manager stopped');
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
    this.signaling.announceContent([manifestHash]);
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
   * Get P2P statistics
   */
  getStats(): P2PStats {
    const connectedPeers = this.peerConnection.getConnectedPeers();
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

  // Private methods

  private setupEventHandlers(): void {
    // Handle peer announcements
    this.signaling.on('announce', async (msg) => {
      console.log(`[P2P] ✓ Peer ${msg.from} (user: ${msg.userId}) announced with ${msg.payload.availableContent.length} items`);
      
      const isNewPeer = this.discovery.registerPeer(
        msg.from,
        msg.userId,
        msg.payload.availableContent
      );

      if (isNewPeer) {
        console.log(`[P2P] New peer discovered! Announcing back with ${this.discovery.getLocalContent().length} items`);
        this.signaling.announce(this.discovery.getLocalContent());
      } else {
        console.log('[P2P] Existing peer updated');
      }

      // Initiate connection if not already connected
      const peer = this.peerConnection.getPeer(msg.from);
      if (!peer || peer.state === 'disconnected') {
        console.log(`[P2P] Initiating WebRTC connection to peer ${msg.from}`);
        await this.initiateConnection(msg.from, msg.userId);
      } else {
        console.log(`[P2P] Already connected to peer ${msg.from} (state: ${peer.state})`);
      }
    });

    // Handle WebRTC offers
    this.signaling.on('offer', async (msg) => {
      console.log(`[P2P] Received offer from ${msg.from}`);

      try {
        const answer = await this.peerConnection.acceptOffer(
          msg.from,
          msg.userId,
          msg.payload.offer
        );
        this.signaling.sendAnswer(msg.from, answer);

        const peer = this.peerConnection.getPeer(msg.from);
        if (peer) {
          peer.connection.onicecandidate = (event) => {
            if (event.candidate) {
              this.signaling.sendIceCandidate(
                msg.from,
                event.candidate.toJSON()
              );
            }
          };
        }
      } catch (error) {
        console.error(`[P2P] Error accepting offer from ${msg.from}:`, error);
      }
    });

    // Handle WebRTC answers
    this.signaling.on('answer', async (msg) => {
      console.log(`[P2P] Received answer from ${msg.from}`);
      
      try {
        await this.peerConnection.acceptAnswer(msg.from, msg.payload.answer);
      } catch (error) {
        console.error(`[P2P] Error accepting answer from ${msg.from}:`, error);
      }
    });

    // Handle ICE candidates
    this.signaling.on('ice', async (msg) => {
      await this.peerConnection.addIceCandidate(msg.from, msg.payload.candidate);
    });

    // Handle content availability announcements
    this.signaling.on('available', (msg) => {
      const isNewPeer = this.discovery.registerPeer(
        msg.from,
        msg.userId,
        msg.payload.manifestHashes
      );

      if (isNewPeer) {
        this.signaling.announce(this.discovery.getLocalContent());
      }
    });

    // Handle peer goodbyes
    this.signaling.on('goodbye', (msg) => {
      console.log(`[P2P] Peer ${msg.from} left`);
      this.discovery.removePeer(msg.from);
      this.peerConnection.closePeer(msg.from);
    });

    // Handle peer connection state changes
    this.peerConnection.onDataChannelOpen((peerId) => {
      void this.postSync.handlePeerConnected(peerId);
    });

    this.peerConnection.onStateChange((peerId, state) => {
      console.log(`[P2P] Peer ${peerId} connection state: ${state}`);

      if (state === 'connected') {
        this.status = 'online';
      } else if (state === 'disconnected' || state === 'failed') {
        this.discovery.removePeer(peerId);
        void this.postSync.handlePeerDisconnected(peerId);
      }
    });

    // Handle incoming peer messages
    this.peerConnection.onMessage(async (peerId, message) => {
      this.discovery.updatePeerSeen(peerId);
      if (this.postSync.isPostSyncMessage(message)) {
        await this.postSync.handleMessage(peerId, message as PostSyncMessage);
        return;
      }

      if (this.isChunkMessage(message)) {
        await this.chunkProtocol.handleMessage(peerId, message as ChunkMessage);
        return;
      }

      console.warn('[P2P] Received unknown message type from peer', peerId, message);
    });
  }

  private async initiateConnection(remotePeerId: string, remoteUserId: string): Promise<void> {
    console.log(`[P2P] Initiating connection to ${remotePeerId}`);
    this.status = 'connecting';
    
    try {
      const offer = await this.peerConnection.createOffer(remotePeerId, remoteUserId);
      this.signaling.sendOffer(remotePeerId, offer);
      
      // Listen for ICE candidates
      const peer = this.peerConnection.getPeer(remotePeerId);
      if (peer) {
        peer.connection.onicecandidate = (event) => {
          if (event.candidate) {
            this.signaling.sendIceCandidate(remotePeerId, event.candidate.toJSON());
          }
        };
      }
    } catch (error) {
      console.error(`[P2P] Error initiating connection to ${remotePeerId}:`, error);
      this.status = 'online';
    }
  }

  broadcastPost(post: Post): void {
    this.postSync.broadcastPost(post);
  }

  private isChunkMessage(message: unknown): message is ChunkMessage {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return false;
    }

    const chunkTypes: Set<ChunkMessage['type']> = new Set([
      'request_chunk',
      'chunk_data',
      'chunk_not_found',
      'request_manifest',
      'manifest_data'
    ]);

    return chunkTypes.has((message as ChunkMessage).type);
  }
}
