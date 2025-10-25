/**
 * Bootstrap Peer Registry
 * 
 * Manages a persistent list of known peers to enable automatic
 * reconnection and swarm discovery.
 * 
 * Includes hardcoded seed peers to bootstrap the network when no
 * local peers are available (like BitTorrent DHT bootstrap nodes).
 */

const BOOTSTRAP_STORAGE_KEY = 'p2p-bootstrap-peers';
const MAX_BOOTSTRAP_PEERS = 100;

/**
 * Hardcoded seed peers for initial network bootstrap
 * These are well-known stable nodes that help new peers join the swarm
 * 
 * NOTE: Add your stable node's Peer ID here once you have a long-running instance
 */
const SEED_PEERS: { peerId: string; userId: string }[] = [
  // Add stable seed peers here as the network grows
  // Example: { peerId: 'peer-id-123', userId: 'stable-node-1' }
];

export interface BootstrapPeer {
  peerId: string;
  userId: string;
  lastSeen: number;
  successfulConnections: number;
  failedConnections: number;
  reliability: number; // 0-1 score
}

export class BootstrapRegistry {
  private peers: Map<string, BootstrapPeer> = new Map();
  
  constructor() {
    this.load();
    this.addSeedPeers();
  }

  /**
   * Add hardcoded seed peers if not already in registry
   */
  private addSeedPeers(): void {
    let added = 0;
    for (const seed of SEED_PEERS) {
      if (!this.peers.has(seed.peerId)) {
        this.peers.set(seed.peerId, {
          peerId: seed.peerId,
          userId: seed.userId,
          lastSeen: 0, // Never seen yet
          successfulConnections: 0,
          failedConnections: 0,
          reliability: 0.5 // Neutral reliability for seeds
        });
        added++;
      }
    }
    if (added > 0) {
      console.log(`[Bootstrap] Added ${added} seed peers`);
    }
  }

  /**
   * Add or update a peer in the registry
   */
  addPeer(peerId: string, userId: string, successful: boolean = true): void {
    const existing = this.peers.get(peerId);
    
    if (existing) {
      existing.lastSeen = Date.now();
      if (successful) {
        existing.successfulConnections++;
      } else {
        existing.failedConnections++;
      }
      existing.reliability = this.calculateReliability(existing);
    } else {
      this.peers.set(peerId, {
        peerId,
        userId,
        lastSeen: Date.now(),
        successfulConnections: successful ? 1 : 0,
        failedConnections: successful ? 0 : 1,
        reliability: successful ? 1.0 : 0.0
      });
    }
    
    this.pruneAndSave();
  }

  /**
   * Get best peers for bootstrapping (sorted by reliability)
   */
  getBestPeers(count: number = 5): BootstrapPeer[] {
    const peers = Array.from(this.peers.values())
      .sort((a, b) => {
        // Sort by reliability first, then by last seen
        if (b.reliability !== a.reliability) {
          return b.reliability - a.reliability;
        }
        return b.lastSeen - a.lastSeen;
      });
    
    return peers.slice(0, count);
  }

  /**
   * Get all known peers
   */
  getAllPeers(): BootstrapPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Remove a peer from registry
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.save();
  }

  /**
   * Clear all peers
   */
  clear(): void {
    this.peers.clear();
    this.save();
  }

  /**
   * Get registry stats
   */
  getStats() {
    const peers = Array.from(this.peers.values());
    const avgReliability = peers.length > 0
      ? peers.reduce((sum, p) => sum + p.reliability, 0) / peers.length
      : 0;
    
    return {
      totalPeers: peers.length,
      avgReliability: avgReliability.toFixed(2),
      recentPeers: peers.filter(p => Date.now() - p.lastSeen < 3600000).length // last hour
    };
  }

  // Private methods

  private calculateReliability(peer: BootstrapPeer): number {
    const total = peer.successfulConnections + peer.failedConnections;
    if (total === 0) return 0;
    
    const successRate = peer.successfulConnections / total;
    
    // Factor in recency - peers seen recently are more reliable
    const recencyScore = Math.max(0, 1 - (Date.now() - peer.lastSeen) / (7 * 24 * 3600000)); // 7 days decay
    
    return (successRate * 0.7) + (recencyScore * 0.3);
  }

  private pruneAndSave(): void {
    // Keep only the best peers if we exceed the limit
    if (this.peers.size > MAX_BOOTSTRAP_PEERS) {
      const sorted = Array.from(this.peers.values())
        .sort((a, b) => b.reliability - a.reliability);
      
      this.peers.clear();
      sorted.slice(0, MAX_BOOTSTRAP_PEERS).forEach(peer => {
        this.peers.set(peer.peerId, peer);
      });
    }
    
    this.save();
  }

  private save(): void {
    try {
      const data = Array.from(this.peers.values());
      localStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[Bootstrap] Failed to save registry:', error);
    }
  }

  private load(): void {
    try {
      const data = localStorage.getItem(BOOTSTRAP_STORAGE_KEY);
      if (data) {
        const peers = JSON.parse(data) as BootstrapPeer[];
        peers.forEach(peer => {
          this.peers.set(peer.peerId, peer);
        });
        console.log(`[Bootstrap] Loaded ${peers.length} peers from storage`);
      }
    } catch (error) {
      console.error('[Bootstrap] Failed to load registry:', error);
    }
  }
}
