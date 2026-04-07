/**
 * ═══════════════════════════════════════════════════════════════════════
 * WEBRTC SIGNALING BRIDGE — Routes WebRTC signals through SWARM Mesh
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bridges WebRTC offer/answer/ICE candidate exchange over the mesh's
 * channel system so peers can establish real audio/video connections.
 *
 * Design principles:
 *   - Standalone: zero React imports
 *   - Uses mesh channel:webrtc-signal for signaling
 *   - Uses mesh channel:webrtc-room for room join/leave coordination
 *   - Each peer's WebRTCManager calls into this bridge to send signals
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Types ──────────────────────────────────────────────────────────────

interface SignalEnvelope {
  msgType:
    | 'offer'
    | 'answer'
    | 'candidate'
    | 'join-room'
    | 'leave-room'
    | 'room-sync'
    | 'reconnect-request'
    | 'reconnect-ack'
    | 'chat-message';
  from: string;       // mesh peerId (peer-xxx)
  to?: string;        // target mesh peerId (for directed signals)
  roomId: string;
  userId?: string;
  username?: string;
  avatarRef?: string;
  data?: unknown;      // SDP or ICE candidate
  participants?: string[]; // for room-sync
  ts: number;
}

type SignalHandler = (envelope: SignalEnvelope) => void;
export interface RoomChatMessage {
  id: string;
  roomId: string;
  senderPeerId: string;
  senderUserId?: string;
  senderUsername?: string;
  senderAvatarRef?: string;
  text: string;
  ts: number;
}
type RoomChatHandler = (message: RoomChatMessage) => void;

// Minimal mesh interface
interface MeshLike {
  broadcast(channel: string, payload: unknown): void;
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
  getPeerId(): string;
}

// ── Constants ──────────────────────────────────────────────────────────

const SIGNAL_CHANNEL = 'webrtc-signal';

// ── Singleton State ────────────────────────────────────────────────────

let meshRef: MeshLike | null = null;
let unsubChannel: (() => void) | null = null;
const signalHandlers = new Set<SignalHandler>();
const roomChatHandlers = new Set<RoomChatHandler>();
const roomChatLog = new Map<string, RoomChatMessage[]>();
const MAX_CHAT_MESSAGES_PER_ROOM = 200;

// Track which rooms we've joined (roomId -> participant mesh peerIds)
const joinedRooms = new Map<string, Set<string>>();

// ── Incoming Handler ───────────────────────────────────────────────────

function handleIncoming(_fromPeerId: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const envelope = raw as SignalEnvelope;
  if (typeof envelope.msgType !== 'string' || !envelope.roomId) return;

  const myPeerId = meshRef?.getPeerId();

  // If directed signal, only process if addressed to us
  if (envelope.to && envelope.to !== myPeerId) return;

  switch (envelope.msgType) {
    case 'join-room': {
      // A peer wants to join a room we're in
      const room = joinedRooms.get(envelope.roomId);
      if (room && myPeerId) {
        room.add(envelope.from);
        console.log(`[WebRTC-Bridge] 👋 ${envelope.from} joined room ${envelope.roomId}`);
        
        // Send room-sync so joining peer knows who's here
        meshRef?.send(SIGNAL_CHANNEL, envelope.from, {
          msgType: 'room-sync',
          from: myPeerId,
          roomId: envelope.roomId,
          participants: Array.from(room),
          userId: envelope.userId,
          ts: Date.now(),
        } satisfies SignalEnvelope);
      }
      // Forward to handlers (WebRTCManager will create offer)
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'room-sync': {
      // We're joining and received the participant list
      const room = joinedRooms.get(envelope.roomId);
      if (room) {
        const participants = envelope.participants ?? [];
        for (const p of participants) room.add(p);
      }
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'leave-room': {
      const room = joinedRooms.get(envelope.roomId);
      if (room) {
        room.delete(envelope.from);
        console.log(`[WebRTC-Bridge] 👋 ${envelope.from} left room ${envelope.roomId}`);
      }
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'offer':
    case 'answer':
    case 'candidate': {
      console.log(`[WebRTC-Bridge] 📥 Received ${envelope.msgType} from ${envelope.from}`);
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'reconnect-request':
    case 'reconnect-ack': {
      console.log(`[WebRTC-Bridge] 🔄 Received ${envelope.msgType} from ${envelope.from}`);
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'chat-message': {
      if (!envelope.data || typeof envelope.data !== 'object') return;
      const data = envelope.data as { id?: string; text?: string; ts?: number; avatarRef?: string };
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return;
      const message: RoomChatMessage = {
        id: data.id ?? `${envelope.roomId}:${envelope.from}:${envelope.ts}`,
        roomId: envelope.roomId,
        senderPeerId: envelope.from,
        senderUserId: envelope.userId,
        senderUsername: envelope.username,
        senderAvatarRef: typeof data.avatarRef === "string" ? data.avatarRef : envelope.avatarRef,
        text,
        ts: typeof data.ts === 'number' ? data.ts : envelope.ts,
      };
      appendRoomChatMessage(message);
      break;
    }
  }
}

function appendRoomChatMessage(message: RoomChatMessage): void {
  const existing = roomChatLog.get(message.roomId) ?? [];
  if (existing.some((entry) => entry.id === message.id)) {
    return;
  }
  existing.push(message);
  if (existing.length > MAX_CHAT_MESSAGES_PER_ROOM) {
    existing.splice(0, existing.length - MAX_CHAT_MESSAGES_PER_ROOM);
  }
  roomChatLog.set(message.roomId, existing);
  for (const handler of roomChatHandlers) {
    try { handler(message); } catch { /* ignore */ }
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function startSignalingBridge(mesh: MeshLike): () => void {
  if (meshRef === mesh && unsubChannel) return () => stopSignalingBridge();

  stopSignalingBridge();
  meshRef = mesh;
  unsubChannel = mesh.onMessage(SIGNAL_CHANNEL, handleIncoming);
  console.log('[WebRTC-Bridge] ✅ Signaling bridge started');
  return () => stopSignalingBridge();
}

export function stopSignalingBridge(): void {
  if (unsubChannel) {
    unsubChannel();
    unsubChannel = null;
  }
  meshRef = null;
  joinedRooms.clear();
  roomChatLog.clear();
  console.log('[WebRTC-Bridge] ⏹ Signaling bridge stopped');
}

/**
 * Send a WebRTC signal (offer/answer/ICE) to a specific peer via mesh.
 */
export function sendSignalViaMesh(
  toPeerId: string,
  roomId: string,
  type: 'offer' | 'answer' | 'candidate',
  data: unknown,
): void {
  if (!meshRef) {
    console.warn('[WebRTC-Bridge] No mesh — signal dropped');
    return;
  }
  const envelope: SignalEnvelope = {
    msgType: type,
    from: meshRef.getPeerId(),
    to: toPeerId,
    roomId,
    data,
    ts: Date.now(),
  };
  // Send directly to target peer
  meshRef.send(SIGNAL_CHANNEL, toPeerId, envelope).catch(() => {
    // Fallback: broadcast (peer will filter by `to` field)
    meshRef?.broadcast(SIGNAL_CHANNEL, envelope);
  });
}

/**
 * Send a reconnect-request or reconnect-ack to a specific peer.
 */
export function sendReconnectRequest(
  toPeerId: string,
  roomId: string,
  type: 'reconnect-request' | 'reconnect-ack',
): void {
  if (!meshRef) {
    console.warn('[WebRTC-Bridge] No mesh — reconnect signal dropped');
    return;
  }
  const envelope: SignalEnvelope = {
    msgType: type,
    from: meshRef.getPeerId(),
    to: toPeerId,
    roomId,
    ts: Date.now(),
  };
  meshRef.send(SIGNAL_CHANNEL, toPeerId, envelope).catch(() => {
    meshRef?.broadcast(SIGNAL_CHANNEL, envelope);
  });
}

/**
 * Announce joining a room — existing participants will respond with offers.
 */
export function announceJoinRoom(roomId: string, userId: string, username: string): void {
  if (!meshRef) return;

  // Enforce single-room membership — leave stale rooms first
  for (const existingRoomId of Array.from(joinedRooms.keys())) {
    if (existingRoomId !== roomId) {
      announceLeaveRoom(existingRoomId);
    }
  }
  
  if (!joinedRooms.has(roomId)) joinedRooms.set(roomId, new Set());
  joinedRooms.get(roomId)!.add(meshRef.getPeerId());

  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'join-room',
    from: meshRef.getPeerId(),
    roomId,
    userId,
    username,
    ts: Date.now(),
  } satisfies SignalEnvelope);
  console.log(`[WebRTC-Bridge] 📤 Announced join for room ${roomId}`);
}

/**
 * Announce leaving a room.
 */
export function announceLeaveRoom(roomId: string): void {
  if (!meshRef) return;
  
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'leave-room',
    from: meshRef.getPeerId(),
    roomId,
    ts: Date.now(),
  } satisfies SignalEnvelope);
  joinedRooms.delete(roomId);
}

export function sendRoomChatMessage(
  roomId: string,
  text: string,
  userId?: string,
  username?: string,
  avatarRef?: string,
): void {
  if (!meshRef) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const message: RoomChatMessage = {
    id: `${roomId}:${meshRef.getPeerId()}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    senderPeerId: meshRef.getPeerId(),
    senderUserId: userId,
    senderUsername: username,
    senderAvatarRef: avatarRef,
    text: trimmed,
    ts: Date.now(),
  };
  appendRoomChatMessage(message);
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'chat-message',
    from: message.senderPeerId,
    roomId,
    userId,
    username,
    avatarRef,
    data: {
      id: message.id,
      text: message.text,
      ts: message.ts,
      avatarRef,
    },
    ts: message.ts,
  } satisfies SignalEnvelope);
}

export function onRoomChatMessage(handler: RoomChatHandler): () => void {
  roomChatHandlers.add(handler);
  return () => {
    roomChatHandlers.delete(handler);
  };
}

export function getRoomChatMessages(roomId: string): RoomChatMessage[] {
  return [...(roomChatLog.get(roomId) ?? [])].sort((a, b) => a.ts - b.ts);
}

/**
 * Subscribe to incoming signals (WebRTCManager listens here).
 */
export function onSignal(handler: SignalHandler): () => void {
  signalHandlers.add(handler);
  return () => { signalHandlers.delete(handler); };
}

/**
 * Get our mesh peer ID.
 */
export function getLocalMeshPeerId(): string | null {
  return meshRef?.getPeerId() ?? null;
}

/**
 * Check if bridge is active.
 */
export function isBridgeActive(): boolean {
  return meshRef !== null;
}
