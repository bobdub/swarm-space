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
    | 'room-heartbeat'
    | 'room-sync'
    | 'reconnect-request'
    | 'reconnect-ack'
    | 'chat-message'
    | 'screen-share-state'
    | 'media-state'
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
  /** Relay hop count (absent = direct). */
  hops?: number;
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
  /** Prompt correlation; transport sender remains the generating user. */
  infinityReplyTo?: string;
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
/** roomId -> last hello timestamp. Prevents preview + dock duplicate hellos from offer-storming the room. */
const lastHelloAt = new Map<string, number>();
const MAX_CHAT_MESSAGES_PER_ROOM = 200;

// Track which rooms we've joined (roomId -> participant mesh peerIds)
const joinedRooms = new Map<string, Set<string>>();

// ── Departed / silent peer tracking ────────────────────────────────────
/** `${roomId}|${peerId}` -> time the peer left. Stale echoes never revive them. */
const departedAt = new Map<string, number>();
/** `${roomId}|${peerId}` -> last time we heard anything from the peer. */
const lastHeardAt = new Map<string, number>();
const presenceRemovedHandlers = new Set<(roomId: string, peerId: string) => void>();
export const ROOM_PEER_SILENCE_MS = 20_000;
const ROOM_HEARTBEAT_MS = 7_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
const roomKey = (roomId: string, peerId: string) => `${roomId}|${peerId}`;

/** Subscribe to "this peer is gone from the room" (left or went silent). */
export function onRoomPresenceRemoved(handler: (roomId: string, peerId: string) => void): () => void {
  presenceRemovedHandlers.add(handler);
  return () => { presenceRemovedHandlers.delete(handler); };
}

/** Forget a peer in a room everywhere and tell local listeners. */
function evictRoomPeer(roomId: string, peerId: string, reason: 'left' | 'silent'): void {
  joinedRooms.get(roomId)?.delete(peerId);
  roomPresenceLog.get(roomId)?.delete(peerId);
  lastHeardAt.delete(roomKey(roomId, peerId));
  departedAt.set(roomKey(roomId, peerId), Date.now());
  if (reason === 'silent') {
    console.log(`[WebRTC-Bridge] 💤 ${peerId} silent in ${roomId} — removing`);
    for (const h of signalHandlers) {
      try { h({ msgType: 'leave-room', from: peerId, roomId, ts: Date.now() }); } catch { /* ignore */ }
    }
  }
  for (const h of presenceRemovedHandlers) {
    try { h(roomId, peerId); } catch { /* ignore */ }
  }
}

/** Test/internal: remove peers silent longer than the window. */
export function sweepSilentRoomPeers(now: number = Date.now()): void {
  const myPeerId = meshRef?.getPeerId();
  for (const [roomId, members] of joinedRooms) {
    for (const peerId of Array.from(members)) {
      if (peerId === myPeerId) continue;
      const heard = lastHeardAt.get(roomKey(roomId, peerId));
      if (heard !== undefined && now - heard > ROOM_PEER_SILENCE_MS) {
        evictRoomPeer(roomId, peerId, 'silent');
      }
    }
  }
  for (const [k, t] of departedAt) {
    if (now - t > 5 * 60_000) departedAt.delete(k);
  }
}

function heartbeatRooms(): void {
  if (!meshRef) return;
  const from = meshRef.getPeerId();
  for (const roomId of joinedRooms.keys()) {
    meshRef.broadcast(SIGNAL_CHANNEL, {
      msgType: 'room-heartbeat',
      from,
      roomId,
      ts: Date.now(),
    } satisfies SignalEnvelope);
  }
}

function ensureSweep(): void {
  if (sweepTimer || typeof window === 'undefined') return;
  sweepTimer = setInterval(() => {
    heartbeatRooms();
    sweepSilentRoomPeers();
  }, ROOM_HEARTBEAT_MS);
  // A refresh or tab close is a clean disconnect: tell every room now.
  window.addEventListener('pagehide', () => {
    for (const roomId of Array.from(joinedRooms.keys())) {
      try { announceLeaveRoom(roomId); } catch { /* ignore */ }
    }
  });
}

// ── Relay (multi-hop room signaling) ───────────────────────────────────
// Media signals and room announcements travel at most MAX_SIGNAL_HOPS
// relays so peers without a direct mesh edge can still form a full media
// mesh. Dedup keys stop the same envelope from acting twice.
const MAX_SIGNAL_HOPS = 2;
const seenSignals = new Set<string>();
const seenOrder: string[] = [];
const MAX_SEEN_SIGNALS = 2000;
const RELAYED_ANNOUNCEMENTS = new Set<SignalEnvelope['msgType']>([
  'join-room', 'leave-room', 'presence', 'media-state', 'screen-share-state', 'room-heartbeat', 'chat-message',
]);

/** Test/internal: identity of an envelope for dedup. */
export function signalDedupKey(e: SignalEnvelope): string {
  const id = (e.data as { id?: unknown } | undefined)?.id;
  return `${e.from}|${e.to ?? ''}|${e.roomId}|${e.msgType}|${e.ts}|${typeof id === 'string' ? id : ''}`;
}

function rememberSignal(key: string): void {
  seenSignals.add(key);
  seenOrder.push(key);
  if (seenOrder.length > MAX_SEEN_SIGNALS) {
    const old = seenOrder.shift();
    if (old) seenSignals.delete(old);
  }
}

function relayDirected(fromPeerId: string, envelope: SignalEnvelope): void {
  if (!meshRef || !envelope.to) return;
  const hops = envelope.hops ?? 0;
  if (hops >= MAX_SIGNAL_HOPS) return;
  if (!meshRef.getConnectedPeerIds().includes(envelope.to)) return;
  if (envelope.to === fromPeerId) return;
  void meshRef.send(SIGNAL_CHANNEL, envelope.to, { ...envelope, hops: hops + 1 }).catch(() => undefined);
}

function relayRoomAnnouncement(fromPeerId: string, envelope: SignalEnvelope): void {
  if (!meshRef || !RELAYED_ANNOUNCEMENTS.has(envelope.msgType)) return;
  // Only members of the room forward its announcements.
  if (!joinedRooms.has(envelope.roomId)) return;
  const hops = envelope.hops ?? 0;
  if (hops >= MAX_SIGNAL_HOPS) return;
  const next = { ...envelope, hops: hops + 1 };
  for (const peerId of meshRef.getConnectedPeerIds()) {
    if (peerId === fromPeerId || peerId === envelope.from) continue;
    void meshRef.send(SIGNAL_CHANNEL, peerId, next).catch(() => undefined);
  }
}

// ── Incoming Handler ───────────────────────────────────────────────────

function handleIncoming(fromPeerId: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const envelope = raw as SignalEnvelope;
  if (typeof envelope.msgType !== 'string' || !envelope.roomId) return;

  const myPeerId = meshRef?.getPeerId();
  if (envelope.from === myPeerId) return;

  // Deduplicate: a relayed copy and the direct copy must not both act.
  const dedupKey = signalDedupKey(envelope);
  if (seenSignals.has(dedupKey)) return;
  rememberSignal(dedupKey);

  // Directed signal for someone else: relay one hop if we can reach them,
  // so A and C can negotiate media through B when they share no edge.
  if (envelope.to && envelope.to !== myPeerId) {
    relayDirected(fromPeerId, envelope);
    return;
  }
  relayRoomAnnouncement(fromPeerId, envelope);

  const fromKey = roomKey(envelope.roomId, envelope.from);
  if (envelope.msgType === 'join-room' || envelope.msgType === 'room-hello') {
    // A fresh join is the only thing that brings a departed peer back.
    departedAt.delete(fromKey);
  } else if (envelope.msgType !== 'leave-room') {
    const left = departedAt.get(fromKey);
    if (left !== undefined && (envelope.ts ?? 0) <= left + 1_000) return;
    if (left !== undefined && envelope.msgType !== 'presence') return;
    if (left !== undefined) departedAt.delete(fromKey);
  }
  if (envelope.msgType !== 'leave-room' && joinedRooms.has(envelope.roomId)) {
    lastHeardAt.set(fromKey, Date.now());
  }

  switch (envelope.msgType) {
    case 'room-heartbeat':
      break;

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
        for (const p of participants) {
          if (p !== envelope.from && departedAt.has(roomKey(envelope.roomId, p))) continue;
          room.add(p);
          if (!lastHeardAt.has(roomKey(envelope.roomId, p))) lastHeardAt.set(roomKey(envelope.roomId, p), Date.now());
        }
        envelope.participants = participants.filter(
          (p) => p === envelope.from || !departedAt.has(roomKey(envelope.roomId, p)),
        );
      }
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'leave-room': {
      const room = joinedRooms.get(envelope.roomId);
      if (room) {
        console.log(`[WebRTC-Bridge] 👋 ${envelope.from} left room ${envelope.roomId}`);
      }
      evictRoomPeer(envelope.roomId, envelope.from, 'left');
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

    case 'screen-share-state': {
      console.log(`[WebRTC-Bridge] 🖥️ Received screen share state from ${envelope.from}`);
      for (const h of signalHandlers) {
        try { h(envelope); } catch { /* ignore */ }
      }
      break;
    }

    case 'media-state': {
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
      const data = envelope.data as { id?: string; text?: string; ts?: number; avatarRef?: string; replyToId?: string; replyToUsername?: string; replyToPreview?: string; infinityReplyTo?: string };
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
        infinityReplyTo: typeof data.infinityReplyTo === 'string' ? data.infinityReplyTo.slice(0, 200) : undefined,
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

    case 'room-hello': {
      // A peer just joined the room (or is rediscovering us). Reply
      // directly with our room participant list and our last presence
      // so they don't have to wait for the next periodic broadcast.
      const room = joinedRooms.get(envelope.roomId);
      if (room && myPeerId && room.has(myPeerId)) {
        const alreadyKnown = room.has(envelope.from);
        room.add(envelope.from);
        meshRef?.send(SIGNAL_CHANNEL, envelope.from, {
          msgType: 'room-sync',
          from: myPeerId,
          to: envelope.from,
          roomId: envelope.roomId,
          participants: Array.from(room),
          ts: Date.now(),
        } satisfies SignalEnvelope).catch(() => undefined);
        // Replay our latest presence directly so their UI hydrates immediately.
        const mine = myLastPresence.get(envelope.roomId);
        if (mine) {
          meshRef?.send(SIGNAL_CHANNEL, envelope.from, {
            msgType: 'presence',
            from: myPeerId,
            to: envelope.from,
            roomId: envelope.roomId,
            userId: mine.userId,
            username: mine.username,
            data: {
              avatarId: mine.avatarId,
              color: mine.color,
              position: mine.position,
              pv: mine.pv,
            },
            ts: Date.now(),
          } satisfies SignalEnvelope).catch(() => undefined);
        }
        // Also surface to local handlers as a synthetic peer-joined hint.
        // Only do this when this is a genuinely new room member for this
        // tab. Repeated `room-hello` packets from the inline preview and
        // floating dock used to synthesize join-room repeatedly, causing
        // offer/glare storms that broke live A/V.
        if (!alreadyKnown) {
          for (const h of signalHandlers) {
            try {
              h({
                msgType: 'join-room',
                from: envelope.from,
                roomId: envelope.roomId,
                userId: envelope.userId,
                username: envelope.username,
                ts: envelope.ts,
              });
            } catch { /* ignore */ }
          }
        }
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
  // Seed snapshot so the first poll diff doesn't fire for already-known peers.
  knownPeerSnapshot = new Set(mesh.getConnectedPeerIds());
  // Poll every 2s for newly opened mesh edges; replay our active rooms +
  // own presence to each new peer so room membership survives the cold-
  // start race where joinedRooms was populated before the edge existed.
  meshExpansionTimer = setInterval(() => {
    if (!meshRef) return;
    const current = meshRef.getConnectedPeerIds();
    const currentSet = new Set(current);
    const newPeers: string[] = [];
    for (const pid of current) {
      if (!knownPeerSnapshot.has(pid)) newPeers.push(pid);
    }
    knownPeerSnapshot = currentSet;
    if (newPeers.length === 0) return;
    const myPeerId = meshRef.getPeerId();
    for (const newPeerId of newPeers) {
      for (const [roomId, members] of joinedRooms) {
        if (!members.has(myPeerId)) continue;
        // Re-announce our membership directly to the new peer.
        meshRef.send(SIGNAL_CHANNEL, newPeerId, {
          msgType: 'join-room',
          from: myPeerId,
          to: newPeerId,
          roomId,
          ts: Date.now(),
        } satisfies SignalEnvelope).catch(() => undefined);
        // Replay our latest presence so their avatar list hydrates fast.
        const mine = myLastPresence.get(roomId);
        if (mine) {
          meshRef.send(SIGNAL_CHANNEL, newPeerId, {
            msgType: 'presence',
            from: myPeerId,
            to: newPeerId,
            roomId,
            userId: mine.userId,
            username: mine.username,
            data: {
              avatarId: mine.avatarId,
              color: mine.color,
              position: mine.position,
              pv: mine.pv,
            },
            ts: Date.now(),
          } satisfies SignalEnvelope).catch(() => undefined);
        }
      }
    }
  }, 2000);
  console.log('[WebRTC-Bridge] ✅ Signaling bridge started');
  return () => stopSignalingBridge();
}

export function stopSignalingBridge(): void {
  if (unsubChannel) {
    unsubChannel();
    unsubChannel = null;
  }
  if (meshExpansionTimer) {
    clearInterval(meshExpansionTimer);
    meshExpansionTimer = null;
  }
  knownPeerSnapshot.clear();
  myLastPresence.clear();
  meshRef = null;
  joinedRooms.clear();
  roomChatLog.clear();
  roomPresenceLog.clear();
  lastHelloAt.clear();
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
 * Announce screen-share lifecycle. The media itself travels as a normal
 * second MediaStream on the peer connection; this message only carries the
 * stream id so viewers can label the tile and clear it on a real stop.
 */
export function sendScreenShareState(roomId: string, active: boolean, streamId?: string): void {
  if (!meshRef) return;
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'screen-share-state',
    from: meshRef.getPeerId(),
    roomId,
    data: { active, streamId },
    ts: Date.now(),
  } satisfies SignalEnvelope);
}

/**
 * Announce this peer's camera / microphone state (and username) to the room.
 * Viewers use it to show a video tile only when a camera is really on, to
 * render the correct mic icon, and to label tiles with a real name.
 */
export function sendMediaState(
  roomId: string,
  state: { camera: boolean; mic: boolean },
  username?: string,
  userId?: string,
): void {
  if (!meshRef) return;
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'media-state',
    from: meshRef.getPeerId(),
    roomId,
    username,
    userId,
    data: { camera: state.camera, mic: state.mic },
    ts: Date.now(),
  } satisfies SignalEnvelope);
}


/**
 * Announce joining a room — existing participants will respond with offers.
 */
export function announceJoinRoom(roomId: string, userId: string, username: string): void {
  if (!meshRef) return;
  ensureSweep();

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
  infinityReplyTo?: string,
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
    infinityReplyTo,
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
      infinityReplyTo,
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
  const mineEntry: RoomPresence = {
    roomId,
    peerId: meshRef.getPeerId(),
    userId: presence.userId,
    username: presence.username,
    avatarId: presence.avatarId,
    color: presence.color,
    position: presence.position,
    pv: presence.pv,
    ts,
  };
  bucket.set(meshRef.getPeerId(), mineEntry);
  myLastPresence.set(roomId, mineEntry);
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
 * Pull-on-join: ask peers already in `roomId` to reply with their
 * room-sync + cached presence. Use after `announceJoinRoom` to cover
 * the symmetric race where the other peer's original join packet
 * predates our mesh edge.
 */
export function helloRoom(roomId: string): void {
  if (!meshRef) return;
  const now = Date.now();
  const last = lastHelloAt.get(roomId) ?? 0;
  if (now - last < 900) return;
  lastHelloAt.set(roomId, now);
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'room-hello',
    from: meshRef.getPeerId(),
    roomId,
    ts: now,
  } satisfies SignalEnvelope);
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
