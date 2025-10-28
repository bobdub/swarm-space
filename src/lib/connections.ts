/**
 * User Connection Management
 * Handles peer-to-peer user connections and relationships
 */

import { put, getAll, remove, get } from './store';
import { z } from 'zod';

export type ConnectionStatus = 'pending' | 'connected' | 'blocked';

export interface Connection {
  id: string;
  userId: string;        // The local user
  connectedUserId: string; // The peer user
  connectedUserName?: string; // Display name
  peerId?: string;       // P2P peer ID for direct connection
  status: ConnectionStatus;
  createdAt: string;
  connectedAt?: string;  // When connection was accepted
}

const ConnectionSchema = z.object({
  userId: z.string().min(1),
  connectedUserId: z.string().min(1),
  status: z.enum(['pending', 'connected', 'blocked'])
});

/**
 * Create a new connection request
 */
export async function createConnection(
  userId: string,
  connectedUserId: string,
  connectedUserName?: string,
  peerId?: string
): Promise<Connection> {
  // Validate input
  ConnectionSchema.parse({ userId, connectedUserId, status: 'pending' });

  // Check if connection already exists
  const existing = await getConnection(userId, connectedUserId);
  if (existing) {
    console.log('[Connections] Connection already exists:', existing.id);
    return existing;
  }

  const connection: Connection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    userId,
    connectedUserId,
    connectedUserName,
    peerId,
    status: 'connected', // Auto-accept for now (can add approval flow later)
    createdAt: new Date().toISOString(),
    connectedAt: new Date().toISOString()
  };

  await put('connections', connection);
  console.log('[Connections] Created connection:', connection.id);
  
  return connection;
}

/**
 * Get a specific connection between two users
 */
export async function getConnection(
  userId: string,
  connectedUserId: string
): Promise<Connection | null> {
  const connections = await getAll<Connection>('connections');
  
  // Check both directions (bidirectional connection)
  const connection = connections.find(
    c => (c.userId === userId && c.connectedUserId === connectedUserId) ||
         (c.userId === connectedUserId && c.connectedUserId === userId)
  );
  
  return connection || null;
}

/**
 * Get all connections for a user
 */
export async function getUserConnections(userId: string): Promise<Connection[]> {
  const connections = await getAll<Connection>('connections');
  
  return connections.filter(
    c => (c.userId === userId || c.connectedUserId === userId) && 
         c.status === 'connected'
  );
}

/**
 * Get all connected user IDs
 */
export async function getConnectedUserIds(userId: string): Promise<string[]> {
  const connections = await getUserConnections(userId);
  
  return connections.map(c => 
    c.userId === userId ? c.connectedUserId : c.userId
  );
}

/**
 * Check if two users are connected
 */
export async function areUsersConnected(
  userId: string,
  otherUserId: string
): Promise<boolean> {
  const connection = await getConnection(userId, otherUserId);
  return connection?.status === 'connected';
}

/**
 * Remove a connection
 */
export async function removeConnection(connectionId: string): Promise<void> {
  await remove('connections', connectionId);
  console.log('[Connections] Removed connection:', connectionId);
}

/**
 * Remove connection between two users
 */
export async function disconnectUsers(
  userId: string,
  connectedUserId: string
): Promise<void> {
  const connection = await getConnection(userId, connectedUserId);
  if (connection) {
    await removeConnection(connection.id);
  }
}

/**
 * Update connection with peer ID
 */
export async function updateConnectionPeerId(
  connectionId: string,
  peerId: string
): Promise<void> {
  const connection = await get<Connection>('connections', connectionId);
  if (!connection) {
    console.warn('[Connections] Connection not found:', connectionId);
    return;
  }

  const updated: Connection = {
    ...connection,
    peerId
  };

  await put('connections', updated);
  console.log('[Connections] Updated peer ID for connection:', connectionId);
}

/**
 * Get connection count for a user
 */
export async function getConnectionCount(userId: string): Promise<number> {
  const connections = await getUserConnections(userId);
  return connections.length;
}

/**
 * Block a user
 */
export async function blockUser(
  userId: string,
  blockedUserId: string
): Promise<Connection> {
  const existing = await getConnection(userId, blockedUserId);

  if (existing) {
    const updated: Connection = {
      ...existing,
      status: 'blocked'
    };
    await put('connections', updated);
    return updated;
  }

  // Create new blocked connection
  const connection: Connection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    userId,
    connectedUserId: blockedUserId,
    status: 'blocked',
    createdAt: new Date().toISOString()
  };

  await put('connections', connection);
  console.log('[Connections] Blocked user:', blockedUserId);

  return connection;
}

/**
 * List blocked user IDs for the given user
 */
export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const connections = await getAll<Connection>('connections');
  return connections
    .filter((connection) => connection.userId === userId && connection.status === 'blocked')
    .map((connection) => connection.connectedUserId);
}

/**
 * Remove a block between two users
 */
export async function unblockUser(
  userId: string,
  blockedUserId: string
): Promise<void> {
  const existing = await getConnection(userId, blockedUserId);
  if (!existing) {
    return;
  }

  if (existing.status !== 'blocked') {
    return;
  }

  if (existing.userId === userId) {
    await remove('connections', existing.id);
    console.log('[Connections] Unblocked user:', blockedUserId);
  } else {
    const updated: Connection = {
      ...existing,
      status: 'pending'
    };
    await put('connections', updated);
    console.log('[Connections] Unblocked user (shared connection updated):', blockedUserId);
  }
}
