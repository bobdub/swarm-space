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
  msgType: 'offer' | 'answer' | 'candidate' | 'join-room' | 'leave-room' | 'room-sync';
  from: string;       // mesh peerId (peer-xxx)
  to?: string;        // target mesh peerId (for directed signals)
  roomId: string;
  userId?: string;
  username?: string;
  data?: unknown;      // SDP or ICE candidate
  participants?: string[]; // for room-sync
  ts: number;
}

type SignalHandler = (envelope: SignalEnvelope) => void;

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
 * Announce joining a room — existing participants will respond with offers.
 */
export function announceJoinRoom(roomId: string, userId: string, username: string): void {
  if (!meshRef) return;
  
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
