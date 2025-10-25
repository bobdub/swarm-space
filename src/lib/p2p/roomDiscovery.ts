/**
 * Room-based Peer Discovery
 * 
 * Simple mechanism for peers to find each other by joining a common "room".
 * Uses localStorage to persist room memberships and PeerJS broadcast to announce.
 */

export interface RoomPeer {
  peerId: string;
  userId: string;
  lastSeen: number;
}

export class RoomDiscovery {
  private currentRoom: string | null = null;
  private roomPeers = new Map<string, RoomPeer>();
  private onPeerDiscovered?: (peerId: string) => void;

  constructor(onPeerDiscovered?: (peerId: string) => void) {
    this.onPeerDiscovered = onPeerDiscovered;
    this.loadPersistedRoom();
  }

  /**
   * Join a discovery room
   */
  joinRoom(roomName: string): void {
    const normalized = roomName.toLowerCase().trim();
    if (!normalized) return;

    console.log('[RoomDiscovery] Joining room:', normalized);
    this.currentRoom = normalized;
    localStorage.setItem('p2p-room', normalized);
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    if (this.currentRoom) {
      console.log('[RoomDiscovery] Leaving room:', this.currentRoom);
      this.currentRoom = null;
      this.roomPeers.clear();
      localStorage.removeItem('p2p-room');
    }
  }

  /**
   * Get current room name
   */
  getCurrentRoom(): string | null {
    return this.currentRoom;
  }

  /**
   * Handle peer announcement
   */
  handleAnnouncement(peerId: string, userId: string, room: string | undefined): void {
    if (!this.currentRoom || !room) return;
    
    // Only track peers in the same room
    if (room !== this.currentRoom) return;

    const existing = this.roomPeers.get(peerId);
    if (!existing) {
      console.log(`[RoomDiscovery] Discovered peer ${peerId} in room ${room}`);
      this.roomPeers.set(peerId, {
        peerId,
        userId,
        lastSeen: Date.now()
      });
      
      // Notify about new peer
      if (this.onPeerDiscovered) {
        this.onPeerDiscovered(peerId);
      }
    } else {
      // Update last seen
      existing.lastSeen = Date.now();
    }
  }

  /**
   * Get all peers in current room
   */
  getRoomPeers(): RoomPeer[] {
    return Array.from(this.roomPeers.values());
  }

  /**
   * Remove stale peers
   */
  cleanup(maxAge: number = 60000): void {
    const now = Date.now();
    const stale: string[] = [];

    for (const [peerId, peer] of this.roomPeers.entries()) {
      if (now - peer.lastSeen > maxAge) {
        stale.push(peerId);
      }
    }

    stale.forEach(id => {
      console.log('[RoomDiscovery] Removing stale peer:', id);
      this.roomPeers.delete(id);
    });
  }

  /**
   * Remove specific peer
   */
  removePeer(peerId: string): void {
    this.roomPeers.delete(peerId);
  }

  private loadPersistedRoom(): void {
    const saved = localStorage.getItem('p2p-room');
    if (saved) {
      this.currentRoom = saved;
      console.log('[RoomDiscovery] Loaded persisted room:', saved);
    }
  }
}
