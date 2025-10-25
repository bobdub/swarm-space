/**
 * Gossip Protocol for Peer Discovery
 * 
 * Continuously broadcasts peer information across the network,
 * ensuring all nodes maintain an up-to-date view of the swarm.
 * 
 * Similar to epidemic algorithms, gossip ensures eventual consistency
 * of peer state across the entire distributed network.
 */

export interface GossipPeerInfo {
  peerId: string;
  userId: string;
  lastSeen: number;
  contentCount: number;
}

export interface GossipMessage {
  type: 'gossip_peers';
  peers: GossipPeerInfo[];
  timestamp: number;
  ttl: number; // Time-to-live to prevent infinite propagation
}

export class GossipProtocol {
  private gossipInterval?: number;
  private readonly GOSSIP_INTERVAL = 60000; // Gossip every 60 seconds
  private readonly MAX_PEERS_PER_GOSSIP = 20;
  private readonly DEFAULT_TTL = 3; // Max 3 hops

  constructor(
    private getLocalPeers: () => GossipPeerInfo[],
    private broadcast: (type: string, payload: unknown) => void,
    private onPeersReceived?: (peers: GossipPeerInfo[]) => void
  ) {
    console.log('[Gossip] Protocol initialized');
  }

  /**
   * Start gossiping peer information
   */
  start(): void {
    if (this.gossipInterval) {
      console.warn('[Gossip] Already running');
      return;
    }

    console.log('[Gossip] Starting periodic gossip broadcasts');
    
    // Immediate first gossip
    this.gossipPeers();

    // Then periodic gossip
    this.gossipInterval = window.setInterval(() => {
      this.gossipPeers();
    }, this.GOSSIP_INTERVAL);
  }

  /**
   * Stop gossiping
   */
  stop(): void {
    if (this.gossipInterval) {
      clearInterval(this.gossipInterval);
      this.gossipInterval = undefined;
      console.log('[Gossip] Stopped');
    }
  }

  /**
   * Broadcast known peers to all connections
   */
  private gossipPeers(): void {
    const peers = this.getLocalPeers()
      .sort((a, b) => b.lastSeen - a.lastSeen) // Most recent first
      .slice(0, this.MAX_PEERS_PER_GOSSIP);

    if (peers.length === 0) {
      console.log('[Gossip] No peers to gossip');
      return;
    }

    const message: GossipMessage = {
      type: 'gossip_peers',
      peers,
      timestamp: Date.now(),
      ttl: this.DEFAULT_TTL
    };

    console.log(`[Gossip] 📢 Broadcasting ${peers.length} peers to network`);
    this.broadcast('gossip', message);
  }

  /**
   * Handle incoming gossip message
   */
  handleMessage(message: GossipMessage, fromPeer: string): void {
    if (message.type !== 'gossip_peers') {
      console.warn('[Gossip] Unknown message type:', message.type);
      return;
    }

    console.log(`[Gossip] 📥 Received gossip from ${fromPeer}: ${message.peers.length} peers`);

    // Process received peers
    if (this.onPeersReceived) {
      this.onPeersReceived(message.peers);
    }

    // Optionally re-broadcast if TTL allows (epidemic propagation)
    if (message.ttl > 1) {
      const rebroadcast: GossipMessage = {
        ...message,
        ttl: message.ttl - 1
      };
      
      console.log(`[Gossip] Re-broadcasting with TTL ${rebroadcast.ttl}`);
      this.broadcast('gossip', rebroadcast);
    }
  }

  /**
   * Manual trigger gossip (useful for immediate updates)
   */
  triggerGossip(): void {
    console.log('[Gossip] Manual gossip trigger');
    this.gossipPeers();
  }

  /**
   * Get gossip statistics
   */
  getStats() {
    return {
      isRunning: this.gossipInterval !== undefined,
      interval: this.GOSSIP_INTERVAL,
      maxPeersPerGossip: this.MAX_PEERS_PER_GOSSIP
    };
  }
}
