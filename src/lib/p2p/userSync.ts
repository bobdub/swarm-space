/**
 * User Profile Synchronization Protocol
 * 
 * Syncs user profiles between peers so avatars, bios, and other profile data
 * are available when viewing other users' content.
 */

import { put, get, getAll } from '../store';
import { UserMeta } from '../auth';

type SendMessageFn = (peerId: string, message: UserSyncMessage) => void;
type ConnectedPeersFn = () => string[];

export interface UserSyncMessage {
  type: 'users_request' | 'users_sync' | 'user_updated';
  users?: UserMeta[];
  user?: UserMeta;
}

export class UserSyncManager {
  constructor(
    private sendMessage: SendMessageFn,
    private getConnectedPeers: ConnectedPeersFn
  ) {
    console.log('[UserSync] Manager initialized');
  }

  /**
   * Type guard for user sync messages
   */
  isUserSyncMessage(message: unknown): message is UserSyncMessage {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      typeof (message as UserSyncMessage).type === 'string' &&
      ['users_request', 'users_sync', 'user_updated'].includes((message as UserSyncMessage).type)
    );
  }

  /**
   * Handle new peer connection - initiate user sync
   */
  async handlePeerConnected(peerId: string): Promise<void> {
    console.log(`[UserSync] 🔄 Peer ${peerId} connected, initiating user sync`);
    
    // Send our user profile immediately
    const currentUser = await this.getCurrentUserProfile();
    if (currentUser) {
      this.sendMessage(peerId, {
        type: 'user_updated',
        user: currentUser
      });
    }
    
    // Request their user profiles
    this.sendMessage(peerId, { type: 'users_request' });
  }

  /**
   * Handle incoming user sync messages
   */
  async handleMessage(peerId: string, message: UserSyncMessage): Promise<void> {
    console.log(`[UserSync] 📨 Received ${message.type} from ${peerId}`);

    switch (message.type) {
      case 'users_request':
        await this.sendAllUsersToPeer(peerId);
        break;
      
      case 'users_sync':
        if (message.users && Array.isArray(message.users)) {
          await this.saveIncomingUsers(message.users);
        }
        break;
      
      case 'user_updated':
        if (message.user) {
          await this.upsertUser(message.user);
        }
        break;
    }
  }

  /**
   * Handle peer disconnection
   */
  async handlePeerDisconnected(peerId: string): Promise<void> {
    console.log(`[UserSync] Peer ${peerId} disconnected`);
  }

  /**
   * Broadcast user profile update to all peers
   */
  broadcastUserUpdate(user: UserMeta): void {
    const connectedPeers = this.getConnectedPeers();
    console.log(`[UserSync] 📢 Broadcasting user update to ${connectedPeers.length} peers`);
    
    for (const peerId of connectedPeers) {
      this.sendMessage(peerId, {
        type: 'user_updated',
        user
      });
    }
  }

  /**
   * Get current user profile from storage
   */
  private async getCurrentUserProfile(): Promise<UserMeta | null> {
    const stored = localStorage.getItem("me");
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  /**
   * Send all user profiles to a specific peer
   */
  private async sendAllUsersToPeer(peerId: string): Promise<void> {
    console.log(`[UserSync] 📤 Sending all users to ${peerId}`);
    
    const users = await getAll('users') as UserMeta[];
    console.log(`[UserSync] Found ${users.length} users to send`);
    
    this.sendMessage(peerId, {
      type: 'users_sync',
      users
    });
  }

  /**
   * Save incoming users from peer
   */
  private async saveIncomingUsers(users: UserMeta[]): Promise<void> {
    console.log(`[UserSync] 💾 Saving ${users.length} incoming users`);
    
    let newCount = 0;
    let updatedCount = 0;
    
    for (const user of users) {
      const wasNew = await this.upsertUser(user);
      if (wasNew) newCount++;
      else updatedCount++;
    }
    
    console.log(`[UserSync] ✅ Saved ${newCount} new, ${updatedCount} updated users`);
  }

  /**
   * Insert or update a user profile
   */
  private async upsertUser(user: UserMeta): Promise<boolean> {
    const existing = await get('users', user.id) as UserMeta | undefined;
    
    if (!existing) {
      console.log(`[UserSync] 📝 New user: ${user.username}`);
      await put('users', user);
      return true;
    }
    
    // Update if incoming is newer
    const existingTime = new Date(existing.createdAt).getTime();
    const incomingTime = new Date(user.createdAt).getTime();
    
    if (incomingTime >= existingTime) {
      console.log(`[UserSync] 🔄 Updating user: ${user.username}`);
      await put('users', user);
      return false;
    }
    
    return false;
  }
}
