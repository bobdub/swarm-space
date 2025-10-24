/**
 * Peer Discovery
 * Discovers peers and manages available content inventory
 */

import { getDb } from '../store';

export interface DiscoveredPeer {
  peerId: string;
  userId: string;
  availableContent: Set<string>; // manifest hashes
  discoveredAt: Date;
  lastSeen: Date;
}

export interface ContentInventory {
  manifestHash: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  availablePeers: string[];
}

export class PeerDiscovery {
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();
  private contentInventory: Map<string, ContentInventory> = new Map();
  private localContent: Set<string> = new Set();

  constructor(private localPeerId: string, private localUserId: string) {}

  /**
   * Register a newly discovered peer
   */
  registerPeer(peerId: string, userId: string, availableContent: string[]): void {
    console.log(`[Discovery] Registering peer ${peerId} with ${availableContent.length} items`);

    const existing = this.discoveredPeers.get(peerId);
    if (existing) {
      existing.availableContent = new Set(availableContent);
      existing.lastSeen = new Date();
    } else {
      this.discoveredPeers.set(peerId, {
        peerId,
        userId,
        availableContent: new Set(availableContent),
        discoveredAt: new Date(),
        lastSeen: new Date()
      });
    }

    // Update content inventory
    this.updateInventory(peerId, availableContent);
  }

  /**
   * Update peer's last seen timestamp
   */
  updatePeerSeen(peerId: string): void {
    const peer = this.discoveredPeers.get(peerId);
    if (peer) {
      peer.lastSeen = new Date();
    }
  }

  /**
   * Remove a peer
   */
  removePeer(peerId: string): void {
    console.log(`[Discovery] Removing peer ${peerId}`);
    
    const peer = this.discoveredPeers.get(peerId);
    if (peer) {
      // Remove from content inventory
      for (const manifestHash of peer.availableContent) {
        const inventory = this.contentInventory.get(manifestHash);
        if (inventory) {
          inventory.availablePeers = inventory.availablePeers.filter(p => p !== peerId);
          if (inventory.availablePeers.length === 0) {
            this.contentInventory.delete(manifestHash);
          }
        }
      }
    }
    
    this.discoveredPeers.delete(peerId);
  }

  /**
   * Get all discovered peers
   */
  getAllPeers(): DiscoveredPeer[] {
    return Array.from(this.discoveredPeers.values());
  }

  /**
   * Get peers that have specific content
   */
  getPeersWithContent(manifestHash: string): string[] {
    const inventory = this.contentInventory.get(manifestHash);
    return inventory ? inventory.availablePeers : [];
  }

  /**
   * Get best peer for content (lowest load, closest, etc.)
   */
  getBestPeerForContent(manifestHash: string): string | null {
    const peers = this.getPeersWithContent(manifestHash);
    if (peers.length === 0) return null;

    // Simple strategy: return first available peer
    // TODO: Implement smarter selection based on RTT, load, etc.
    return peers[0];
  }

  /**
   * Check if content is available on network
   */
  isContentAvailable(manifestHash: string): boolean {
    return this.contentInventory.has(manifestHash) && 
           this.getPeersWithContent(manifestHash).length > 0;
  }

  /**
   * Get content inventory
   */
  getInventory(): ContentInventory[] {
    return Array.from(this.contentInventory.values());
  }

  /**
   * Scan local storage and build content list
   */
  async scanLocalContent(): Promise<string[]> {
    console.log('[Discovery] Scanning local content...');
    
    try {
      const db = await getDb();
      const tx = db.transaction('manifests', 'readonly');
      const store = tx.objectStore('manifests');
      const manifests = await store.getAll();
      
      const hashes = manifests.map(m => m.hash);
      this.localContent = new Set(hashes);
      
      console.log(`[Discovery] Found ${hashes.length} local items`);
      return hashes;
    } catch (error) {
      console.error('[Discovery] Error scanning local content:', error);
      return [];
    }
  }

  /**
   * Get local content list
   */
  getLocalContent(): string[] {
    return Array.from(this.localContent);
  }

  /**
   * Update local content (when new files are added)
   */
  addLocalContent(manifestHash: string): void {
    this.localContent.add(manifestHash);
  }

  /**
   * Cleanup stale peers
   */
  cleanup(maxAge: number = 300000): void {
    const now = Date.now();
    const stalePeers: string[] = [];

    for (const [peerId, peer] of this.discoveredPeers.entries()) {
      if (now - peer.lastSeen.getTime() > maxAge) {
        stalePeers.push(peerId);
      }
    }

    stalePeers.forEach(peerId => this.removePeer(peerId));

    if (stalePeers.length > 0) {
      console.log(`[Discovery] Cleaned up ${stalePeers.length} stale peers`);
    }
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    return {
      totalPeers: this.discoveredPeers.size,
      totalContent: this.contentInventory.size,
      localContent: this.localContent.size
    };
  }

  // Private methods

  private updateInventory(peerId: string, manifestHashes: string[]): void {
    for (const hash of manifestHashes) {
      let inventory = this.contentInventory.get(hash);
      
      if (!inventory) {
        inventory = {
          manifestHash: hash,
          fileName: 'Unknown',
          fileSize: 0,
          mimeType: 'application/octet-stream',
          availablePeers: []
        };
        this.contentInventory.set(hash, inventory);
      }

      if (!inventory.availablePeers.includes(peerId)) {
        inventory.availablePeers.push(peerId);
      }
    }
  }
}
