/**
 * Peer Discovery
 * Discovers peers and manages available content inventory
 */

import { openDB, Manifest } from '../store';

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
   * @returns true if this peer was newly discovered
   */
  registerPeer(peerId: string, userId: string, availableContent: string[]): boolean {
    console.log(`[Discovery] Registering peer ${peerId} with ${availableContent.length} items`);

    const existing = this.discoveredPeers.get(peerId);
    const isNewPeer = !existing;

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

    return isNewPeer;
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
    console.log('[Discovery] 🔍 Scanning local content...');
    
    try {
      const db = await openDB();
      const contentIds: string[] = [];
      
      // Scan manifests (files)
      console.log('[Discovery] Scanning manifests...');
      const manifestTx = db.transaction('manifests', 'readonly');
      const manifestStore = manifestTx.objectStore('manifests');
      
      const manifestPromise = new Promise<string[]>((resolve, reject) => {
        const req = manifestStore.getAll();
        req.onsuccess = () => {
          type StoredManifest = Manifest & { hash?: string };
          const manifests = req.result as StoredManifest[];
          console.log(`[Discovery] Found ${manifests.length} manifests in DB`);
          const hashes = manifests.map((manifest) => manifest.hash ?? manifest.fileId);
          console.log('[Discovery] Manifest hashes:', hashes);
          resolve(hashes);
        };
        req.onerror = () => reject(req.error);
      });
      
      // Scan posts (all posts, not just by user - they're all locally stored content)
      console.log('[Discovery] Scanning posts...');
      const postTx = db.transaction('posts', 'readonly');
      const postStore = postTx.objectStore('posts');
      
      const postPromise = new Promise<string[]>((resolve, reject) => {
        const req = postStore.getAll();
        req.onsuccess = () => {
          const posts = req.result as Array<{ id: string; author: string }>;
          console.log(`[Discovery] Found ${posts.length} posts in DB`);
          // Count ALL posts - they're all stored locally and can be shared
          const postIds = posts.map(p => p.id);
          console.log('[Discovery] Post IDs:', postIds.slice(0, 5), posts.length > 5 ? '...' : '');
          resolve(postIds);
        };
        req.onerror = () => reject(req.error);
      });
      
      const [manifestHashes, postIds] = await Promise.all([manifestPromise, postPromise]);
      contentIds.push(...manifestHashes, ...postIds);
      
      this.localContent = new Set(contentIds);
      console.log(`[Discovery] ✅ Scan complete: ${contentIds.length} local items (${manifestHashes.length} files, ${postIds.length} posts)`);
      console.log('[Discovery] Local content set size:', this.localContent.size);
      return contentIds;
    } catch (error) {
      console.error('[Discovery] ❌ Error scanning local content:', error);
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
