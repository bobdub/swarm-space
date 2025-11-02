/**
 * User Connection Management
 * Handles peer-to-peer user connections and relationships
 */

import { put, getAll, remove, get } from './store';
import { z } from 'zod';

export type ConnectionStatus = 'pending' | 'connected' | 'blocked' | 'removed' | 'ignored';

export interface Connection {
  id: string;
  userId: string;        // The local user
  connectedUserId: string; // The peer user
  connectedUserName?: string; // Display name
  peerId?: string;       // P2P peer ID for direct connection
  lastPeerId?: string;   // Last known peer ID (even if currently disconnected)
  lastPeerIdAt?: string; // When the last peer ID was observed
  status: ConnectionStatus;
  createdAt: string;
  connectedAt?: string;  // When connection was accepted
  disconnectedAt?: string; // When connection was removed/hidden
}

const ConnectionSchema = z.object({
  userId: z.string().min(1),
  connectedUserId: z.string().min(1),
  status: z.enum(['pending', 'connected', 'blocked', 'removed', 'ignored'])
});

/**
 * Create a new connection request
 */
interface CreateConnectionOptions {
  force?: boolean;
}

export async function createConnection(
  userId: string,
  connectedUserId: string,
  connectedUserName?: string,
  peerId?: string,
  options?: CreateConnectionOptions
): Promise<Connection> {
  // Validate input
  ConnectionSchema.parse({ userId, connectedUserId, status: 'pending' });

  const existing = await getConnection(userId, connectedUserId);
  const now = new Date().toISOString();
  const force = options?.force ?? false;

  if (existing) {
    let changed = false;
    const updated: Connection = { ...existing };

    const canAutoConnect = existing.status === 'pending' || existing.status === 'connected';

    if (!force && !canAutoConnect) {
      if (connectedUserName && existing.connectedUserName !== connectedUserName) {
        updated.connectedUserName = connectedUserName;
        changed = true;
      }

      if (existing.peerId !== undefined) {
        updated.peerId = undefined;
        changed = true;
      }

      if (changed) {
        await put('connections', updated);
      }
      console.log('[Connections] Skipped auto-reconnect due to status:', existing.status);
      return updated;
    }

    if (existing.status !== 'connected') {
      updated.status = 'connected';
      changed = true;
    }

    if (!existing.connectedAt || existing.status !== 'connected') {
      updated.connectedAt = now;
      changed = true;
    }

    if (updated.disconnectedAt) {
      delete updated.disconnectedAt;
      changed = true;
    }

    if (connectedUserName && existing.connectedUserName !== connectedUserName) {
      updated.connectedUserName = connectedUserName;
      changed = true;
    }

    if (peerId && existing.peerId !== peerId) {
      updated.peerId = peerId;
      updated.lastPeerId = peerId;
      updated.lastPeerIdAt = now;
      changed = true;
    } else if (peerId && existing.lastPeerId !== peerId) {
      updated.lastPeerId = peerId;
      updated.lastPeerIdAt = now;
      changed = true;
    }

    if (changed) {
      await put('connections', updated);
      console.log('[Connections] Updated existing connection:', updated.id);
      return updated;
    }

    console.log('[Connections] Connection already exists:', existing.id);
    return existing;
  }

  const connection: Connection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    userId,
    connectedUserId,
    connectedUserName,
    peerId,
    lastPeerId: peerId,
    lastPeerIdAt: peerId ? now : undefined,
    status: 'connected', // Auto-accept for now (can add approval flow later)
    createdAt: now,
    connectedAt: now
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

  const relevant = connections.filter(
    c => (c.userId === userId || c.connectedUserId === userId) &&
         c.status === 'connected'
  );

  const unique = new Map<string, Connection>();

  for (const connection of relevant) {
    const otherUserId = connection.userId === userId
      ? connection.connectedUserId
      : connection.userId;

    const key = [userId, otherUserId].sort().join(':');
    const existing = unique.get(key);

    if (!existing) {
      unique.set(key, connection);
      continue;
    }

    if (existing.userId !== userId && connection.userId === userId) {
      unique.set(key, connection);
      continue;
    }

    if (!existing.connectedUserName && connection.connectedUserName) {
      unique.set(key, connection);
      continue;
    }

    if (!existing.peerId && connection.peerId) {
      unique.set(key, connection);
    }
  }

  return Array.from(unique.values());
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
  const connections = await getAll<Connection>('connections');

  const matches = connections.filter(c =>
    (c.userId === userId && c.connectedUserId === connectedUserId) ||
    (c.userId === connectedUserId && c.connectedUserId === userId)
  );

  const now = new Date().toISOString();

  await Promise.all(matches.map(async (connection) => {
    const updated: Connection = {
      ...connection,
      status: 'removed',
      connectedAt: undefined,
      peerId: undefined,
      disconnectedAt: now
    };

    await put('connections', updated);
    console.log('[Connections] Marked connection as removed:', connection.id);
  }));
}

/**
 * Update connection with peer ID
 */
export async function updateConnectionPeerId(
  connectionId: string,
  peerId: string | null
): Promise<void> {
  const connection = await get<Connection>('connections', connectionId);
  if (!connection) {
    console.warn('[Connections] Connection not found:', connectionId);
    return;
  }

  const nextPeerId = peerId ?? undefined;
  if (connection.peerId === nextPeerId) {
    return;
  }

  const updated: Connection = {
    ...connection,
    peerId: nextPeerId
  };

  if (nextPeerId) {
    updated.lastPeerId = nextPeerId;
    updated.lastPeerIdAt = new Date().toISOString();
  } else if (connection.peerId) {
    updated.lastPeerId = connection.peerId;
    updated.lastPeerIdAt = new Date().toISOString();
  }

  await put('connections', updated);
  console.log('[Connections] Updated peer ID for connection:', connectionId, '=>', nextPeerId ?? 'cleared');
}

export async function getConnectionByPeerId(peerId: string): Promise<Connection | null> {
  const connections = await getAll<Connection>('connections');
  const match = connections.find((connection) => connection.peerId === peerId);
  return match ?? null;
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
      status: 'blocked',
      connectedAt: undefined,
      peerId: undefined,
      disconnectedAt: new Date().toISOString()
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
    createdAt: new Date().toISOString(),
    disconnectedAt: new Date().toISOString()
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
      status: 'pending',
      disconnectedAt: undefined
    };
    await put('connections', updated);
    console.log('[Connections] Unblocked user (shared connection updated):', blockedUserId);
  }
}

export async function ignoreUser(
  userId: string,
  ignoredUserId: string
): Promise<void> {
  const connections = await getAll<Connection>('connections');
  const now = new Date().toISOString();
  let updated = false;

  const operations = connections.map(async (connection) => {
    if (connection.userId === userId && connection.connectedUserId === ignoredUserId) {
      const next: Connection = {
        ...connection,
        status: 'ignored',
        connectedAt: undefined,
        peerId: undefined,
        disconnectedAt: now
      };
      await put('connections', next);
      updated = true;
      console.log('[Connections] Ignored user:', ignoredUserId);
    } else if (connection.userId === ignoredUserId && connection.connectedUserId === userId) {
      await remove('connections', connection.id);
    }
  });

  await Promise.all(operations);

  if (!updated) {
    const connection: Connection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      userId,
      connectedUserId: ignoredUserId,
      status: 'ignored',
      createdAt: now,
      disconnectedAt: now
    };
    await put('connections', connection);
    console.log('[Connections] Created ignored connection entry:', connection.id);
  }
}

export async function restoreIgnoredUser(
  userId: string,
  ignoredUserId: string
): Promise<void> {
  const connections = await getAll<Connection>('connections');
  const now = new Date().toISOString();

  await Promise.all(connections.map(async (connection) => {
    if (connection.userId === userId && connection.connectedUserId === ignoredUserId && connection.status === 'ignored') {
      const updated: Connection = {
        ...connection,
        status: 'removed',
        peerId: undefined,
        connectedAt: undefined,
        disconnectedAt: now
      };
      await put('connections', updated);
      console.log('[Connections] Restored ignored user:', ignoredUserId);
    }
  }));
}

export async function getIgnoredUserIds(userId: string): Promise<string[]> {
  const connections = await getAll<Connection>('connections');
  return connections
    .filter((connection) => connection.userId === userId && connection.status === 'ignored')
    .map((connection) => connection.connectedUserId);
}
