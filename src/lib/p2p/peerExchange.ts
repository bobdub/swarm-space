/**
 * Peer Exchange (PEX) Protocol
 * 
 * Implements BitTorrent-style peer exchange for decentralized peer discovery.
 * When connecting to any peer, nodes exchange their known peer lists,
 * enabling exponential swarm growth without central coordination.
 * 
 * Protocol Flow:
 * 1. On connection, send PEX_REQUEST to new peer
 * 2. Peer responds with PEX_RESPONSE containing their known peers
 * 3. Receiver integrates new peers into local registry
 * 4. Auto-connect to best discovered peers
 */

export interface PeerInfo {
  peerId: string;
  userId: string;
  lastSeen: number;
  reliability: number;
  contentCount: number;
}

export interface PEXMessage {
  type: 'pex_request' | 'pex_response';
  peers?: PeerInfo[];
  timestamp: number;
}

export class PeerExchangeProtocol {
  private knownPeers = new Map<string, PeerInfo>();
  private onPeersDiscovered?: (peers: PeerInfo[]) => void;

  constructor(
    private sendMessage: (peerId: string, type: string, payload: unknown) => void,
    onPeersDiscovered?: (peers: PeerInfo[]) => void
  ) {
    this.onPeersDiscovered = onPeersDiscovered;
    console.log('[PEX] Peer Exchange Protocol initialized');
  }

  /**
   * Request peer list from a connected peer
   */
  requestPeers(peerId: string): void {
    console.log(`[PEX] Requesting peers from ${peerId}`);
    const message: PEXMessage = {
      type: 'pex_request',
      timestamp: Date.now()
    };
    this.sendMessage(peerId, 'pex', message);
  }

  /**
   * Handle incoming PEX message
   */
  async handleMessage(peerId: string, message: PEXMessage): Promise<void> {
    switch (message.type) {
      case 'pex_request':
        this.handlePeerRequest(peerId);
        break;
      case 'pex_response':
        if (message.peers) {
          this.handlePeerResponse(peerId, message.peers);
        }
        break;
    }
  }

  /**
   * Handle peer list request - send our known peers
   */
  private handlePeerRequest(peerId: string): void {
    const peers = Array.from(this.knownPeers.values())
      .filter(p => p.peerId !== peerId) // Don't send them themselves
      .slice(0, 50); // Limit to 50 peers per exchange

    console.log(`[PEX] Responding to ${peerId} with ${peers.length} known peers`);

    const message: PEXMessage = {
      type: 'pex_response',
      peers,
      timestamp: Date.now()
    };

    this.sendMessage(peerId, 'pex', message);
  }

  /**
   * Handle peer list response - integrate new peers
   */
  private handlePeerResponse(fromPeer: string, peers: PeerInfo[]): void {
    console.log(`[PEX] Received ${peers.length} peers from ${fromPeer}`);
    
    let newPeers = 0;
    const discoveredPeers: PeerInfo[] = [];

    for (const peer of peers) {
      // Skip if we already know this peer
      const existing = this.knownPeers.get(peer.peerId);
      
      if (!existing) {
        // New peer discovered!
        this.knownPeers.set(peer.peerId, {
          ...peer,
          lastSeen: Date.now()
        });
        discoveredPeers.push(peer);
        newPeers++;
      } else if (peer.lastSeen > existing.lastSeen) {
        // Update with fresher information
        this.knownPeers.set(peer.peerId, {
          ...existing,
          ...peer,
          lastSeen: Math.max(peer.lastSeen, existing.lastSeen)
        });
      }
    }

    if (newPeers > 0) {
      console.log(`[PEX] ✨ Discovered ${newPeers} new peers via PEX!`);
      if (this.onPeersDiscovered) {
        this.onPeersDiscovered(discoveredPeers);
      }
    }
  }

  /**
   * Add/update a known peer
   */
  updatePeer(info: PeerInfo): void {
    this.knownPeers.set(info.peerId, info);
  }

  /**
   * Get all known peers
   */
  getKnownPeers(): PeerInfo[] {
    return Array.from(this.knownPeers.values());
  }

  /**
   * Remove a peer from known list
   */
  removePeer(peerId: string): void {
    this.knownPeers.delete(peerId);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      knownPeers: this.knownPeers.size,
      activePeers: Array.from(this.knownPeers.values()).filter(
        p => Date.now() - p.lastSeen < 300000 // Active in last 5 min
      ).length
    };
  }
}
