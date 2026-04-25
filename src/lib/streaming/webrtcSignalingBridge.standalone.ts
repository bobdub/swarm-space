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
    | 'chat-message'
    | 'presence'
    | 'room-hello';
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
  replyToId?: string;
  replyToUsername?: string;
  replyToPreview?: string;
}
type RoomChatHandler = (message: RoomChatMessage) => void;

/** Lightweight presence broadcast — who you are and which avatar you chose. */
export interface RoomPresence {
  roomId: string;
  peerId: string;
  userId?: string;
  username?: string;
  avatarId?: string;
  color?: string;
  /**
   * World-space position of this peer's avatar (sim units). Optional —
   * scenes that don't track a 3D body simply omit it. Used by the Brain
   * Universe so every peer knows the *actual* location of every other
   * peer (instead of only the deterministic spawn estimate), which makes
   * spawn-overlap and "stuck off Earth" bugs traceable across the mesh.
   */
  position?: [number, number, number];
  /**
   * Brain physics protocol version. Absent → pre-versioning peer (v0).
   * Consumers compare against `BRAIN_PHYSICS_VERSION` to decide whether
   * to trust the broadcast altitude or pin the avatar to the shell.
   */
  pv?: number;
  ts: number;
}
type RoomPresenceHandler = (presence: RoomPresence) => void;

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
let meshExpansionTimer: ReturnType<typeof setInterval> | null = null;
let knownPeerSnapshot: Set<string> = new Set();
const signalHandlers = new Set<SignalHandler>();
const roomChatHandlers = new Set<RoomChatHandler>();
const roomChatLog = new Map<string, RoomChatMessage[]>();
const roomPresenceHandlers = new Set<RoomPresenceHandler>();
/** roomId -> peerId -> presence */
const roomPresenceLog = new Map<string, Map<string, RoomPresence>>();
/** Most recent presence WE broadcast for each room (for replay to new peers). */
const myLastPresence = new Map<string, RoomPresence>();
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
      const data = envelope.data as { id?: string; text?: string; ts?: number; avatarRef?: string; replyToId?: string; replyToUsername?: string; replyToPreview?: string };
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
        replyToId: typeof data.replyToId === 'string' ? data.replyToId : undefined,
        replyToUsername: typeof data.replyToUsername === 'string' ? data.replyToUsername : undefined,
        replyToPreview: typeof data.replyToPreview === 'string' ? data.replyToPreview : undefined,
      };
      appendRoomChatMessage(message);
      break;
    }

    case 'presence': {
      if (!envelope.data || typeof envelope.data !== 'object') return;
      const data = envelope.data as {
        avatarId?: string;
        color?: string;
        position?: unknown;
        pv?: unknown;
      };
      const pos = Array.isArray(data.position) && data.position.length === 3
        && data.position.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? ([data.position[0], data.position[1], data.position[2]] as [number, number, number])
        : undefined;
      const pv = typeof data.pv === 'number' && Number.isFinite(data.pv) ? data.pv : undefined;
      const presence: RoomPresence = {
        roomId: envelope.roomId,
        peerId: envelope.from,
        userId: envelope.userId,
        username: envelope.username,
        avatarId: typeof data.avatarId === 'string' ? data.avatarId : undefined,
        color: typeof data.color === 'string' ? data.color : undefined,
        position: pos,
        pv,
        ts: envelope.ts,
      };
      let bucket = roomPresenceLog.get(envelope.roomId);
      if (!bucket) {
        bucket = new Map();
        roomPresenceLog.set(envelope.roomId, bucket);
      }
      bucket.set(envelope.from, presence);
      for (const handler of roomPresenceHandlers) {
        try { handler(presence); } catch { /* ignore */ }
      }
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
  roomPresenceLog.clear();
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
  replyTo?: { id: string; username: string; preview: string },
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
    replyToId: replyTo?.id,
    replyToUsername: replyTo?.username,
    replyToPreview: replyTo?.preview,
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
      replyToId: replyTo?.id,
      replyToUsername: replyTo?.username,
      replyToPreview: replyTo?.preview,
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
 * Broadcast our presence (avatar + identity) into a room. Called on join
 * and re-broadcast whenever a new peer announces a join, so late joiners
 * always learn existing avatars.
 */
export function sendRoomPresence(
  roomId: string,
  presence: {
    peerId?: string;
    userId?: string;
    username?: string;
    avatarId?: string;
    color?: string;
    position?: [number, number, number];
    pv?: number;
  },
): void {
  if (!meshRef) return;
  const ts = Date.now();
  const envelope: SignalEnvelope = {
    msgType: 'presence',
    from: meshRef.getPeerId(),
    roomId,
    userId: presence.userId,
    username: presence.username,
    data: {
      avatarId: presence.avatarId,
      color: presence.color,
      position: presence.position,
      pv: presence.pv,
    },
    ts,
  };
  // Cache locally so getRoomPresence(roomId) is consistent on the sender side too.
  let bucket = roomPresenceLog.get(roomId);
  if (!bucket) {
    bucket = new Map();
    roomPresenceLog.set(roomId, bucket);
  }
  bucket.set(meshRef.getPeerId(), {
    roomId,
    peerId: meshRef.getPeerId(),
    userId: presence.userId,
    username: presence.username,
    avatarId: presence.avatarId,
    color: presence.color,
    position: presence.position,
    pv: presence.pv,
    ts,
  });
  meshRef.broadcast(SIGNAL_CHANNEL, envelope);
}

export function onRoomPresence(handler: RoomPresenceHandler): () => void {
  roomPresenceHandlers.add(handler);
  return () => { roomPresenceHandlers.delete(handler); };
}

export function getRoomPresences(roomId: string): RoomPresence[] {
  const bucket = roomPresenceLog.get(roomId);
  if (!bucket) return [];
  return Array.from(bucket.values());
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
