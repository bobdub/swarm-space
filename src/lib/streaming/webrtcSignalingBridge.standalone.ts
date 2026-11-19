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

import { CHAT_WIRE_MAX_LENGTH } from '@/lib/chat/chatLimits';
import { isNetworkChatRoom } from '@/lib/chat/networkChatRoom';

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
    | 'room-hello'
    | 'chat-history-request'
    | 'chat-history'
    | 'chat-here';
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
  dialViaBus?(peerId: string, source?: 'exchange' | 'manual'): boolean;
}

import { loadBlocklistFromStorage } from '../p2p/blocklistStore';

// ── Constants ──────────────────────────────────────────────────────────

const SIGNAL_CHANNEL = 'webrtc-signal';

// ── Singleton State ────────────────────────────────────────────────────

let meshRef: MeshLike | null = null;
let unsubChannel: (() => void) | null = null;
const roomDialAt = new Map<string, number>();

function dialRoomPeer(peerId: string): void {
  if (!meshRef || peerId === meshRef.getPeerId() || meshRef.getConnectedPeerIds().includes(peerId)) return;
  if (loadBlocklistFromStorage().some(entry => entry.peerId === peerId)) return;
  const last = roomDialAt.get(peerId);
  if (last !== undefined && Date.now() - last < 12000) return;
  roomDialAt.set(peerId, Date.now());
  meshRef.dialViaBus?.(peerId);
}
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

// ── Chat history sync ──────────────────────────────────────────────────
// A peer opening a room's chat asks a few connected peers for the log
// they already hold; they answer directly with the newest messages,
// split into size-bounded packets so long (30k-char) messages still fit.
/** Peers asked per request — enough to cover gaps without a flood. */
const HISTORY_FANOUT = 3;
/** Most message text characters one reply carries in total. */
const HISTORY_MAX_TOTAL_CHARS = 1_000_000;
/** Soft size of one history packet (one oversized message still goes alone). */
const HISTORY_PACKET_CHARS = 60_000;
/** Longest text accepted from a history packet. */
const HISTORY_MAX_TEXT_CHARS = 64_000;
/** One answer per requester and room in this window. */
const HISTORY_REPLY_COOLDOWN_MS = 5_000;
/** roomId -> number of open chat views interested in its history. */
const historyInterest = new Map<string, number>();
/** `${roomId}|${peerId}` -> last time we answered that peer's request. */
const historyRepliedAt = new Map<string, number>();
const roomChatHistoryHandlers = new Set<(roomId: string) => void>();
let historySeq = 0;

// Track which rooms we've joined (roomId -> participant mesh peerIds)
const joinedRooms = new Map<string, Set<string>>();
/** The room the local call layer is in, kept across bridge restarts. */
let activeJoin: { roomId: string; userId: string; username: string } | null = null;

// ── Departed / silent peer tracking ────────────────────────────────────
/** `${roomId}|${peerId}` -> time the peer left. Stale echoes never revive them. */
const departedAt = new Map<string, number>();
/** `${roomId}|${peerId}` -> time a peer was evicted for going quiet. Unlike a
 *  real departure, anything we hear from them afterwards brings them back. */
const silentAt = new Map<string, number>();
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
  if (reason === 'silent') {
    // Quiet is not gone: a mesh edge hiccup or a throttled background tab
    // stops heartbeats while the call itself is fine. Remember it softly
    // so the next packet from them revives the membership.
    silentAt.set(roomKey(roomId, peerId), Date.now());
    console.log(`[WebRTC-Bridge] 💤 ${peerId} silent in ${roomId} — removing`);
    for (const h of signalHandlers) {
      try { h({ msgType: 'leave-room', from: peerId, roomId, ts: Date.now(), data: { reason: 'silent' } }); } catch { /* ignore */ }
    }
  } else {
    silentAt.delete(roomKey(roomId, peerId));
    departedAt.set(roomKey(roomId, peerId), Date.now());
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
  for (const [k, t] of silentAt) {
    if (now - t > 5 * 60_000) silentAt.delete(k);
  }
}

/**
 * True while `peerId` is a live member of a room we are in: announced, not
 * departed, and heard from recently. The call layer uses it to keep trying
 * to reach a peer that is clearly still there instead of giving up.
 */
export function isRoomPeerPresent(roomId: string, peerId: string, now: number = Date.now()): boolean {
  const members = joinedRooms.get(roomId);
  if (!members) return false;
  const key = roomKey(roomId, peerId);
  if (departedAt.has(key) || silentAt.has(key)) return false;
  const heard = lastHeardAt.get(key);
  if (heard !== undefined) return now - heard <= ROOM_PEER_SILENCE_MS;
  return members.has(peerId);
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
  'room-hello', 'chat-here',
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

/**
 * Deliver a directed envelope to `to`, even without a direct mesh edge.
 * `mesh.send` resolves `false` (it does not throw) when we have no edge to
 * the target, so the old `.catch` fallback never ran and the signal was
 * silently dropped. In a sparse mesh (A linked to B and C, but B and C not
 * linked) that meant B and C never formed a call: A heard both of them, they
 * never heard each other. Broadcasting lets a neighbour that does reach the
 * target relay it (see relayDirected); dedup keys stop double delivery.
 */
function sendDirected(envelope: SignalEnvelope & { to: string }): void {
  const mesh = meshRef;
  if (!mesh) return;
  const fallback = () => {
    if (meshRef !== mesh) return;
    for (const peerId of mesh.getConnectedPeerIds()) {
      if (peerId === envelope.to) continue;
      void mesh.send(SIGNAL_CHANNEL, peerId, envelope).catch(() => undefined);
    }
  };
  if (!mesh.getConnectedPeerIds().includes(envelope.to)) {
    fallback();
    return;
  }
  void Promise.resolve(mesh.send(SIGNAL_CHANNEL, envelope.to, envelope))
    .then((ok) => { if (ok === false) fallback(); })
    .catch(fallback);
}

function relayRoomAnnouncement(fromPeerId: string, envelope: SignalEnvelope): void {
  if (!meshRef || !RELAYED_ANNOUNCEMENTS.has(envelope.msgType)) return;
  const hops = envelope.hops ?? 0;
  if (hops >= MAX_SIGNAL_HOPS) return;
  // Members forward a room's announcements across the hop budget. A node
  // outside the room forwards only first-hop ones: a newcomer whose only
  // mesh link is a non-member (common right after joining, while direct
  // links are still being dialled) was otherwise unreachable, and the room
  // only heard them once a direct link formed, often minutes later.
  // The shared network chat is open to everyone connected, inside the Brain
  // or not, so every node carries its lines across the full hop budget.
  const openChat = (envelope.msgType === 'chat-message' || envelope.msgType === 'chat-here')
    && isNetworkChatRoom(envelope.roomId);
  if (!openChat && !joinedRooms.has(envelope.roomId) && hops > 0) return;
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
  } else if (
    envelope.msgType !== 'leave-room'
    // History is about the chat log, not room membership: a peer that left
    // the call may still be reading the room's chat.
    && envelope.msgType !== 'chat-history-request'
    && envelope.msgType !== 'chat-history'
    // The shared network chat does not depend on being in the Brain: someone
    // who walked out of the Brain to Explore keeps chatting with it.
    && !((envelope.msgType === 'chat-message' || envelope.msgType === 'chat-here') && isNetworkChatRoom(envelope.roomId))
  ) {
    const left = departedAt.get(fromKey);
    if (left !== undefined && (envelope.ts ?? 0) <= left + 1_000) return;
    if (left !== undefined && envelope.msgType !== 'presence') return;
    if (left !== undefined) departedAt.delete(fromKey);
  }
  if (envelope.msgType !== 'leave-room' && joinedRooms.has(envelope.roomId)) {
    lastHeardAt.set(fromKey, Date.now());
  }

  // A peer we evicted for going quiet is talking again: they never left.
  // Restore membership and tell the call layer, so it reconnects (or keeps)
  // their audio right away instead of waiting for them to re-join.
  if (envelope.msgType !== 'leave-room' && silentAt.has(fromKey)) {
    silentAt.delete(fromKey);
    const room = joinedRooms.get(envelope.roomId);
    if (room && myPeerId && room.has(myPeerId)) {
      room.add(envelope.from);
      console.log(`[WebRTC-Bridge] 🔔 ${envelope.from} is back in ${envelope.roomId}`);
      if (envelope.msgType !== 'join-room') {
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
  }

  switch (envelope.msgType) {
    case 'room-heartbeat':
      break;

    case 'join-room': {
      // A peer wants to join a room we're in
      const room = joinedRooms.get(envelope.roomId);
      if (room && myPeerId) {
        room.add(envelope.from);
        dialRoomPeer(envelope.from);
        console.log(`[WebRTC-Bridge] 👋 ${envelope.from} joined room ${envelope.roomId}`);
        
        // Send room-sync so joining peer knows who's here
        sendDirected({
          msgType: 'room-sync',
          from: myPeerId,
          to: envelope.from,
          roomId: envelope.roomId,
          participants: Array.from(room),
          userId: envelope.userId,
          ts: Date.now(),
        });
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
          dialRoomPeer(p);
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

    case 'chat-here': {
      if (!isNetworkChatRoom(envelope.roomId)) return;
      const open = (envelope.data as { open?: unknown } | undefined)?.open !== false;
      if (open) {
        chatHerePeers.set(envelope.from, {
          peerId: envelope.from,
          userId: typeof envelope.userId === 'string' ? envelope.userId.slice(0, 200) : undefined,
          username: typeof envelope.username === 'string' ? envelope.username.slice(0, 80) : undefined,
          seenAt: Date.now(),
        });
      } else {
        chatHerePeers.delete(envelope.from);
      }
      emitChatHere();
      break;
    }

    case 'chat-message': {
      if (!envelope.data || typeof envelope.data !== 'object') return;
      const data = envelope.data as { id?: string; text?: string; ts?: number; avatarRef?: string; replyToId?: string; replyToUsername?: string; replyToPreview?: string; infinityReplyTo?: string };
      // Cap untrusted inbound text so a malformed or hostile peer cannot
      // push unbounded strings into every room member's chat log.
      const text = typeof data.text === 'string' ? data.text.trim().slice(0, CHAT_WIRE_MAX_LENGTH) : '';
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

    case 'chat-history-request': {
      answerChatHistoryRequest(envelope);
      break;
    }

    case 'chat-history': {
      receiveChatHistory(envelope);
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
        sendDirected({
          msgType: 'room-sync',
          from: myPeerId,
          to: envelope.from,
          roomId: envelope.roomId,
          participants: Array.from(room),
          ts: Date.now(),
        });
        // Replay our latest presence directly so their UI hydrates immediately.
        const mine = myLastPresence.get(envelope.roomId);
        if (mine) {
          sendDirected({
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
          });
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

/** Peer ids the local user has blocked (any direction). */
function blockedPeerIds(): Set<string> {
  try {
    return new Set(loadBlocklistFromStorage().map((e) => e.peerId));
  } catch {
    return new Set();
  }
}

function isBlockedSender(message: RoomChatMessage, blocked: Set<string>): boolean {
  return blocked.has(message.senderPeerId)
    || (message.senderUserId !== undefined && blocked.has(message.senderUserId));
}

/** Test/internal: newest-first selection of messages to send, oldest-first packets. */
export function buildChatHistoryPackets(
  messages: RoomChatMessage[],
  have: Set<string> = new Set(),
  blocked: Set<string> = new Set(),
): RoomChatMessage[][] {
  const picked: RoomChatMessage[] = [];
  let total = 0;
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const m = sorted[i]!;
    if (have.has(m.id) || isBlockedSender(m, blocked)) continue;
    if (total + m.text.length > HISTORY_MAX_TOTAL_CHARS) break;
    total += m.text.length;
    picked.push(m);
  }
  picked.reverse();
  const packets: RoomChatMessage[][] = [];
  let current: RoomChatMessage[] = [];
  let size = 0;
  for (const m of picked) {
    const len = m.text.length + (m.replyToPreview?.length ?? 0) + 200;
    if (current.length > 0 && size + len > HISTORY_PACKET_CHARS) {
      packets.push(current);
      current = [];
      size = 0;
    }
    current.push(m);
    size += len;
  }
  if (current.length > 0) packets.push(current);
  return packets;
}

function answerChatHistoryRequest(envelope: SignalEnvelope): void {
  if (!meshRef) return;
  const log = roomChatLog.get(envelope.roomId);
  if (!log || log.length === 0) return;
  const key = roomKey(envelope.roomId, envelope.from);
  const now = Date.now();
  const last = historyRepliedAt.get(key) ?? 0;
  if (now - last < HISTORY_REPLY_COOLDOWN_MS) return;
  historyRepliedAt.set(key, now);
  const blocked = blockedPeerIds();
  // Never serve history to a peer we blocked.
  if (blocked.has(envelope.from) || (envelope.userId && blocked.has(envelope.userId))) return;
  const haveRaw = (envelope.data as { have?: unknown } | undefined)?.have;
  const have = new Set(
    Array.isArray(haveRaw) ? haveRaw.filter((v): v is string => typeof v === 'string').slice(0, 500) : [],
  );
  const packets = buildChatHistoryPackets(log, have, blocked);
  const myPeerId = meshRef.getPeerId();
  packets.forEach((messages, index) => {
    historySeq += 1;
    void meshRef?.send(SIGNAL_CHANNEL, envelope.from, {
      msgType: 'chat-history',
      from: myPeerId,
      to: envelope.from,
      roomId: envelope.roomId,
      data: { id: `hist:${now}:${historySeq}`, part: index, parts: packets.length, messages },
      ts: now + index,
    } satisfies SignalEnvelope).catch(() => undefined);
  });
}

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' && v ? v.slice(0, max) : undefined;
}

function receiveChatHistory(envelope: SignalEnvelope): void {
  const raw = (envelope.data as { messages?: unknown } | undefined)?.messages;
  if (!Array.isArray(raw)) return;
  const blocked = blockedPeerIds();
  const incoming: RoomChatMessage[] = [];
  for (const item of raw.slice(0, MAX_CHAT_MESSAGES_PER_ROOM)) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const id = str(m.id);
    const senderPeerId = str(m.senderPeerId);
    const text = typeof m.text === 'string' ? m.text.trim().slice(0, HISTORY_MAX_TEXT_CHARS) : '';
    const ts = typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : NaN;
    if (!id || !senderPeerId || !text || Number.isNaN(ts)) continue;
    // A history packet can't move a message into another room.
    if (m.roomId !== undefined && m.roomId !== envelope.roomId) continue;
    const message: RoomChatMessage = {
      id,
      roomId: envelope.roomId,
      senderPeerId,
      senderUserId: str(m.senderUserId),
      senderUsername: str(m.senderUsername, 120),
      senderAvatarRef: str(m.senderAvatarRef),
      text,
      ts,
      replyToId: str(m.replyToId),
      replyToUsername: str(m.replyToUsername, 120),
      replyToPreview: str(m.replyToPreview),
      infinityReplyTo: str(m.infinityReplyTo, 200),
    };
    if (isBlockedSender(message, blocked)) continue;
    incoming.push(message);
  }
  mergeRoomChatHistory(envelope.roomId, incoming);
}

/**
 * Test/internal: fold older messages into a room log. Unlike live
 * messages, history does not fire `onRoomChatMessage` handlers, so it never
 * re-triggers speech, learning or notifications; views re-read the log
 * when `onRoomChatHistory` fires.
 */
export function mergeRoomChatHistory(roomId: string, messages: RoomChatMessage[]): number {
  if (messages.length === 0) return 0;
  const existing = roomChatLog.get(roomId) ?? [];
  const ids = new Set(existing.map((m) => m.id));
  let added = 0;
  for (const m of messages) {
    if (ids.has(m.id)) continue;
    ids.add(m.id);
    existing.push(m);
    added += 1;
  }
  if (added === 0) return 0;
  existing.sort((a, b) => a.ts - b.ts);
  if (existing.length > MAX_CHAT_MESSAGES_PER_ROOM) {
    existing.splice(0, existing.length - MAX_CHAT_MESSAGES_PER_ROOM);
  }
  roomChatLog.set(roomId, existing);
  for (const handler of roomChatHistoryHandlers) {
    try { handler(roomId); } catch { /* ignore */ }
  }
  return added;
}

function sendChatHistoryRequest(roomId: string, peerIds: string[]): void {
  if (!meshRef || peerIds.length === 0) return;
  const myPeerId = meshRef.getPeerId();
  const have = (roomChatLog.get(roomId) ?? []).map((m) => m.id).slice(-MAX_CHAT_MESSAGES_PER_ROOM);
  const now = Date.now();
  for (const peerId of peerIds) {
    historySeq += 1;
    void meshRef.send(SIGNAL_CHANNEL, peerId, {
      msgType: 'chat-history-request',
      from: myPeerId,
      to: peerId,
      roomId,
      data: { id: `histreq:${now}:${historySeq}`, have },
      ts: now,
    } satisfies SignalEnvelope).catch(() => undefined);
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
    for (const members of joinedRooms.values()) for (const peer of members) dialRoomPeer(peer);
    if (newPeers.length === 0) return;
    for (const roomId of historyInterest.keys()) {
      sendChatHistoryRequest(roomId, newPeers.slice(0, HISTORY_FANOUT));
    }
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
  // Chat views opened before the mesh was up: ask now.
  for (const roomId of historyInterest.keys()) {
    sendChatHistoryRequest(roomId, knownPeerSnapshot.size ? Array.from(knownPeerSnapshot).slice(0, HISTORY_FANOUT) : []);
  }
  // Announce a room joined before the bridge (re)started, then ask who is
  // already there, so the call forms now rather than on the next edge churn.
  if (activeJoin) {
    const { roomId, userId, username } = activeJoin;
    announceJoinRoom(roomId, userId, username);
    helloRoom(roomId);
  }
  console.log('[WebRTC-Bridge] ✅ Signaling bridge started');
  return () => stopSignalingBridge();
}

export function stopSignalingBridge(): void {
  roomDialAt.clear();
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
  chatHerePeers.clear();
  lastHelloAt.clear();
  historyRepliedAt.clear();
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
  // Direct when we have an edge to them, otherwise through a neighbour.
  sendDirected(envelope as SignalEnvelope & { to: string });
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
  sendDirected(envelope as SignalEnvelope & { to: string });
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
  // Remember the room even before the mesh is up: the call layer only joins
  // once, so a join made during the cold start used to be lost and the
  // other users only found us minutes later, when some mesh edge churned.
  activeJoin = { roomId, userId, username };
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
  if (activeJoin?.roomId === roomId) activeJoin = null;
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
  const trimmed = text.trim().slice(0, CHAT_WIRE_MAX_LENGTH);
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
 * Inherit a room's existing conversation: ask a few connected peers for
 * the chat log they hold, and keep asking each newly connected peer while
 * the returned cleanup has not run. Arrivals land in the log (see
 * `getRoomChatMessages`) and fire `onRoomChatHistory`.
 */
export function requestRoomChatHistory(roomId: string): () => void {
  if (!roomId) return () => {};
  historyInterest.set(roomId, (historyInterest.get(roomId) ?? 0) + 1);
  if (meshRef) {
    sendChatHistoryRequest(roomId, meshRef.getConnectedPeerIds().slice(0, HISTORY_FANOUT));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (historyInterest.get(roomId) ?? 1) - 1;
    if (n <= 0) historyInterest.delete(roomId);
    else historyInterest.set(roomId, n);
  };
}

/** Fires with the roomId whenever synced history adds messages to a room's log. */
export function onRoomChatHistory(handler: (roomId: string) => void): () => void {
  roomChatHistoryHandlers.add(handler);
  return () => { roomChatHistoryHandlers.delete(handler); };
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


// ── Network chat presence ──────────────────────────────────────────────
// Who has the shared network chat open, wherever they are in the app. People
// inside the Brain also show up through room presence; this covers everyone
// chatting from the main menu, so both sides can list who is in the chat.

export interface NetworkChatPeer {
  peerId: string;
  userId?: string;
  username?: string;
  seenAt: number;
}

/** A chatter we have not heard from in this long has left the chat. */
export const CHAT_HERE_TTL_MS = 35_000;
const chatHerePeers = new Map<string, NetworkChatPeer>();
const chatHereHandlers = new Set<() => void>();

function emitChatHere(): void {
  for (const h of chatHereHandlers) {
    try { h(); } catch { /* ignore */ }
  }
}

/** Tell connected peers we have the network chat open (`open: false` when it closes). */
export function announceNetworkChatHere(roomId: string, userId: string | undefined, username: string | undefined, open = true): void {
  if (!meshRef) return;
  meshRef.broadcast(SIGNAL_CHANNEL, {
    msgType: 'chat-here',
    from: meshRef.getPeerId(),
    roomId,
    userId,
    username,
    data: { open },
    ts: Date.now(),
  } satisfies SignalEnvelope);
}

/** Peers that announced the network chat recently (never ourselves). */
export function getNetworkChatPeers(now: number = Date.now()): NetworkChatPeer[] {
  for (const [peerId, p] of chatHerePeers) {
    if (now - p.seenAt > CHAT_HERE_TTL_MS) chatHerePeers.delete(peerId);
  }
  return Array.from(chatHerePeers.values());
}

export function onNetworkChatPeers(handler: () => void): () => void {
  chatHereHandlers.add(handler);
  return () => { chatHereHandlers.delete(handler); };
}
