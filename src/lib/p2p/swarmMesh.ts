/**
 * SWARM Mesh - Unified P2P Network System
 * 
 * Single unified mesh network combining:
 * - WebRTC DataChannels for direct P2P
 * - Gun.js mesh for relay and signaling
 * - WebTorrent DHT for discovery
 * - Blockchain mechanics for reputation and routing
 * - Dynamic timeouts based on connection quality
 * - Tab persistence for seamless reconnection
 * - Post and comment synchronization
 * - Peer list propagation from dev/bootstrap nodes
 * - Offline post queue with automatic delivery on connect
 */

import { IntegratedAdapter, type IntegratedAdapterOptions } from './transports/integratedAdapter';
import { GunAdapter, type GunAdapterOptions } from './transports/gunAdapter';
import { BlockchainP2PSync, type BlockchainSyncMessage } from '../blockchain/p2pSync';
import { PostSyncManager, type PostSyncMessage } from './postSync';
import type { TransportMessageHandler, TransportPeerListener } from './transports/types';
import { getSwarmChain } from '../blockchain/chain';
import type { Post, Comment } from '@/types';
import { loadKnownPeers, addKnownPeer, isAutoConnectEnabled } from './knownPeers';
import { startContentBridge, bridgeBroadcastPost } from './contentBridge';
import { PeerExchangeProtocol, type PeerInfo, type PEXMessage } from './peerExchange';

export interface SwarmMeshOptions {
  localPeerId: string;
  swarmId: string;
  trackers?: string[];
  gunPeers?: string[];
}

interface MeshPeer {
  peerId: string;
  connectedVia: 'direct' | 'relay' | 'both';
  connectionQuality: number; // 0-100
  lastSeen: number;
  reputation: number; // Blockchain-based reputation
  failureCount: number;
  successCount: number;
  avgLatency: number;
  blockchainActivity: number; // Transactions/blocks synced
}

interface TabState {
  peerId: string;
  timestamp: number;
  activePeers: string[];
  meshHealth: number;
}

const TAB_STATE_KEY = 'swarm-mesh-tab-state';
const TAB_SYNC_INTERVAL = 5000; // 5 seconds
const MIN_TIMEOUT = 5000; // 5 seconds
const MAX_TIMEOUT = 60000; // 60 seconds
const REPUTATION_WEIGHT = 0.3;
const QUALITY_WEIGHT = 0.4;
const BLOCKCHAIN_WEIGHT = 0.3;

export class SwarmMesh {
  private integrated: IntegratedAdapter;
  private gun: GunAdapter;
  private blockchainSync: BlockchainP2PSync;
  private postSync: PostSyncManager;
  private pex: PeerExchangeProtocol;
  private peers = new Map<string, MeshPeer>();
  private messageHandlers = new Map<string, Set<TransportMessageHandler>>();
  private peerListeners = new Set<TransportPeerListener>();
  private tabStateInterval?: number;
  private presenceInterval?: number;
  private connectionTimeouts = new Map<string, number>();
  private started = false;
  private tabChannel?: BroadcastChannel;

  constructor(private options: SwarmMeshOptions) {
    console.log('[SWARM Mesh] 🌐 Initializing unified mesh network');
    
    // Initialize integrated transport (primary)
    this.integrated = new IntegratedAdapter({
      swarmId: options.swarmId,
      trackers: options.trackers,
      gunPeers: options.gunPeers,
    });

    // Initialize Gun standalone (relay fallback)
    this.gun = new GunAdapter({
      peers: options.gunPeers,
    });

    // Initialize blockchain sync
    this.blockchainSync = new BlockchainP2PSync(
      (type, payload) => this.broadcastInternal(type, payload),
      (block) => {
        console.log('[SWARM Mesh] 📦 Received blockchain block:', block.index);
        // Update peer reputation based on blockchain activity
        this.updatePeerBlockchainActivity(block.miner);
      },
      (chain) => {
        console.log('[SWARM Mesh] ⛓️ Received blockchain chain:', chain.length);
      }
    );

    // Initialize post sync manager
    this.postSync = new PostSyncManager(
      (peerId, message) => {
        const result = this.send('posts', peerId, message);
        return result !== 'failed';
      },
      () => this.getConnectedPeers(),
      async () => {} // No manifest fetching for now
    );

    // Initialize peer exchange protocol — dev nodes use this to propagate their peer lists
    this.pex = new PeerExchangeProtocol(
      (peerId, type, payload) => {
        this.send(type, peerId, payload);
      },
      (discoveredPeers) => {
        console.log(`[SWARM Mesh] 🌐 PEX discovered ${discoveredPeers.length} new peer(s) — connecting`);
        for (const peer of discoveredPeers) {
          this.connectToPeer(peer.peerId);
          addKnownPeer(peer.peerId, `PEX:${peer.userId || 'unknown'}`);
        }
      }
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    
    console.log('[SWARM Mesh] 🚀 Starting unified mesh network');

    // Start cross-mode content bridge
    startContentBridge(this.options.localPeerId);

    // Restore from tab state if available
    await this.restoreTabState();

    // Start transports in parallel
    await Promise.all([
      this.integrated.start({ peerId: this.options.localPeerId }),
      this.gun.start({ peerId: this.options.localPeerId }),
    ]);

    // Setup transport message routing
    this.setupTransportRouting();

    // Start blockchain sync
    this.blockchainSync.start();

    // Start tab persistence
    this.startTabPersistence();

    // Setup cross-tab communication
    this.setupTabSync();

    // Start presence broadcast for peer discovery
    this.startPresenceBroadcast();

    this.started = true;
    console.log('[SWARM Mesh] ✅ Mesh network active');

    // Auto-connect to known bootstrap/dev nodes
    if (isAutoConnectEnabled()) {
      this.autoConnectToKnownNodes();
    }
  }

  stop(): void {
    if (!this.started) return;

    console.log('[SWARM Mesh] 🛑 Stopping mesh network');

    // Save tab state before stopping
    this.saveTabState();

    // Stop transports
    this.integrated.stop();
    this.gun.stop();

    // Stop blockchain sync
    this.blockchainSync.stop();

    // Clear intervals
    if (this.tabStateInterval) {
      clearInterval(this.tabStateInterval);
      this.tabStateInterval = undefined;
    }

    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = undefined;
    }

    // Close tab channel
    this.tabChannel?.close();
    this.tabChannel = undefined;

    // Clear timeouts
    for (const timeout of this.connectionTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.connectionTimeouts.clear();

    this.started = false;
    console.log('[SWARM Mesh] ⏹️ Mesh network stopped');
  }

  /**
   * Resolve a Node ID or Peer ID to the deterministic PeerJS ID format.
   * Node IDs (16-char hex) map to `peer-{nodeId}`.
   * Peer IDs (already prefixed) are returned as-is.
   */
  private toPeerJSId(id: string): string {
    if (id.startsWith('peer-')) return id;
    if (/^[a-f0-9]{16}$/i.test(id)) return `peer-${id}`;
    return id;
  }

  connectToPeer(peerId: string): void {
    if (!peerId || peerId === this.options.localPeerId) {
      return;
    }
    
    // Derive the deterministic PeerJS ID for WebRTC connections
    const peerJSId = this.toPeerJSId(peerId);
    
    console.log(`[SWARM Mesh] 🔗 Connecting to peer: ${peerId} (PeerJS: ${peerJSId})`);
    
    // Track by original ID in mesh (Node ID or peer ID)
    if (!this.peers.has(peerId)) {
      const peer: MeshPeer = {
        peerId,
        connectedVia: 'relay', // Start with relay, upgrade to direct when WebRTC connects
        connectionQuality: 50,
        lastSeen: Date.now(),
        reputation: this.getBlockchainReputation(peerId),
        failureCount: 0,
        successCount: 0,
        avgLatency: 0,
        blockchainActivity: 0,
      };
      this.peers.set(peerId, peer);
      this.emitPeerUpdate();
      
      console.log(`[SWARM Mesh] ✨ Added peer to mesh: ${peerId}`);
      
      // Trigger post sync for new peer
      console.log(`[SWARM Mesh] 📤 Initiating post sync with new peer: ${peerId}`);
      void this.postSync.handlePeerConnected(peerId);
    }
    
    // Establish WebRTC connection using deterministic PeerJS ID
    this.integrated.connectToPeer(peerJSId);
    
    // Also try Gun relay connection using original ID
    this.gun.send('ping', peerId, { type: 'ping', from: this.options.localPeerId, timestamp: Date.now() });

    // Request peer list via PEX — dev nodes like 685cb8ea430d21a3 build the network
    this.pex.updatePeer({
      peerId: this.options.localPeerId,
      userId: '',
      lastSeen: Date.now(),
      reliability: 100,
      contentCount: 0,
    });
    this.pex.requestPeers(peerId);
  }

  /**
   * Send message with intelligent routing
   */
  send(channel: string, peerId: string, payload: unknown): 'confirmed' | 'relayed' | 'failed' {
    const peer = this.peers.get(peerId);
    const peerJSId = this.toPeerJSId(peerId);
    
    // Use blockchain reputation and quality to choose transport
    if (peer) {
      const useDirectFirst = this.shouldUseDirect(peer);
      
      if (useDirectFirst) {
        const result = this.integrated.send(channel, peerJSId, payload);
        if (result === 'confirmed') {
          this.recordSuccess(peerId);
          return 'confirmed';
        }
      }
    }

    // Try Gun relay (uses original ID)
    const gunResult = this.gun.send(channel, peerId, payload);
    if (gunResult) {
      if (peer) {
        this.recordSuccess(peerId);
      }
      return 'relayed';
    }

    // Try integrated as last resort if not tried first
    if (peer && !this.shouldUseDirect(peer)) {
      const result = this.integrated.send(channel, peerJSId, payload);
      if (result !== 'failed') {
        this.recordSuccess(peerId);
        return result;
      }
    }

    if (peer) {
      this.recordFailure(peerId);
    }
    
    return 'failed';
  }

  /**
   * Broadcast to all connected peers
   */
  broadcast(channel: string, payload: unknown): void {
    const activePeers = Array.from(this.peers.keys());
    console.log(`[SWARM Mesh] 📡 Broadcasting to ${activePeers.length} peers`);
    
    activePeers.forEach(peerId => {
      this.send(channel, peerId, payload);
    });
  }

  /**
   * Register message handler
   */
  onMessage(channel: string, handler: TransportMessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    this.messageHandlers.get(channel)!.add(handler);

    return () => {
      const handlers = this.messageHandlers.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(channel);
        }
      }
    };
  }

  /**
   * Register peer update listener
   */
  onPeerUpdate(listener: TransportPeerListener): () => void {
    this.peerListeners.add(listener);
    // Emit current state
    listener(Array.from(this.peers.keys()));
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  /**
   * Get mesh statistics
   */
  getStats() {
    const peers = Array.from(this.peers.values());
    const directPeers = peers.filter(p => p.connectedVia === 'direct' || p.connectedVia === 'both');
    const avgQuality = peers.length > 0 
      ? peers.reduce((sum, p) => sum + p.connectionQuality, 0) / peers.length 
      : 0;
    const avgReputation = peers.length > 0
      ? peers.reduce((sum, p) => sum + p.reputation, 0) / peers.length
      : 0;

    return {
      totalPeers: peers.length,
      directConnections: directPeers.length,
      averageQuality: Math.round(avgQuality),
      averageReputation: Math.round(avgReputation),
      meshHealth: this.calculateMeshHealth(),
      blockchainSynced: this.blockchainSync.getStats().isRunning,
    };
  }

  /**
   * Get connected peer IDs
   */
  getConnectedPeers(): string[] {
    return Array.from(this.peers.keys());
  }

  /**
   * Broadcast a post to all connected peers
   */
  broadcastPost(post: Post): void {
    console.log('[SWARM Mesh] 📢 Broadcasting post:', post.id, 'to', this.peers.size, 'peers');
    
    // Use postSync to send to known peers via direct channels
    void this.postSync.broadcastPost(post);
    
    // Also broadcast via Gun relay to ensure mesh-wide delivery
    // This catches peers that may only be reachable via relay
    this.gun.broadcastToAll('posts', {
      type: 'post_created',
      post,
    });

    // Broadcast via cross-mode content bridge (reaches Builder Mode users)
    bridgeBroadcastPost(post);

    // Notify local feed immediately so the author sees it
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('p2p-posts-updated'));
    }
  }

  /**
   * Get peer details
   */
  getPeer(peerId: string): MeshPeer | null {
    return this.peers.get(peerId) || null;
  }

  /**
   * Calculate dynamic timeout for peer based on quality and reputation
   */
  private calculateDynamicTimeout(peer: MeshPeer): number {
    const qualityFactor = peer.connectionQuality / 100;
    const reputationFactor = Math.min(peer.reputation / 100, 1);
    const latencyFactor = Math.max(0, 1 - (peer.avgLatency / 1000));
    
    const score = (qualityFactor * QUALITY_WEIGHT) +
                  (reputationFactor * REPUTATION_WEIGHT) +
                  (latencyFactor * (1 - QUALITY_WEIGHT - REPUTATION_WEIGHT));
    
    // High score = shorter timeout (faster reconnection)
    // Low score = longer timeout (avoid cascade)
    const timeout = MAX_TIMEOUT - (score * (MAX_TIMEOUT - MIN_TIMEOUT));
    
    return Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, timeout));
  }

  /**
   * Should use direct connection based on peer quality
   */
  private shouldUseDirect(peer: MeshPeer): boolean {
    // Use blockchain activity and reputation to decide
    const blockchainScore = Math.min(peer.blockchainActivity / 10, 1);
    const reputationScore = peer.reputation / 100;
    const qualityScore = peer.connectionQuality / 100;
    
    const score = (blockchainScore * BLOCKCHAIN_WEIGHT) +
                  (reputationScore * REPUTATION_WEIGHT) +
                  (qualityScore * QUALITY_WEIGHT);
    
    return score > 0.5;
  }

  /**
   * Setup transport message routing
   */
  private setupTransportRouting(): void {
    // Route messages from integrated transport
    this.integrated.onMessage('*', (peerId, payload) => {
      this.handleIncomingMessage('integrated', peerId, payload);
    });

    // Route messages from Gun transport
    this.gun.onMessage('*', (peerId, payload) => {
      this.handleIncomingMessage('gun', peerId, payload);
    });

    // Listen for peer updates from both transports
    this.integrated.onPeerUpdate((peers) => {
      this.updatePeerList(peers, 'integrated');
    });

    this.gun.onPeerUpdate((peers) => {
      this.updatePeerList(peers, 'gun');
    });
  }

  /**
   * Handle incoming message from any transport
   */
  private handleIncomingMessage(transport: string, peerId: string, payload: unknown): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
      this.recordSuccess(peerId);
    }

    // Extract channel and payload from envelope
    const envelope = payload as { channel?: string; payload?: unknown };
    const channel = envelope.channel || 'default';
    const actualPayload = envelope.payload ?? payload;

    console.log(`[SWARM Mesh] 📨 Received message on channel '${channel}' from ${peerId} via ${transport}`);

    // Dispatch to handlers
    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(peerId, actualPayload);
        } catch (error) {
          console.warn('[SWARM Mesh] Message handler error:', error);
        }
      });
    }

    // Check if it's a blockchain message
    if (channel === 'blockchain' && (actualPayload as BlockchainSyncMessage)?.type === 'blockchain_sync') {
      this.blockchainSync.handleMessage(actualPayload as BlockchainSyncMessage, peerId);
    }

    // Check if it's a post sync message
    if (channel === 'posts') {
      console.log('[SWARM Mesh] 📬 Processing posts channel message from', peerId, actualPayload);
      if (this.postSync.isPostSyncMessage(actualPayload)) {
        console.log('[SWARM Mesh] ✅ Valid post sync message, handling...');
        void this.postSync.handleMessage(peerId, actualPayload);
      } else {
        console.log('[SWARM Mesh] ⚠️ Not a valid post sync message:', typeof actualPayload);
      }
    }

    // Check if it's a PEX (Peer Exchange) message — dev nodes propagate network this way
    if (channel === 'pex') {
      this.pex.handleMessage(peerId, actualPayload as PEXMessage);
    }

    // Check if it's a presence message - use it to trigger post sync if peer is new
    if (channel === 'presence' || (actualPayload as { type?: string })?.type === 'presence') {
      const presenceData = actualPayload as { peerId?: string; timestamp?: number; knownPeers?: string[] };
      const presencePeerId = presenceData?.peerId || peerId;
      
      if (presencePeerId && presencePeerId !== this.options.localPeerId) {
        // Check if this is a new peer we haven't synced with
        if (!this.peers.has(presencePeerId)) {
          console.log(`[SWARM Mesh] 👋 Discovered new peer via presence: ${presencePeerId}`);
          this.peers.set(presencePeerId, {
            peerId: presencePeerId,
            connectedVia: 'relay',
            connectionQuality: 50,
            lastSeen: Date.now(),
            reputation: this.getBlockchainReputation(presencePeerId),
            failureCount: 0,
            successCount: 0,
            avgLatency: 0,
            blockchainActivity: 0,
          });
          this.emitPeerUpdate();
          
          // Trigger post sync with new peer
          console.log(`[SWARM Mesh] 📤 Initiating post sync with presence peer: ${presencePeerId}`);
          void this.postSync.handlePeerConnected(presencePeerId);
        }

        // Propagate peer list — connect to peers this peer knows about
        if (Array.isArray(presenceData.knownPeers)) {
          for (const kp of presenceData.knownPeers) {
            if (kp !== this.options.localPeerId && !this.peers.has(kp)) {
              console.log(`[SWARM Mesh] 🌐 Discovered transitive peer ${kp} via ${presencePeerId}`);
              addKnownPeer(kp, `Discovered via ${presencePeerId.slice(0, 8)}`);
              this.connectToPeer(kp);
            }
          }
        }
      }
    }

    // Handle mesh peer list exchange
    if (channel === 'mesh-peers') {
      const peerListMsg = actualPayload as { type?: string; from?: string; myPeers?: string[]; peerList?: string[] };
      
      if (peerListMsg.type === 'peer-list-request') {
        // Send our peer list back
        this.send('mesh-peers', peerId, {
          type: 'peer-list-response',
          from: this.options.localPeerId,
          peerList: Array.from(this.peers.keys()),
        });

        // Also connect to their peers we don't know
        if (Array.isArray(peerListMsg.myPeers)) {
          for (const kp of peerListMsg.myPeers) {
            if (kp !== this.options.localPeerId && !this.peers.has(kp)) {
              console.log(`[SWARM Mesh] 🌐 Discovered peer ${kp} via peer-list from ${peerId}`);
              addKnownPeer(kp, `Exchanged via ${peerId.slice(0, 8)}`);
              this.connectToPeer(kp);
            }
          }
        }
      } else if (peerListMsg.type === 'peer-list-response') {
        // Connect to peers from their list
        if (Array.isArray(peerListMsg.peerList)) {
          for (const kp of peerListMsg.peerList) {
            if (kp !== this.options.localPeerId && !this.peers.has(kp)) {
              console.log(`[SWARM Mesh] 🌐 Discovered peer ${kp} via response from ${peerId}`);
              addKnownPeer(kp, `Exchanged via ${peerId.slice(0, 8)}`);
              this.connectToPeer(kp);
            }
          }
        }
      }
    }
  }

  /**
   * Update peer list from transport
   */
  private updatePeerList(peerIds: string[], source: 'integrated' | 'gun'): void {
    let updated = false;
    const newPeers: string[] = [];

    for (const peerId of peerIds) {
      if (peerId === this.options.localPeerId) continue;

      let peer = this.peers.get(peerId);
      if (!peer) {
        // New peer discovered
        peer = {
          peerId,
          connectedVia: source === 'integrated' ? 'direct' : 'relay',
          connectionQuality: 50,
          lastSeen: Date.now(),
          reputation: this.getBlockchainReputation(peerId),
          failureCount: 0,
          successCount: 0,
          avgLatency: 0,
          blockchainActivity: 0,
        };
        this.peers.set(peerId, peer);
        updated = true;
        newPeers.push(peerId);
        console.log(`[SWARM Mesh] ✨ New peer discovered: ${peerId} via ${source}`);
      } else {
        // Update connection type
        if (source === 'integrated' && peer.connectedVia === 'relay') {
          peer.connectedVia = 'both';
          updated = true;
        } else if (source === 'gun' && peer.connectedVia === 'direct') {
          peer.connectedVia = 'both';
          updated = true;
        }
        peer.lastSeen = Date.now();
      }
    }

    if (updated) {
      this.emitPeerUpdate();
    }

    // Trigger post sync for new peers
    for (const peerId of newPeers) {
      console.log(`[SWARM Mesh] 📤 Sending posts to new peer: ${peerId}`);
      void this.postSync.handlePeerConnected(peerId);
    }
  }

  /**
   * Emit peer update to listeners
   */
  private emitPeerUpdate(): void {
    const peerIds = Array.from(this.peers.keys());
    this.peerListeners.forEach(listener => {
      try {
        listener(peerIds);
      } catch (error) {
        console.warn('[SWARM Mesh] Peer listener error:', error);
      }
    });
  }

  /**
   * Record successful communication with peer
   */
  private recordSuccess(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.successCount++;
    peer.failureCount = Math.max(0, peer.failureCount - 1);
    
    // Update connection quality (exponential moving average)
    const successRate = peer.successCount / (peer.successCount + peer.failureCount);
    peer.connectionQuality = Math.round(
      peer.connectionQuality * 0.7 + successRate * 100 * 0.3
    );

    // Update reputation based on blockchain activity
    peer.reputation = this.getBlockchainReputation(peerId);
  }

  /**
   * Record failed communication with peer
   */
  private recordFailure(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.failureCount++;
    
    // Update connection quality
    const successRate = peer.successCount / (peer.successCount + peer.failureCount);
    peer.connectionQuality = Math.round(
      peer.connectionQuality * 0.7 + successRate * 100 * 0.3
    );

    // Set dynamic timeout before retry
    const timeout = this.calculateDynamicTimeout(peer);
    console.log(`[SWARM Mesh] ⏱️ Dynamic timeout for ${peerId}: ${timeout}ms`);
  }

  /**
   * Get blockchain-based reputation for peer
   */
  private getBlockchainReputation(peerId: string): number {
    const chain = getSwarmChain();
    const blocks = chain.getChain();
    
    // Count blocks mined by peer
    const minedBlocks = blocks.filter(b => b.miner === peerId).length;
    
    // Count transactions involving peer
    let transactions = 0;
    blocks.forEach(block => {
      transactions += block.transactions.filter(
        tx => tx.from === peerId || tx.to === peerId
      ).length;
    });

    // Calculate reputation (0-100)
    const reputation = Math.min(100, (minedBlocks * 10) + (transactions * 2));
    return reputation;
  }

  /**
   * Update peer's blockchain activity
   */
  private updatePeerBlockchainActivity(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.blockchainActivity++;
    peer.reputation = this.getBlockchainReputation(peerId);
    console.log(`[SWARM Mesh] 📊 Updated ${peerId} reputation: ${peer.reputation}`);
  }

  /**
   * Calculate overall mesh health (0-100)
   */
  private calculateMeshHealth(): number {
    if (this.peers.size === 0) return 0;

    const peers = Array.from(this.peers.values());
    const avgQuality = peers.reduce((sum, p) => sum + p.connectionQuality, 0) / peers.length;
    const directRatio = peers.filter(p => p.connectedVia !== 'relay').length / peers.length;
    const avgReputation = peers.reduce((sum, p) => sum + p.reputation, 0) / peers.length;

    const health = (avgQuality * 0.4) + (directRatio * 100 * 0.3) + (avgReputation * 0.3);
    return Math.round(health);
  }

  /**
   * Start tab persistence mechanism
   */
  private startTabPersistence(): void {
    // Save state periodically
    this.tabStateInterval = window.setInterval(() => {
      this.saveTabState();
    }, TAB_SYNC_INTERVAL);

    // Save on unload
    window.addEventListener('beforeunload', () => {
      this.saveTabState();
    });
  }

  /**
   * Start periodic presence broadcast for peer discovery
   */
  private startPresenceBroadcast(): void {
    const PRESENCE_INTERVAL = 10_000; // 10 seconds
    
    // Broadcast presence immediately
    this.broadcastPresence();
    
    // Then broadcast periodically
    this.presenceInterval = window.setInterval(() => {
      this.broadcastPresence();
    }, PRESENCE_INTERVAL);
  }

  /**
   * Broadcast presence to all peers (known and unknown)
   */
  private broadcastPresence(): void {
    const presence = {
      type: 'presence',
      peerId: this.options.localPeerId,
      timestamp: Date.now(),
      peerCount: this.peers.size,
      knownPeers: Array.from(this.peers.keys()).slice(0, 20), // Share up to 20 known peers
    };
    
    // Broadcast via Gun to ALL peers on the mesh (not just known ones)
    console.log(`[SWARM Mesh] 👋 Broadcasting presence to mesh (${this.peers.size} known peers)`);
    this.gun.broadcastToAll('presence', presence);
    
    // Also send directly to known peers
    for (const peerId of this.peers.keys()) {
      this.gun.send('presence', peerId, presence);
    }
  }

  /**
   * Auto-connect to known bootstrap/dev nodes from the stored peer list.
   * Also requests their peer lists to propagate mesh knowledge.
   */
  private autoConnectToKnownNodes(): void {
    const knownPeers = loadKnownPeers();
    const eligible = knownPeers.filter(
      entry => entry.peerId !== this.options.localPeerId
    );

    if (eligible.length === 0) {
      console.log('[SWARM Mesh] ℹ️ No known nodes to auto-connect');
      return;
    }

    console.log(`[SWARM Mesh] 🔗 Auto-connecting to ${eligible.length} known node(s) (dev/bootstrap nodes build the network)`);
    for (const entry of eligible) {
      this.connectToPeer(entry.peerId);
      // Request their peer list for mesh propagation — dev nodes like 685cb8ea430d21a3 serve as network builders
      this.send('mesh-peers', entry.peerId, {
        type: 'peer-list-request',
        from: this.options.localPeerId,
        myPeers: Array.from(this.peers.keys()),
      });
    }

    // Staggered retry: dev nodes may not be instantly reachable
    setTimeout(() => {
      const currentPeers = new Set(this.peers.keys());
      const retryTargets = eligible.filter(e => {
        const peer = this.peers.get(e.peerId);
        return !peer || peer.successCount === 0;
      });
      if (retryTargets.length > 0) {
        console.log(`[SWARM Mesh] 🔄 Retrying ${retryTargets.length} dev/bootstrap node(s)`);
        for (const entry of retryTargets) {
          this.connectToPeer(entry.peerId);
        }
      }
    }, 8000);
  }

  /**
   * Save tab state to localStorage
   */
  private saveTabState(): void {
    const state: TabState = {
      peerId: this.options.localPeerId,
      timestamp: Date.now(),
      activePeers: Array.from(this.peers.keys()),
      meshHealth: this.calculateMeshHealth(),
    };

    try {
      localStorage.setItem(TAB_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('[SWARM Mesh] Failed to save tab state:', error);
    }
  }

  /**
   * Restore tab state from localStorage
   */
  private async restoreTabState(): Promise<void> {
    try {
      const stateJson = localStorage.getItem(TAB_STATE_KEY);
      if (!stateJson) return;

      const state: TabState = JSON.parse(stateJson);
      
      // Check if state is recent (within 5 minutes)
      const age = Date.now() - state.timestamp;
      if (age > 5 * 60 * 1000) {
        console.log('[SWARM Mesh] 🕐 Tab state too old, starting fresh');
        return;
      }

      console.log(`[SWARM Mesh] 🔄 Restoring previous session with ${state.activePeers.length} peers`);
      
      // Restore peers and trigger post sync for each
      const peersToSync: string[] = [];
      state.activePeers.forEach(peerId => {
        if (peerId !== this.options.localPeerId && !this.peers.has(peerId)) {
          this.peers.set(peerId, {
            peerId,
            connectedVia: 'relay',
            connectionQuality: 50,
            lastSeen: state.timestamp,
            reputation: this.getBlockchainReputation(peerId),
            failureCount: 0,
            successCount: 0,
            avgLatency: 0,
            blockchainActivity: 0,
          });
          peersToSync.push(peerId);
        }
      });

      // Trigger post sync for restored peers after a brief delay
      if (peersToSync.length > 0) {
        setTimeout(() => {
          peersToSync.forEach(peerId => {
            console.log(`[SWARM Mesh] 📤 Initiating post sync with restored peer: ${peerId}`);
            void this.postSync.handlePeerConnected(peerId);
          });
        }, 1000);
      }

    } catch (error) {
      console.warn('[SWARM Mesh] Failed to restore tab state:', error);
    }
  }

  /**
   * Setup cross-tab synchronization
   */
  private setupTabSync(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    this.tabChannel = new BroadcastChannel('swarm-mesh-tabs');
    
    this.tabChannel.addEventListener('message', (event) => {
      const { type, data } = event.data;
      
      if (type === 'peer-update') {
        // Another tab discovered a peer
        const { peerId, connectedVia } = data;
        if (!this.peers.has(peerId)) {
          console.log(`[SWARM Mesh] 📬 Peer discovered in other tab: ${peerId}`);
          this.peers.set(peerId, {
            peerId,
            connectedVia,
            connectionQuality: 50,
            lastSeen: Date.now(),
            reputation: this.getBlockchainReputation(peerId),
            failureCount: 0,
            successCount: 0,
            avgLatency: 0,
            blockchainActivity: 0,
          });
          this.emitPeerUpdate();
        }
      }
    });
  }

  /**
   * Broadcast internally (for blockchain sync)
   */
  private broadcastInternal(type: string, payload: unknown): void {
    this.broadcast(type, payload);
  }
}

/**
 * Global SWARM Mesh instance
 */
let globalMeshInstance: SwarmMesh | null = null;

export function getSwarmMesh(options?: SwarmMeshOptions): SwarmMesh {
  if (!globalMeshInstance && options) {
    globalMeshInstance = new SwarmMesh(options);
  }
  if (!globalMeshInstance) {
    throw new Error('[SWARM Mesh] Mesh not initialized. Call with options first.');
  }
  return globalMeshInstance;
}

export function destroySwarmMesh(): void {
  if (globalMeshInstance) {
    globalMeshInstance.stop();
    globalMeshInstance = null;
  }
}
