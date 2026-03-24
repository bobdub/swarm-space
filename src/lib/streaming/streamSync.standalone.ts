/**
 * ═══════════════════════════════════════════════════════════════════════
 * STREAM SYNC — Standalone Live-Streaming Room Synchronization
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Broadcasts and receives StreamRoom snapshots over the SWARM mesh
 * channel system so that all connected peers can see and join live rooms.
 *
 * Design principles:
 *   - Zero imports from React or UI layers
 *   - Uses the mesh's channel:stream-rooms protocol
 *   - Maintains a local room registry that the StreamingContext reads
 *   - Does NOT modify the existing P2P standalone scripts
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Types (inline to stay standalone-friendly) ─────────────────────────

interface StreamRoomSnapshot {
  id: string;
  title: string;
  context: 'profile' | 'project';
  projectId?: string;
  visibility: 'public' | 'followers' | 'invite-only';
  state: 'idle' | 'live' | 'ended';
  hostPeerId: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  participants: Array<{
    peerId: string;
    userId: string;
    handle: string;
    role: 'host' | 'cohost' | 'speaker' | 'listener';
    audioMuted: boolean;
    videoMuted: boolean;
    joinedAt: string;
    lastHeartbeatAt: string;
    connection: 'direct' | 'turn';
  }>;
  invites: Array<{
    token: string;
    handle?: string;
    role: 'host' | 'cohost' | 'speaker' | 'listener';
    createdAt: string;
    expiresAt: string | null;
    revokedAt?: string | null;
  }>;
  recording?: {
    status: 'off' | 'starting' | 'recording' | 'stopping' | 'failed';
    recordingId?: string;
    retainUntil?: string | null;
    failureReason?: string | null;
  };
  summary?: {
    summaryId: string;
    language: string;
    bullets: string[];
    generatedAt: string;
  };
  turnRelays?: string[];
  broadcast?: {
    postId: string;
    promotedAt: string;
    state: 'backstage' | 'broadcast' | 'ended';
    updatedAt?: string;
  };
}

type StreamSyncMessageType =
  | 'room-snapshot'
  | 'room-ended'
  | 'room-request'
  | 'room-inventory';

interface StreamSyncEnvelope {
  msgType: StreamSyncMessageType;
  room?: StreamRoomSnapshot;
  roomId?: string;
  roomIds?: string[];
  ts: number;
}

type RoomChangeHandler = (room: StreamRoomSnapshot) => void;
type RoomEndedHandler = (roomId: string) => void;

// ── Constants ──────────────────────────────────────────────────────────

const CHANNEL_NAME = 'stream-rooms';
const INVENTORY_INTERVAL = 15_000;
const STALE_ROOM_THRESHOLD = 5 * 60 * 1000; // 5 min after ended

// ── Singleton State ────────────────────────────────────────────────────

const rooms = new Map<string, StreamRoomSnapshot>();
const roomChangeHandlers = new Set<RoomChangeHandler>();
const roomEndedHandlers = new Set<RoomEndedHandler>();

let meshRef: MeshLike | null = null;
let unsubChannel: (() => void) | null = null;
let inventoryTimer: ReturnType<typeof setInterval> | null = null;

// Minimal interface — only what we need from the SWARM mesh
interface MeshLike {
  broadcast(channel: string, payload: unknown): void;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
}

// ── Core Logic ─────────────────────────────────────────────────────────

function isEndedRoom(room: StreamRoomSnapshot | undefined): boolean {
  if (!room) return false;
  return room.state === 'ended' || room.broadcast?.state === 'ended' || Boolean(room.endedAt);
}

function getRoomOrderTs(room: StreamRoomSnapshot | undefined): number {
  if (!room) return 0;
  return new Date(
    room.broadcast?.updatedAt ??
      room.endedAt ??
      room.startedAt ??
      room.createdAt,
  ).getTime();
}

function mergeRoomSnapshot(
  existing: StreamRoomSnapshot | undefined,
  incoming: StreamRoomSnapshot,
  incomingEnvelopeTs: number,
): StreamRoomSnapshot {
  if (!existing) return incoming;

  const existingEnded = isEndedRoom(existing);
  const incomingEnded = isEndedRoom(incoming);

  // Ended is terminal authority: never regress to non-ended.
  if (existingEnded && !incomingEnded) {
    return existing;
  }
  if (!existingEnded && incomingEnded) {
    return incoming;
  }

  if (existingEnded && incomingEnded) {
    const existingEndedTs = new Date(existing.endedAt ?? existing.broadcast?.updatedAt ?? 0).getTime();
    const incomingEndedTs = new Date(incoming.endedAt ?? incoming.broadcast?.updatedAt ?? 0).getTime();
    return incomingEndedTs >= existingEndedTs ? incoming : existing;
  }

  const existingTs = getRoomOrderTs(existing);
  const incomingTs = Math.max(incomingEnvelopeTs, getRoomOrderTs(incoming));
  return incomingTs >= existingTs ? incoming : existing;
}

function handleIncoming(fromPeerId: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const envelope = raw as StreamSyncEnvelope;
  if (typeof envelope.msgType !== 'string') return;

  switch (envelope.msgType) {
    case 'room-snapshot': {
      if (!envelope.room) return;
      const incoming = envelope.room;
      const existing = rooms.get(incoming.id);

      const merged = mergeRoomSnapshot(existing, incoming, envelope.ts || 0);
      if (merged !== existing) {
        rooms.set(incoming.id, merged);
        console.log(`[StreamSync] 📡 Received room snapshot "${merged.title}" from ${fromPeerId}`);
        for (const h of roomChangeHandlers) {
          try { h(merged); } catch { /* ignore */ }
        }
        // Dispatch event for StreamingContext to pick up
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('stream-room-sync', { detail: merged }));
        }
      } else if (isEndedRoom(existing) && !isEndedRoom(incoming) && typeof window !== 'undefined') {
        // Out-of-order stale snapshot attempted to revive an ended room.
        // Re-announce terminal state locally so joinability invalidates immediately.
        window.dispatchEvent(new CustomEvent('stream-room-ended', {
          detail: {
            roomId: existing?.id,
            endedAt: existing?.endedAt ?? existing?.broadcast?.updatedAt ?? new Date().toISOString(),
            room: existing,
          },
        }));
      }

      if (isEndedRoom(merged) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('stream-room-ended', {
          detail: {
            roomId: merged.id,
            endedAt: merged.endedAt ?? merged.broadcast?.updatedAt ?? new Date().toISOString(),
            room: merged,
          },
        }));
      }
      break;
    }

    case 'room-ended': {
      const roomId = envelope.roomId ?? envelope.room?.id;
      if (!roomId) return;

      const nowIso = new Date().toISOString();
      const existing = rooms.get(roomId);
      const baseRoom = envelope.room ?? existing;
      const endedAt = baseRoom?.endedAt ?? envelope.room?.broadcast?.updatedAt ?? nowIso;
      const authoritativeRoom: StreamRoomSnapshot | undefined = baseRoom
        ? {
            ...baseRoom,
            id: roomId,
            state: 'ended',
            endedAt,
            broadcast: baseRoom.broadcast
              ? {
                  ...baseRoom.broadcast,
                  state: 'ended',
                  updatedAt: endedAt,
                }
              : baseRoom.broadcast,
          }
        : undefined;

      if (authoritativeRoom) {
        rooms.set(roomId, authoritativeRoom);
      }

      console.log(`[StreamSync] 🔴 Room ended: ${roomId}`);
      for (const h of roomEndedHandlers) {
        try { h(roomId); } catch { /* ignore */ }
      }
      if (typeof window !== 'undefined') {
        if (authoritativeRoom) {
          window.dispatchEvent(new CustomEvent('stream-room-sync', { detail: authoritativeRoom }));
        }
        window.dispatchEvent(new CustomEvent('stream-room-ended', {
          detail: {
            roomId,
            endedAt,
            room: authoritativeRoom,
          },
        }));
      }
      break;
    }

    case 'room-inventory': {
      // Peer is advertising which rooms they know about — respond with any they're missing
      const peerRoomIds = envelope.roomIds;
      if (!Array.isArray(peerRoomIds)) return;
      const ourRooms = Array.from(rooms.values()).filter(r => r.state !== 'ended');
      for (const room of ourRooms) {
        if (!peerRoomIds.includes(room.id)) {
          // They don't have this room — send it
          meshRef?.broadcast(CHANNEL_NAME, {
            msgType: 'room-snapshot',
            room,
            ts: Date.now(),
          } satisfies StreamSyncEnvelope);
        }
      }
      break;
    }

    case 'room-request': {
      // Peer is asking for a specific room
      const roomId = envelope.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (room) {
        meshRef?.broadcast(CHANNEL_NAME, {
          msgType: 'room-snapshot',
          room,
          ts: Date.now(),
        } satisfies StreamSyncEnvelope);
      }
      break;
    }
  }
}

function pruneEndedRooms(): void {
  const cutoff = Date.now() - STALE_ROOM_THRESHOLD;
  for (const [id, room] of rooms) {
    if (room.state === 'ended' && room.endedAt) {
      const endedTs = new Date(room.endedAt).getTime();
      if (endedTs < cutoff) {
        rooms.delete(id);
      }
    }
  }
}

function sendInventory(): void {
  if (!meshRef) return;
  pruneEndedRooms();
  const activeIds = Array.from(rooms.values())
    .filter(r => r.state !== 'ended')
    .map(r => r.id);
  if (activeIds.length > 0 || meshRef.getConnectedPeerIds().length > 0) {
    meshRef.broadcast(CHANNEL_NAME, {
      msgType: 'room-inventory',
      roomIds: activeIds,
      ts: Date.now(),
    } satisfies StreamSyncEnvelope);
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function startStreamSync(mesh: MeshLike): () => void {
  if (meshRef === mesh && unsubChannel) {
    return () => stopStreamSync();
  }

  stopStreamSync();
  meshRef = mesh;

  unsubChannel = mesh.onMessage(CHANNEL_NAME, handleIncoming);

  inventoryTimer = setInterval(sendInventory, INVENTORY_INTERVAL);

  // Send initial inventory after a short delay to let connections settle
  setTimeout(sendInventory, 3000);

  console.log('[StreamSync] ✅ Stream room sync started');
  return () => stopStreamSync();
}

export function stopStreamSync(): void {
  if (unsubChannel) {
    unsubChannel();
    unsubChannel = null;
  }
  if (inventoryTimer !== null) {
    clearInterval(inventoryTimer);
    inventoryTimer = null;
  }
  meshRef = null;
  console.log('[StreamSync] ⏹ Stream room sync stopped');
}

/**
 * Broadcast a room snapshot to all connected peers.
 * Called when the local user creates, updates, or promotes a room.
 */
export function broadcastRoom(room: StreamRoomSnapshot): void {
  rooms.set(room.id, room);
  if (!meshRef) {
    console.warn('[StreamSync] No mesh attached — room stored locally only');
    return;
  }
  meshRef.broadcast(CHANNEL_NAME, {
    msgType: 'room-snapshot',
    room,
    ts: Date.now(),
  } satisfies StreamSyncEnvelope);
  console.log(`[StreamSync] 📤 Broadcast room "${room.title}" to peers`);
}

/**
 * Broadcast that a room has ended.
 */
export function broadcastRoomEnded(
  roomId: string,
  options?: {
    endedAt?: string;
    recordingId?: string | null;
    room?: StreamRoomSnapshot;
  },
): void {
  const endedAt = options?.endedAt ?? new Date().toISOString();
  const existing = options?.room ?? rooms.get(roomId);
  const authoritativeRoom = existing
    ? {
        ...existing,
        id: roomId,
        state: 'ended' as const,
        endedAt,
        recording: existing.recording || options?.recordingId
          ? {
              ...(existing.recording ?? { status: 'off' as const }),
              recordingId: options?.recordingId ?? existing.recording?.recordingId,
            }
          : existing.recording,
        broadcast: existing.broadcast
          ? {
              ...existing.broadcast,
              state: 'ended' as const,
              updatedAt: endedAt,
            }
          : existing.broadcast,
      }
    : undefined;

  if (authoritativeRoom) {
    rooms.set(roomId, authoritativeRoom);
  }
  if (!meshRef) return;
  if (authoritativeRoom) {
    meshRef.broadcast(CHANNEL_NAME, {
      msgType: 'room-snapshot',
      room: authoritativeRoom,
      ts: Date.now(),
    } satisfies StreamSyncEnvelope);
  }
  meshRef.broadcast(CHANNEL_NAME, {
    msgType: 'room-ended',
    roomId,
    room: authoritativeRoom,
    ts: Date.now(),
  } satisfies StreamSyncEnvelope);
  console.log(`[StreamSync] 📤 Broadcast room ended: ${roomId}`);
}

/**
 * Request a specific room from peers (e.g. when hydrating from a post).
 */
export function requestRoom(roomId: string): void {
  if (!meshRef) return;
  meshRef.broadcast(CHANNEL_NAME, {
    msgType: 'room-request',
    roomId,
    ts: Date.now(),
  } satisfies StreamSyncEnvelope);
}

/**
 * Get all known rooms (both local and received from peers).
 */
export function getKnownRooms(): StreamRoomSnapshot[] {
  return Array.from(rooms.values());
}

/**
 * Get a specific room by ID.
 */
export function getKnownRoom(roomId: string): StreamRoomSnapshot | undefined {
  return rooms.get(roomId);
}

/**
 * Subscribe to room changes (new rooms or updates).
 */
export function onRoomChange(handler: RoomChangeHandler): () => void {
  roomChangeHandlers.add(handler);
  return () => { roomChangeHandlers.delete(handler); };
}

/**
 * Subscribe to room ended events.
 */
export function onRoomEnded(handler: RoomEndedHandler): () => void {
  roomEndedHandlers.add(handler);
  return () => { roomEndedHandlers.delete(handler); };
}

/**
 * Inject a room directly (e.g. from local creation).
 */
export function injectLocalRoom(room: StreamRoomSnapshot): void {
  rooms.set(room.id, room);
}
