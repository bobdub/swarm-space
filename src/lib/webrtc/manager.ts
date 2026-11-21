import type { VideoRoom, VideoParticipant, WebRTCSignal, VideoRoomMessage } from './types';
import {
  sendSignalViaMesh,
  sendReconnectRequest,
  sendScreenShareState,
  sendMediaState,
  announceJoinRoom,
  announceLeaveRoom,
  onSignal,
  getLocalMeshPeerId,
  isBridgeActive,
  isRoomPeerPresent,
} from '@/lib/streaming/webrtcSignalingBridge.standalone';
import { DEFAULT_ICE_SERVERS } from '@/lib/p2p/iceServers';
import { spikeHealth } from '@/lib/uqrc/withHealth';

const MAX_RECONNECT_ATTEMPTS = 3;
const DISCONNECT_GRACE_MS = 10_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const NEGOTIATION_WAIT_MS = 30_000;
/** How often to verify each connection is really carrying media both ways. */
const MEDIA_HEALTH_INTERVAL_MS = 8_000;
/** Minimum gap between repairs of the same peer. */
const MEDIA_REPAIR_COOLDOWN_MS = 12_000;
/** After every recovery attempt failed, wait this long and start over while
 *  the peer is still in the room, instead of dropping their audio for good. */
const RECOVERY_BACKOFF_MS = 20_000;

/** Dispatched on the local MediaStream after a camera or mic switch. */
export const LOCAL_INPUT_SWITCHED_EVENT = 'swarm-input-switched';

/** Shared with the pre-join modal, which writes the same key. */
const PREFERRED_DEVICES_KEY = 'swarm-preferred-devices';

/** DTLS fingerprint of an SDP. It changes only when the remote side built a
 *  brand-new RTCPeerConnection, so it tells a restart apart from a rejoin. */
export function sdpFingerprint(sdp: string | undefined | null): string | null {
  const match = sdp?.match(/a=fingerprint:(\S+ \S+)/i);
  return match ? match[1].toLowerCase() : null;
}

function loadPreferredInput(kind: 'audio' | 'video'): string | undefined {
  try {
    const raw = localStorage.getItem(PREFERRED_DEVICES_KEY);
    const prefs = raw ? (JSON.parse(raw) as { audioInputId?: string; videoInputId?: string }) : {};
    return (kind === 'audio' ? prefs.audioInputId : prefs.videoInputId) || undefined;
  } catch {
    return undefined;
  }
}

function savePreferredInput(kind: 'audio' | 'video', deviceId: string): void {
  try {
    const raw = localStorage.getItem(PREFERRED_DEVICES_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    prefs[kind === 'audio' ? 'audioInputId' : 'videoInputId'] = deviceId;
    localStorage.setItem(PREFERRED_DEVICES_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable */ }
}

export class WebRTCManager {
  private rooms = new Map<string, VideoRoom>();
  private connections = new Map<string, RTCPeerConnection>();
  private participants = new Map<string, VideoParticipant>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  /** Sender carrying the screen track, per connection. */
  private screenSenders = new Map<string, RTCRtpSender>();
  /** Screen stream id announced by each remote peer, when sharing. */
  private remoteScreenStreamIds = new Map<string, string>();
  private currentRoomId: string | null = null;
  private messageHandlers = new Set<(message: VideoRoomMessage) => void>();
  private userId: string;
  private username: string;
  private signalUnsub: (() => void) | null = null;

  // ── Negotiation glare prevention ────────────────────────────────
  private negotiationLock = new Map<string, boolean>();
  /** Set when an offer was requested while another was in-flight or state was non-stable. */
  private negotiationNeeded = new Map<string, boolean>();
  /** true = we are "polite" toward this peer (will rollback on glare) */
  private makingOffer = new Map<string, boolean>();
  /** One deadline per connection, not a retry loop competing with signaling. */
  private negotiationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private queuedIceRestarts = new Set<string>();
  private ignoredOffers = new Set<string>();
  private applyingRemoteOffer = new Set<string>();

  // ── Local media state (remembered across stream re-acquisition) ──
  /** Desired microphone state. Applied to every acquired/replaced audio track. */
  private selfMuted = false;
  /** Desired camera state. Announced to the room so peers only draw a tile when it is on. */
  private cameraEnabled = false;
  /** Bumped per input switch so a stale in-flight switch can tell it lost. */
  private inputSwitchSeq = { audio: 0, video: 0 };

  // ── Reconnection state ──────────────────────────────────────────
  private reconnectAttempts = new Map<string, number>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Periodic check that every participant connection is really carrying media. */
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** Last repair time per peer, so the sweep cannot fight itself. */
  private lastRepairAt = new Map<string, number>();

  constructor(userId: string, username: string) {
    this.userId = userId;
    this.username = username;
    this.setupSignalListener();
    // A refresh or tab close is a disconnect, never a resume: drop every
    // call connection so peers see us leave instead of a frozen avatar.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        try { void this.leaveRoom(); } catch { /* ignore */ }
      });
    }
  }

  /** Polite peer = lexicographically smaller ID */
  private isPolite(remotePeerId: string): boolean {
    const localId = getLocalMeshPeerId() ?? this.userId;
    return localId < remotePeerId;
  }

  private setupSignalListener(): void {
    this.signalUnsub = onSignal((envelope) => {
      if (!this.currentRoomId || envelope.roomId !== this.currentRoomId) return;

      const meshPeerId = envelope.from;

      switch (envelope.msgType) {
        case 'join-room': {
          if (meshPeerId === getLocalMeshPeerId()) {
            break;
          }

          this.ensureParticipant(meshPeerId, envelope.username);
          this.broadcastMessage({
            type: 'peer-joined',
            roomId: this.currentRoomId,
            peerId: meshPeerId,
            username: envelope.username,
          });

          // A join from someone we are already talking to is a re-announce
          // (a mesh link to them opened again, or they were heard again
          // after going quiet), not a new call. Offering again made both
          // sides renegotiate at once whenever a newcomer reshuffled the
          // mesh, and existing users briefly lost each other. A peer that
          // really rebuilt their side asks for a reconnect instead.
          const live = this.connections.get(meshPeerId);
          if (live && live.connectionState === 'connected') {
            console.log(`[WebRTC] Peer ${meshPeerId} re-announced; call already live`);
          } else {
            // A new peer joined our room — send them an offer
            console.log(`[WebRTC] Peer ${meshPeerId} joining, creating offer`);
            this.createOfferForPeer(meshPeerId).catch(e =>
              console.error('[WebRTC] Failed to create offer:', e)
            );
          }

          // Tell the newcomer our name plus camera/mic state right away so
          // they never draw a placeholder tile or a wrong mic icon.
          this.announceMediaState();

          // If we are already sharing, re-announce so the newcomer can label
          // the incoming screen stream as soon as it arrives.
          if (this.screenStream && this.currentRoomId) {
            sendScreenShareState(this.currentRoomId, true, this.screenStream.id);
          }
          break;
        }

        case 'room-sync': {
          const participants = envelope.participants ?? [];
          console.log(`[WebRTC] Room sync: ${participants.length} participants`);
          const myPeerId = getLocalMeshPeerId();
          for (const p of participants) {
            if (p !== myPeerId) {
              this.ensureParticipant(p);
            }
          }
          // Do not create offers from room-sync. Existing peers already
          // answer a join-room/room-hello by offering to the newcomer; making
          // the joining peer offer at the same time causes glare loops and is
          // the regression that made live rooms show only local media.
          this.broadcastMessage({
            type: 'peer-joined',
            roomId: this.currentRoomId!,
            peerId: meshPeerId,
          });
          break;
        }

        case 'leave-room': {
          // The bridge evicts a peer whose room heartbeats went quiet for a
          // while (a mesh edge hiccup, a throttled background tab). If our
          // call with them is still carrying media, they did not leave:
          // keep talking. A real departure still closes the call, and a
          // connection that later fails goes through normal recovery.
          const reason = (envelope.data as { reason?: unknown } | undefined)?.reason;
          const livePc = this.connections.get(meshPeerId);
          if (reason === 'silent' && livePc?.connectionState === 'connected') {
            console.log(`[WebRTC] Peer ${meshPeerId} went quiet on the mesh but the call is live — keeping it`);
            break;
          }
          console.log(`[WebRTC] Peer ${meshPeerId} left`);
          this.cleanupPeer(meshPeerId);
          this.broadcastMessage({
            type: 'peer-left',
            roomId: this.currentRoomId!,
            peerId: meshPeerId,
          });
          break;
        }

        case 'offer': {
          this.ensureParticipant(meshPeerId, envelope.username);
          this.handleRemoteOffer(meshPeerId, envelope.data as RTCSessionDescriptionInit);
          break;
        }

        case 'answer': {
          this.ensureParticipant(meshPeerId, envelope.username);
          this.handleRemoteAnswer(meshPeerId, envelope.data as RTCSessionDescriptionInit);
          break;
        }

        case 'candidate': {
          this.ensureParticipant(meshPeerId, envelope.username);
          this.handleRemoteCandidate(meshPeerId, envelope.data as RTCIceCandidateInit);
          break;
        }

        case 'media-state': {
          const participant = this.ensureParticipant(meshPeerId, envelope.username);
          const data = envelope.data as { camera?: unknown; mic?: unknown } | undefined;
          participant.isVideoEnabled = data?.camera === true;
          participant.isMuted = data?.mic === false;
          this.broadcastMessage({
            type: 'peer-media-state',
            roomId: this.currentRoomId,
            peerId: meshPeerId,
            username: participant.username || undefined,
            camera: participant.isVideoEnabled,
            mic: !participant.isMuted,
          });
          break;
        }

        case 'screen-share-state': {
          const participant = this.ensureParticipant(meshPeerId, envelope.username);
          const data = envelope.data as { active?: unknown; streamId?: unknown } | undefined;
          const active = data?.active === true;
          const streamId = typeof data?.streamId === 'string' ? data.streamId : undefined;
          if (active) {
            if (streamId) this.remoteScreenStreamIds.set(meshPeerId, streamId);
          } else {
            this.remoteScreenStreamIds.delete(meshPeerId);
            participant.screenStream = null;
          }
          this.broadcastMessage({
            type: active ? 'screen-share-started' : 'screen-share-stopped',
            roomId: this.currentRoomId,
            peerId: meshPeerId,
          });
          console.log(`[WebRTC] 🖥️ Screen share ${active ? 'started' : 'stopped'} announced by ${meshPeerId}`);
          break;
        }

        case 'reconnect-request': {
          console.log(`[WebRTC] 🔄 Reconnect request from ${meshPeerId}`);
          // Tear down stale connection and let them re-offer. Their offer is
          // on its way, so the health sweep must not "repair" the gap.
          this.lastRepairAt.set(meshPeerId, Date.now());
          this.removePeer(meshPeerId);
          this.ensureParticipant(meshPeerId, envelope.username);
          // Send ack via mesh
          sendReconnectRequest(meshPeerId, this.currentRoomId!, 'reconnect-ack');
          break;
        }

        case 'reconnect-ack': {
          console.log(`[WebRTC] 🔄 Reconnect ack from ${meshPeerId} — creating fresh offer`);
          this.clearReconnectTimer(meshPeerId);
          this.ensureParticipant(meshPeerId, envelope.username);
          this.createOfferForPeer(meshPeerId).catch(e =>
            console.error('[WebRTC] Failed reconnect offer:', e)
          );
          break;
        }
      }
    });
  }

  // ── WebRTC Negotiation ─────────────────────────────────────────────

  private clearNegotiationTimer(peerId: string): void {
    const timer = this.negotiationTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.negotiationTimers.delete(peerId);
  }

  private waitForNegotiation(peerId: string, pc: RTCPeerConnection): void {
    if (this.negotiationTimers.has(peerId)) return;
    const timer = setTimeout(() => {
      this.negotiationTimers.delete(peerId);
      if (!this.currentRoomId || this.connections.get(peerId) !== pc) return;
      // Slow mesh delivery is not a failed call. Only a genuinely stalled
      // initial connection is recovered; an established call stays intact.
      if (pc.connectionState !== 'connected' &&
          !this.disconnectTimers.has(peerId) && !this.reconnectTimers.has(peerId)) {
        this.attemptRecovery(peerId);
      }
    }, NEGOTIATION_WAIT_MS);
    this.negotiationTimers.set(peerId, timer);
  }

  private drainNegotiation(peerId: string, pc: RTCPeerConnection): void {
    if (this.connections.get(peerId) !== pc || pc.signalingState !== 'stable') return;
    this.clearNegotiationTimer(peerId);
    if (this.negotiationLock.get(peerId) || this.applyingRemoteOffer.has(peerId) ||
        !this.negotiationNeeded.get(peerId)) return;
    this.negotiationNeeded.delete(peerId);
    void this.createOfferForPeer(peerId, { iceRestart: this.queuedIceRestarts.has(peerId) })
      .catch(error => console.warn('[WebRTC] Deferred offer failed:', error));
  }

  private async createOfferForPeer(meshPeerId: string, options: { iceRestart?: boolean } = {}): Promise<void> {
    const roomId = this.currentRoomId;
    if (!roomId) return;
    if (options.iceRestart) this.queuedIceRestarts.add(meshPeerId);
    if (this.negotiationLock.get(meshPeerId) || this.applyingRemoteOffer.has(meshPeerId)) {
      this.negotiationNeeded.set(meshPeerId, true);
      return;
    }

    this.negotiationLock.set(meshPeerId, true);
    this.makingOffer.set(meshPeerId, true);
    let pc: RTCPeerConnection | undefined;
    try {
      pc = await this.createPeerConnection(meshPeerId, { reuseFailed: this.queuedIceRestarts.has(meshPeerId) });
      const isCurrent = () => this.currentRoomId === roomId && this.connections.get(meshPeerId) === pc;
      if (!isCurrent()) return;
      if (pc.signalingState !== 'stable') {
        this.negotiationNeeded.set(meshPeerId, true);
        this.waitForNegotiation(meshPeerId, pc);
        return;
      }
      const restart = this.queuedIceRestarts.has(meshPeerId);
      const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
      if (!isCurrent() || pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      if (!isCurrent()) return;
      this.queuedIceRestarts.delete(meshPeerId);
      sendSignalViaMesh(meshPeerId, roomId, 'offer', pc.localDescription ?? offer);
      this.waitForNegotiation(meshPeerId, pc);
    } finally {
      // An obsolete async offer must never release a replacement PC's lock.
      if (!pc || this.connections.get(meshPeerId) === pc) {
        this.makingOffer.set(meshPeerId, false);
        this.negotiationLock.set(meshPeerId, false);
        if (pc) this.drainNegotiation(meshPeerId, pc);
      }
    }
  }

  private async handleRemoteOffer(meshPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const roomId = this.currentRoomId;
    if (!roomId) return;
    console.log(`[WebRTC] 📥 Received offer from ${meshPeerId}`);
    // Same DTLS fingerprint = same remote connection (a renegotiation or an
    // ICE restart, which may revive a failed one). A new fingerprint means
    // they rebuilt their side (rejoin, refresh, recovery): applying that to
    // our old connection fails, which left the pair silent until the next
    // timeout. Start a fresh connection for it instead.
    const existing = this.connections.get(meshPeerId);
    const incoming = sdpFingerprint(offer.sdp);
    const known = sdpFingerprint(existing?.remoteDescription?.sdp);
    const sameRemote = !!existing && !!incoming && !!known && incoming === known;
    if (existing && known && incoming && !sameRemote) {
      console.log(`[WebRTC] ${meshPeerId} rebuilt their connection — starting a fresh one`);
      this.removePeer(meshPeerId);
      this.makingOffer.set(meshPeerId, false);
      this.negotiationLock.set(meshPeerId, false);
    }
    const pc = await this.createPeerConnection(meshPeerId, { reuseFailed: sameRemote, forAnswer: true });
    if (this.currentRoomId !== roomId || this.connections.get(meshPeerId) !== pc) return;

    const isCurrentlyMakingOffer = this.makingOffer.get(meshPeerId) ?? false;
    const offerCollision = isCurrentlyMakingOffer || pc.signalingState !== 'stable';

    if (offerCollision) {
      const polite = this.isPolite(meshPeerId);
      if (!polite) {
        // Our outstanding offer wins. Wait for its answer instead of
        // hammering a second offer into the polite peer's rollback.
        this.ignoredOffers.add(meshPeerId);
        return;
      }
    }

    this.applyingRemoteOffer.add(meshPeerId);
    try {
      // Keep queued offers out of the brief stable state during rollback.
      if (offerCollision && pc.signalingState !== 'stable') {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      this.ignoredOffers.delete(meshPeerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingCandidates(meshPeerId, pc);
      // Preserve the incoming fix: the answer sends on the offered slots.
      await this.adoptOfferedTransceivers(meshPeerId, pc);
      const answer = await pc.createAnswer();
      if (this.currentRoomId !== roomId || this.connections.get(meshPeerId) !== pc) return;
      await pc.setLocalDescription(answer);
      if (this.currentRoomId !== roomId || this.connections.get(meshPeerId) !== pc) return;
      sendSignalViaMesh(meshPeerId, roomId, 'answer', pc.localDescription ?? answer);
    } finally {
      if (this.connections.get(meshPeerId) === pc) {
        this.applyingRemoteOffer.delete(meshPeerId);
        this.drainNegotiation(meshPeerId, pc);
      }
    }
  }

  private async handleRemoteAnswer(meshPeerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[WebRTC] 📥 Received answer from ${meshPeerId}`);
    const pc = this.connections.get(meshPeerId);
    if (!pc) return;
    // Ignore stray answers that arrive when we're not awaiting one
    // (e.g. after a glare rollback). setRemoteDescription would
    // throw InvalidStateError and silently break this peer-pair —
    // exactly the "I see myself but no one else" symptom.
    if (pc.signalingState !== 'have-local-offer') {
      console.warn(
        `[WebRTC] Dropping stray answer from ${meshPeerId} (state=${pc.signalingState})`,
      );
      return;
    }
    // Our renegotiation reached a peer that had rebuilt their side, so they
    // answered from a brand-new connection. Ours cannot take it: rebuild and
    // offer again instead of sitting on a broken pair.
    const known = sdpFingerprint(pc.remoteDescription?.sdp);
    const incoming = sdpFingerprint(answer.sdp);
    if (known && incoming && known !== incoming) {
      console.log(`[WebRTC] ${meshPeerId} answered from a new connection — rebuilding`);
      this.removePeer(meshPeerId);
      void this.createOfferForPeer(meshPeerId).catch(() => undefined);
      return;
    }
    try {
      this.ignoredOffers.delete(meshPeerId);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingCandidates(meshPeerId, pc);
      this.drainNegotiation(meshPeerId, pc);
    } catch (err) {
      console.warn('[WebRTC] setRemoteDescription(answer) failed:', err);
    }
  }

  private async handleRemoteCandidate(meshPeerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (this.ignoredOffers.has(meshPeerId)) return;
    const pc = this.connections.get(meshPeerId);
    if (pc?.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        console.warn(`[WebRTC] Failed to apply ICE candidate for ${meshPeerId}:`, error);
      });
      return;
    }

    const queued = this.pendingCandidates.get(meshPeerId) ?? [];
    queued.push(candidate);
    this.pendingCandidates.set(meshPeerId, queued);
  }

  // ── Room Management ────────────────────────────────────────────────

  async createRoom(options: {
    name: string;
    projectId?: string;
    isPrivate?: boolean;
    allowedPeers?: string[];
  }): Promise<VideoRoom> {
    const room: VideoRoom = {
      id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: options.name,
      hostId: this.userId,
      hostName: this.username,
      projectId: options.projectId,
      isPrivate: options.isPrivate ?? false,
      allowedPeers: options.allowedPeers,
      mutedPeers: [],
      bannedPeers: [],
      isStreaming: false,
      createdAt: new Date().toISOString(),
      participants: [this.userId],
    };

    this.rooms.set(room.id, room);
    this.currentRoomId = room.id;

    announceJoinRoom(room.id, this.userId, this.username);

    this.broadcastMessage({
      type: 'room-created',
      roomId: room.id,
      room,
    });
    

    console.log('[WebRTC] Room created:', room.id);
    return room;
  }

  async joinRoom(roomId: string): Promise<boolean> {
    spikeHealth('stream', 'webrtc.joinRoom', 0.5);
    // Idempotent join: the live post preview and floating dock can be mounted
    // at the same time for the same room. Re-announcing every mount creates
    // duplicate offer storms/glare and breaks remote A/V, so keep the existing
    // WebRTC membership alive and only refresh local UI state.
    if (this.currentRoomId === roomId) {
      let current = this.rooms.get(roomId);
      if (!current) {
        current = {
          id: roomId,
          name: 'Live Room',
          hostId: '',
          hostName: '',
          isPrivate: false,
          mutedPeers: [],
          bannedPeers: [],
          isStreaming: false,
          createdAt: new Date().toISOString(),
          participants: [],
        };
        this.rooms.set(roomId, current);
      }
      if (!current.participants.includes(this.userId)) {
        current.participants.push(this.userId);
      }
      this.broadcastMessage({
        type: 'room-updated',
        roomId,
        room: current,
      });
      return true;
    }

    // Auto-leave previous room to prevent stream crossing
    if (this.currentRoomId && this.currentRoomId !== roomId) {
      console.log(`[WebRTC] Auto-leaving previous room ${this.currentRoomId} before joining ${roomId}`);
      await this.leaveRoom();
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        name: 'Live Room',
        hostId: '',
        hostName: '',
        isPrivate: false,
        mutedPeers: [],
        bannedPeers: [],
        isStreaming: false,
        createdAt: new Date().toISOString(),
        participants: [],
      };
      this.rooms.set(roomId, room);
    }

    if (room.bannedPeers.includes(this.userId)) {
      console.error('[WebRTC] User is banned from room');
      return false;
    }

    if (room.isPrivate && !room.allowedPeers?.includes(this.userId) && room.hostId !== this.userId) {
      console.error('[WebRTC] User not allowed in private room');
      return false;
    }

    if (!room.participants.includes(this.userId)) {
      room.participants.push(this.userId);
    }
    
    this.currentRoomId = roomId;

    announceJoinRoom(roomId, this.userId, this.username);

    this.broadcastMessage({
      type: 'peer-joined',
      roomId,
      peerId: this.userId,
      username: this.username,
    });

    this.announceMediaState();
    this.startMediaHealthCheck();

    console.log('[WebRTC] Joined room:', roomId);
    return true;
  }

  async leaveRoom(): Promise<void> {
    spikeHealth('stream', 'webrtc.leaveRoom', 0.4);
    if (!this.currentRoomId) return;

    // A screen share belongs to the room it was shared in. Leaving the room
    // (Disconnect, switching rooms, closing the tab) ends it for everyone,
    // announced while we still know the room so viewers drop the tile.
    this.stopScreenShare();

    const room = this.rooms.get(this.currentRoomId);
    if (room) {
      room.participants = room.participants.filter(p => p !== this.userId);
      
      if (room.participants.length === 0) {
        this.rooms.delete(this.currentRoomId);
      }

      this.broadcastMessage({
        type: 'peer-left',
        roomId: this.currentRoomId,
        peerId: this.userId,
      });
    }

    announceLeaveRoom(this.currentRoomId);

    // Preserve local media stream across room transitions — only close peer connections
    this.stopMediaHealthCheck();
    this.closeAllConnections();
    this.currentRoomId = null;
  }

  // ── Media ──────────────────────────────────────────────────────────

  async startLocalStream(
    audio: boolean = true,
    video: boolean = true,
    deviceIds?: { audioInputId?: string; videoInputId?: string },
  ): Promise<MediaStream> {
    try {
      // If every track on the cached stream is dead (e.g. the user left the
      // Brain, which stop()'d every track, and is now re-entering), drop the
      // dead stream entirely so we re-acquire fresh tracks AND walk the
      // peer-connection senders below — guaranteeing renegotiation.
      if (this.localStream) {
        const tracks = this.localStream.getTracks();
        const allEnded = tracks.length > 0 && tracks.every(t => t.readyState === 'ended');
        if (allEnded) {
          console.log('[WebRTC] Cached localStream has only ended tracks — discarding before re-acquire');
          this.localStream = null;
        }
      }

      // If we already have a stream, only request the missing track kind
      if (this.localStream) {
        const hasAudio = this.localStream.getAudioTracks().length > 0;
        const hasVideo = this.localStream.getVideoTracks().length > 0;

        const needAudio = audio && !hasAudio;
        const needVideo = video && !hasVideo;

        if (needAudio || needVideo) {
          const audioConstraint = needAudio ? this.inputConstraintFor('audio', deviceIds?.audioInputId) : false;
          const videoConstraint = needVideo ? this.inputConstraintFor('video', deviceIds?.videoInputId) : false;
          const constraints: MediaStreamConstraints = {
            audio: audioConstraint,
            video: videoConstraint,
          };
          const extraStream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('[WebRTC] Adding incremental tracks:', { needAudio, needVideo });

          for (const newTrack of extraStream.getTracks()) {
            this.localStream.addTrack(newTrack);

            // Update senders on every existing peer connection
            for (const [peerId, pc] of this.connections) {
              const renegotiate = await this.slotTrackIntoPeer(pc, newTrack);
              if (renegotiate && this.currentRoomId) {
                // Queue late media behind any outstanding mesh exchange.
                void this.createOfferForPeer(peerId).catch((error) => {
                  console.warn(`[WebRTC] Failed renegotiation with ${peerId}:`, error);
                });
              }
            }
          }
        }

        // Re-enable existing tracks that were disabled. The microphone
        // always honours the remembered mute — re-acquiring media must
        // never quietly unmute the user.
        if (video && hasVideo) {
          this.localStream.getVideoTracks().forEach(t => { t.enabled = true; });
        }
        this.applyLocalMuteState();

        return this.localStream;
      }

      // First-time: create fresh stream. Honour optional deviceIds so the
      // call site doesn't need a second getUserMedia (which re-prompts in
      // some browsers and always re-acquires the mic).
      const audioConstraint = audio ? this.inputConstraintFor('audio', deviceIds?.audioInputId) : false;
      const videoConstraint = video ? this.inputConstraintFor('video', deviceIds?.videoInputId) : false;
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoConstraint,
      });
      console.log('[WebRTC] Local stream started');

      // Add tracks to any existing connections
      for (const [peerId, pc] of this.connections) {
        let addedTrack = false;

        for (const track of this.localStream.getTracks()) {
          const renegotiate = await this.slotTrackIntoPeer(pc, track);
          if (renegotiate) addedTrack = true;
        }

        if (addedTrack && this.currentRoomId) {
          void this.createOfferForPeer(peerId).catch((error) => {
            console.warn(`[WebRTC] Failed renegotiation with ${peerId}:`, error);
          });
        }
      }

      // Fresh tracks arrive enabled — honour the remembered mute.
      this.applyLocalMuteState();
      this.announceMediaState();

      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] Failed to get user media:', error);
      throw error;
    }
  }

  /**
   * Constraint for a camera or microphone request: an explicit device is
   * required exactly; otherwise the device the user last picked is preferred
   * (not required, so a missing device falls back to the default one).
   */
  private inputConstraintFor(kind: 'audio' | 'video', explicitId?: string): boolean | MediaTrackConstraints {
    if (explicitId) return { deviceId: { exact: explicitId } };
    const preferred = loadPreferredInput(kind);
    return preferred ? { deviceId: { ideal: preferred } } : true;
  }

  stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      console.log('[WebRTC] Local stream stopped');
    }
  }

  /**
   * Force a fresh `getUserMedia` acquisition and renegotiate every peer
   * connection. Use this when callers explicitly want new tracks — e.g.
   * the camera toggle, a device change, or the gesture-fallback retry
   * after the browser auto-muted the mic on a route re-entry.
   */
  async refreshLocalStream(
    audio: boolean = true,
    video: boolean = true,
    deviceIds?: { audioInputId?: string; videoInputId?: string },
  ): Promise<MediaStream> {
    this.stopLocalStream();
    return this.startLocalStream(audio, video, deviceIds);
  }

  /** Device id of the camera currently feeding the local video track, if any. */
  getActiveCameraId(): string | null {
    return this.activeInputId('video');
  }

  /** Device id of the microphone currently feeding the local audio track, if any. */
  getActiveMicrophoneId(): string | null {
    return this.activeInputId('audio');
  }

  private activeInputId(kind: 'audio' | 'video'): string | null {
    const tracks = kind === 'audio' ? this.localStream?.getAudioTracks() : this.localStream?.getVideoTracks();
    return tracks?.find(t => t.readyState === 'live')?.getSettings().deviceId ?? null;
  }

  /**
   * Switch the local camera to another video input without leaving the call.
   * When the camera is off, the choice is only remembered and used the next
   * time it turns on.
   */
  switchCamera(deviceId: string): Promise<MediaStream | null> {
    return this.switchInput('video', deviceId);
  }

  /**
   * Switch the local microphone to another audio input without leaving the
   * call. The remembered mute is kept. With no live mic the choice is only
   * remembered for the next acquisition.
   */
  switchMicrophone(deviceId: string): Promise<MediaStream | null> {
    return this.switchInput('audio', deviceId);
  }

  /**
   * Swap a new input onto every peer connection's sender for that kind with
   * `replaceTrack`, which needs no renegotiation, so peers keep the same
   * connection and simply start receiving the new source. The previous
   * device is released only after the swap succeeds.
   */
  private async switchInput(kind: 'audio' | 'video', deviceId: string): Promise<MediaStream | null> {
    const stream = this.localStream;
    const tracksOf = (s: MediaStream) => (kind === 'audio' ? s.getAudioTracks() : s.getVideoTracks());
    const oldTrack = stream ? tracksOf(stream).find(t => t.readyState === 'live') ?? null : null;
    if (!stream || !oldTrack) {
      // Nothing live to swap: remember the choice for the next acquisition.
      savePreferredInput(kind, deviceId);
      return stream;
    }
    if (oldTrack.getSettings().deviceId === deviceId) {
      savePreferredInput(kind, deviceId);
      return stream;
    }
    const seq = ++this.inputSwitchSeq[kind];
    const wantedEnabled = () => (kind === 'audio' ? !this.selfMuted : this.cameraEnabled);
    // A switch is abandoned when the stream was stopped (call ended), the
    // camera was turned off, or a newer switch started while we awaited.
    const stillWanted = () =>
      this.localStream === stream &&
      this.inputSwitchSeq[kind] === seq &&
      (kind === 'audio' || this.cameraEnabled);

    const constraints: MediaStreamConstraints =
      kind === 'audio' ? { audio: { deviceId: { exact: deviceId } } } : { video: { deviceId: { exact: deviceId } } };

    // Some devices (mostly phones) can only open one camera at a time, so
    // if acquiring alongside the old one fails, release it and try again.
    let newStream: MediaStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (!stillWanted()) throw error;
      oldTrack.stop();
      newStream = await navigator.mediaDevices.getUserMedia(constraints);
    }
    const newTrack = tracksOf(newStream)[0];
    newStream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
    if (!newTrack) throw new Error(`Selected ${kind} input produced no track`);
    // Send nothing until the switch is committed, so a camera-off or mute
    // that lands mid-switch can never leak to peers.
    newTrack.enabled = false;

    const swapped: RTCRtpSender[] = [];
    const abort = async (reason: string): Promise<never> => {
      newTrack.stop();
      // Put peers back on whatever the stream now holds (the old device if
      // it is still live and present, otherwise nothing).
      const current = this.localStream === stream
        ? tracksOf(stream).find(t => t.readyState === 'live') ?? null
        : null;
      for (const sender of swapped) {
        await sender.replaceTrack(current).catch(() => {});
      }
      throw new Error(`Input switch abandoned: ${reason}`);
    };

    if (!stillWanted()) return abort('call or camera state changed');

    const screenSenders = new Set(this.screenSenders.values());
    for (const [peerId, pc] of this.connections) {
      const sender =
        this.mediaTransceiver(pc, kind)?.sender ??
        pc.getSenders().find(s => s.track?.kind === kind && !screenSenders.has(s));
      if (!sender) continue;
      try {
        await sender.replaceTrack(newTrack);
        swapped.push(sender);
      } catch (error) {
        // replaceTrack only rejects when the new track would need a fresh
        // negotiation (or the connection is closing). Keep the old device
        // for everyone instead of leaving this peer with a dead track.
        if (pc.connectionState === 'closed') continue;
        console.warn(`[WebRTC] replaceTrack failed for ${peerId}`, error);
        if (oldTrack.readyState === 'live') {
          return abort(`peer ${peerId} cannot take the new ${kind} input without renegotiation`);
        }
        // Old device already released (single-camera device): slot the new
        // track the normal way and renegotiate with this peer.
        await this.slotTrackIntoPeer(pc, newTrack).catch(() => false);
        if (this.currentRoomId) {
          void this.createOfferForPeer(peerId).catch(() => {});
        }
      }
      if (!stillWanted()) return abort('call or camera state changed');
    }

    for (const t of tracksOf(stream)) {
      stream.removeTrack(t);
      t.stop();
    }
    stream.addTrack(newTrack);
    newTrack.enabled = wantedEnabled();
    // Script-side addTrack raises no event; tell bound <video> elements to
    // re-attach so every browser renders the new source.
    stream.dispatchEvent(new Event(LOCAL_INPUT_SWITCHED_EVENT));
    savePreferredInput(kind, deviceId);

    console.log(`[WebRTC] ${kind === 'audio' ? 'Microphone' : 'Camera'} switched to`, deviceId);
    this.announceMediaState();
    return stream;
  }


  /** True if there is at least one live (not ended) audio track on the local stream. */
  hasLiveAudioTrack(): boolean {
    return !!this.localStream?.getAudioTracks().some(t => t.readyState === 'live');
  }

  /**
   * Ask the browser for a screen capture. Kept separate from publishing so
   * the UI can call this synchronously from a user gesture and distinguish a
   * capture rejection from a WebRTC publishing failure.
   */
  async captureScreen(): Promise<MediaStream> {
    if (this.screenStream) return this.screenStream;
    // Screen audio is intentionally NOT requested: it would compete with
    // the voice track in the mesh. Voice keeps running untouched.
    // Note: `video: true` selects the screen's picture in getDisplayMedia;
    // it never enables the webcam (that is a separate getUserMedia path).
    return navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  }

  /**
   * Publish an already-captured screen stream onto every peer connection as
   * a normal second MediaStream (`addTrack(track, stream)`). The browser
   * raises `negotiationneeded` for each connection, so renegotiation runs
   * through exactly the same path as camera and microphone changes.
   */
  async publishScreenStream(stream: MediaStream): Promise<void> {
    if (this.screenStream && this.screenStream !== stream) {
      this.stopScreenShare();
    }
    const screenTrack = stream.getVideoTracks()[0] ?? null;
    if (!screenTrack || screenTrack.readyState === 'ended') {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('Screen capture produced no video track');
    }
    this.screenStream = stream;

    const failures: unknown[] = [];
    for (const [peerId, pc] of this.connections) {
      try {
        this.attachScreenTrack(peerId, pc, screenTrack, stream);
        void this.ensureOfferToPeer(peerId).catch(() => {});
      } catch (error) {
        failures.push(error);
        console.warn(`[WebRTC] Failed to attach screen track for ${peerId}:`, error);
      }
    }

    // Auto-stop when the user clicks the browser's own "Stop sharing" bar.
    screenTrack.addEventListener('ended', () => {
      if (this.screenStream === stream) this.stopScreenShare();
    });

    // Sharing to zero peers is still a success (they see it when they join);
    // only fail the call when every existing connection rejected the track.
    if (failures.length > 0 && failures.length === this.connections.size) {
      this.stopScreenShare();
      throw new Error('Screen share could not be published to any peer connection');
    }

    if (this.currentRoomId) sendScreenShareState(this.currentRoomId, true, stream.id);
    console.log('[WebRTC] Screen share published as stream', stream.id);

    this.broadcastMessage({
      type: 'screen-share-started',
      roomId: this.currentRoomId ?? '',
      peerId: getLocalMeshPeerId() ?? this.userId,
    });
  }

  /** Add the screen track to one connection, keyed to its own MediaStream. */
  private attachScreenTrack(peerId: string, pc: RTCPeerConnection, track: MediaStreamTrack, stream: MediaStream): void {
    const existing = this.screenSenders.get(peerId);
    if (existing) {
      void existing.replaceTrack(track).catch(() => { /* renegotiation will follow */ });
      return;
    }
    const sender = pc.addTrack(track, stream);
    this.screenSenders.set(peerId, sender);
  }

  async startScreenShare(): Promise<MediaStream> {
    if (this.screenStream) return this.screenStream;
    const stream = await this.captureScreen();
    await this.publishScreenStream(stream);
    return stream;
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach(track => track.stop());

    // Remove the screen sender from every connection. The browser raises
    // `negotiationneeded`, which the normal negotiation path handles.
    for (const [peerId, sender] of this.screenSenders) {
      const pc = this.connections.get(peerId);
      try { pc?.removeTrack(sender); } catch { /* connection may be closed */ }
      if (this.currentRoomId && pc) void this.ensureOfferToPeer(peerId).catch(() => {});
    }
    this.screenSenders.clear();

    this.screenStream = null;
    console.log('[WebRTC] Screen share stopped');

    if (this.currentRoomId) sendScreenShareState(this.currentRoomId, false);

    this.broadcastMessage({
      type: 'screen-share-stopped',
      roomId: this.currentRoomId ?? '',
      peerId: getLocalMeshPeerId() ?? this.userId,
    });
  }

  getScreenStream(): MediaStream | null { return this.screenStream; }

  async createPeerConnection(
    peerId: string,
    opts: { reuseFailed?: boolean; forAnswer?: boolean } = {},
  ): Promise<RTCPeerConnection> {
    // Reuse existing connection if it's still alive (or being ICE-restarted)
    const existing = this.connections.get(peerId);
    if (
      existing &&
      existing.connectionState !== 'closed' &&
      (existing.connectionState !== 'failed' || opts.reuseFailed)
    ) {
      return existing;
    }
    // Clear obsolete tracks and handlers along with the replaced connection.
    if (existing) this.removePeer(peerId);

    // Same STUN + TURN list as the data mesh: a pair that only reaches
    // each other through a relay must be able to relay audio too.
    const config: RTCConfiguration = {
      iceServers: DEFAULT_ICE_SERVERS,
    };

    const pc = new RTCPeerConnection(config);
    this.connections.set(peerId, pc);
    pc.onsignalingstatechange = () => this.drainNegotiation(peerId, pc);

    // Always create audio + video transceivers up front in `sendrecv`.
    // This guarantees the SDP advertises receive directions on BOTH sides
    // even when one peer's mic/camera hasn't been acquired yet — preventing
    // the asymmetric "I hear them but they can't hear me" bug that occurs
    // when an offer is sent with no `m=audio` section and the late-added
    // track never makes it into a renegotiation.
    //
    // Not when the connection is created to answer an offer: browsers never
    // reuse `addTransceiver` transceivers for a remote offer's m-lines, so
    // our mic would sit on an extra, unnegotiated transceiver and the answer
    // would go out receive-only. `adoptOfferedTransceivers` attaches our
    // tracks to the offered ones instead.
    const audioTransceiver = opts.forAnswer ? null : pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = opts.forAnswer ? null : pc.addTransceiver('video', { direction: 'sendrecv' });

    // Attach local camera/mic tracks if already available
    if (this.localStream && audioTransceiver && videoTransceiver) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (audioTrack) {
        await audioTransceiver.sender.replaceTrack(audioTrack);
      }
      if (videoTrack) {
        await videoTransceiver.sender.replaceTrack(videoTrack);
      }
    }

    // Attach the screen track (if already sharing) so late joiners see it.
    // It travels as its own MediaStream, exactly like any second video source.
    // When answering, wait until the offer's camera slot is adopted: an
    // addTrack() transceiver created now could be taken for the offer's
    // camera m-line, leaving no slot for the camera.
    const screenTrack = this.screenStream?.getVideoTracks()[0] ?? null;
    if (screenTrack && this.screenStream && !opts.forAnswer) {
      this.attachScreenTrack(peerId, pc, screenTrack, this.screenStream);
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      if (this.connections.get(peerId) !== pc) return;
      console.log('[WebRTC] 🎵 Received remote track from:', peerId, event.track.kind, 'streams:', event.streams.length);
      const participant = this.ensureParticipant(peerId);

      // Camera and microphone are sent on the upfront transceivers without a
      // stream association, so they arrive with no MediaStream. The screen is
      // sent with `addTrack(track, screenStream)`, so the browser delivers it
      // inside its own stream — that is the classification, straight from the
      // negotiated media description.
      const incomingStream = event.streams[0] ?? null;
      const isScreenTrack = event.track.kind === 'video' && !!incomingStream;

      console.log('[WebRTC] Track classification:', {
        peerId,
        kind: event.track.kind,
        streamId: incomingStream?.id,
        isScreenTrack,
      });

      if (isScreenTrack && incomingStream) {
        participant.screenStream = incomingStream;
        console.log('[WebRTC] 🖥️ Screen share stream received from', peerId, incomingStream.id);
        incomingStream.addEventListener('removetrack', () => {
          if (incomingStream.getVideoTracks().length === 0) {
            participant.screenStream = null;
            this.broadcastMessage({
              type: 'screen-share-stopped',
              roomId: this.currentRoomId ?? '',
              peerId,
            });
          }
        });
      } else {
        // One current track per kind. A new stream identity makes audio/video
        // elements rebind even on browsers where script addTrack emits no event.
        const retained = participant.stream?.getTracks().filter(track =>
          track.readyState === 'live' && track.kind !== event.track.kind) ?? [];
        participant.stream = new MediaStream([...retained, event.track]);
        // An empty, reserved video slot arrives muted — that is not a camera.
        if (event.track.kind === 'video' && event.track.muted) {
          participant.isVideoEnabled = false;
        }
      }

      const isCameraTrack = event.track.kind === 'video' && !isScreenTrack;

      // Drop dead tracks instead of holding silent references.
      event.track.onended = () => {
        if (this.connections.get(peerId) !== pc) return;
        if (!isScreenTrack && !participant.stream?.getTracks().includes(event.track)) return;
        console.log(`[WebRTC] 🛑 Remote ${event.track.kind} track ended for ${peerId}`);
        if (participant.stream && participant.stream.getTracks().includes(event.track)) {
          participant.stream = new MediaStream(participant.stream.getTracks().filter(track =>
            track !== event.track && track.readyState === 'live'));
        }
        if (isScreenTrack) {
          participant.screenStream = null;
        }
        if (isCameraTrack) participant.isVideoEnabled = false;
        this.broadcastMessage({
          type: 'peer-joined',
          roomId: this.currentRoomId!,
          peerId,
        });
      };

      event.track.onmute = () => {
        if (this.connections.get(peerId) !== pc) return;
        if (!isScreenTrack && !participant.stream?.getTracks().includes(event.track)) return;
        if (isCameraTrack) {
          participant.isVideoEnabled = false;
          this.broadcastMessage({
            type: 'peer-media-state',
            roomId: this.currentRoomId ?? '',
            peerId,
            camera: false,
          });
        }
      };

      event.track.onunmute = () => {
        if (this.connections.get(peerId) !== pc) return;
        if (!isScreenTrack && !participant.stream?.getTracks().includes(event.track)) return;
        if (isCameraTrack) participant.isVideoEnabled = true;
        this.broadcastMessage({
          type: isScreenTrack ? 'screen-share-started' : 'peer-joined',
          roomId: this.currentRoomId ?? '',
          peerId,
        });
      };

      // Notify UI of updated participant
      this.broadcastMessage({
        type: isScreenTrack ? 'screen-share-started' : 'peer-joined',
        roomId: this.currentRoomId ?? '',
        peerId,
      });
    };


    // ICE candidates → send via mesh
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentRoomId) {
        sendSignalViaMesh(peerId, this.currentRoomId, 'candidate', event.candidate.toJSON());
      }
    };

    // ── Connection state: recovery instead of immediate removal ──
    pc.onconnectionstatechange = () => {
      if (this.connections.get(peerId) !== pc) return;
      console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);

      if (pc.connectionState === 'connected') {
        console.log(`[WebRTC] ✅ Media connected with ${peerId}`);
        // Clear any pending recovery timers — connection is healthy
        this.clearDisconnectTimer(peerId);
        this.clearReconnectTimer(peerId);
        this.reconnectAttempts.delete(peerId);
        this.clearNegotiationTimer(peerId);
      }

      if (pc.connectionState === 'disconnected') {
        // Grace period before attempting recovery
        this.startDisconnectGrace(peerId);
      }

      if (pc.connectionState === 'failed') {
        // Immediate recovery attempt
        this.clearDisconnectTimer(peerId);
        this.attemptRecovery(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state with', peerId, ':', pc.iceConnectionState);
    };

    // Backstop: if replaceTrack/addTrack mutates senders in a way that
    // requires renegotiation and our manual paths missed it, the browser
    // fires this event. Funnels through the same locked offer path so glare
    // handling still applies.
    pc.onnegotiationneeded = () => {
      if (!this.currentRoomId) return;
      console.log(`[WebRTC] 🔔 negotiationneeded for ${peerId}`);
      void this.createOfferForPeer(peerId).catch(err =>
        console.warn(`[WebRTC] negotiationneeded offer failed for ${peerId}:`, err));
    };

    const queuedCandidates = this.pendingCandidates.get(peerId) ?? [];
    if (queuedCandidates.length > 0) {
      queuedCandidates.forEach((candidate) => {
        if (!pc.remoteDescription) return;
        void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
          console.warn(`[WebRTC] Failed to apply queued ICE candidate for ${peerId}:`, error);
        });
      });
      if (pc.remoteDescription) this.pendingCandidates.delete(peerId);
    }

    return pc;
  }

  // ── Recovery Logic ─────────────────────────────────────────────────

  private startDisconnectGrace(peerId: string): void {
    if (this.disconnectTimers.has(peerId)) return; // already waiting

    console.log(`[WebRTC] ⏳ Disconnect grace period for ${peerId} (${DISCONNECT_GRACE_MS / 1000}s)`);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(peerId);
      const pc = this.connections.get(peerId);
      if (pc && pc.connectionState !== 'connected') {
        this.attemptRecovery(peerId);
      }
    }, DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(peerId, timer);
  }

  private attemptRecovery(peerId: string): void {
    if (!this.currentRoomId) return;
    // One recovery step per timer window: its timer retries on expiry, so
    // duplicate failure events cannot escalate straight to a teardown.
    if (this.reconnectTimers.has(peerId)) return;
    this.clearReconnectTimer(peerId);
    const attempts = this.reconnectAttempts.get(peerId) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts.delete(peerId);
      this.removePeer(peerId);
      // Still in the room (heartbeats arriving over the mesh)? Then the
      // network is just being difficult: keep them listed and start over
      // after a pause. Dropping them here left the two users unable to
      // hear each other until somebody re-joined.
      if (isRoomPeerPresent(this.currentRoomId, peerId)) {
        console.log(`[WebRTC] ⏸ Recovery attempts exhausted for ${peerId}; retrying in ${RECOVERY_BACKOFF_MS / 1000}s`);
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(peerId);
          if (this.participants.has(peerId)) this.attemptRecovery(peerId);
        }, RECOVERY_BACKOFF_MS);
        this.reconnectTimers.set(peerId, timer);
        return;
      }
      console.log(`[WebRTC] ❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for ${peerId} — removing`);
      this.cleanupPeer(peerId);
      this.broadcastMessage({
        type: 'peer-left',
        roomId: this.currentRoomId ?? '',
        peerId,
      });
      return;
    }

    this.reconnectAttempts.set(peerId, attempts + 1);
    this.lastRepairAt.set(peerId, Date.now());
    console.log(`[WebRTC] 🔄 Recovery attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} for ${peerId}`);

    const pc = this.connections.get(peerId);
    if (attempts === 0 && pc && pc.connectionState !== 'closed') {
      // First try an ICE restart on the same connection: new candidates
      // (including TURN relays) without tearing down the call, so a brief
      // network change does not cut audio for both sides.
      console.log(`[WebRTC] ❄️ ICE restart for ${peerId}`);
      void this.createOfferForPeer(peerId, { iceRestart: true }).catch(err =>
        console.warn(`[WebRTC] ICE restart offer failed for ${peerId}:`, err));
    } else {
      // Tear down stale connection and ask the peer for a fresh one.
      this.removePeer(peerId);
      sendReconnectRequest(peerId, this.currentRoomId, 'reconnect-request');
    }

    // If not connected within the timeout, escalate (or eventually back off).
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peerId);
      const current = this.connections.get(peerId);
      if (!current || current.connectionState !== 'connected') {
        this.attemptRecovery(peerId);
      }
    }, RECONNECT_TIMEOUT_MS);
    this.reconnectTimers.set(peerId, timer);
  }

  private clearDisconnectTimer(peerId: string): void {
    const timer = this.disconnectTimers.get(peerId);
    if (timer) { clearTimeout(timer); this.disconnectTimers.delete(peerId); }
  }

  private clearReconnectTimer(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) { clearTimeout(timer); this.reconnectTimers.delete(peerId); }
  }

  /** Remove connection without clearing participant (used during recovery) */
  private removePeer(peerId: string): void {
    this.clearNegotiationTimer(peerId);
    this.negotiationLock.delete(peerId);
    this.negotiationNeeded.delete(peerId);
    this.makingOffer.delete(peerId);
    this.queuedIceRestarts.delete(peerId);
    this.ignoredOffers.delete(peerId);
    this.applyingRemoteOffer.delete(peerId);
    this.screenSenders.delete(peerId);
    const pc = this.connections.get(peerId);
    this.connections.delete(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.onnegotiationneeded = null;
      pc.onsignalingstatechange = null;
      pc.close();
    }
    const participant = this.participants.get(peerId);
    if (participant) {
      participant.stream = null;
      participant.screenStream = null;
      participant.isVideoEnabled = false;
    }
    this.pendingCandidates.delete(peerId);
  }

  /** Full cleanup: connection + participant + timers */
  private cleanupPeer(peerId: string): void {
    this.removePeer(peerId);
    this.participants.delete(peerId);
    this.clearDisconnectTimer(peerId);
    this.clearReconnectTimer(peerId);
    this.reconnectAttempts.delete(peerId);
    this.negotiationLock.delete(peerId);
    this.negotiationNeeded.delete(peerId);
    this.makingOffer.delete(peerId);
    this.remoteScreenStreamIds.delete(peerId);
    this.screenSenders.delete(peerId);
  }

  private async flushPendingCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    if (!pc.remoteDescription) return;
    const queued = this.pendingCandidates.get(peerId) ?? [];
    if (queued.length === 0) return;

    this.pendingCandidates.delete(peerId);
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        console.warn(`[WebRTC] Failed to flush queued ICE candidate for ${peerId}:`, error);
      });
    }
  }

  async createOffer(peerId: string): Promise<void> {
    await this.createOfferForPeer(peerId);
  }

  /**
   * Public offer request that preserves the lock and queues behind an
   * in-flight exchange, rather than starting competing negotiations.
   */
  async ensureOfferToPeer(peerId: string): Promise<void> {
    await this.createOfferForPeer(peerId);
  }

  /**
   * The camera or microphone transceiver of a connection: the first live
   * one of that kind that is negotiated (has a mid), else the first
   * unnegotiated one. Never the screen-share transceiver. Index-based
   * lookup broke on the answering side, where the offer's transceivers
   * come after any created locally.
   */
  private mediaTransceiver(pc: RTCPeerConnection, kind: 'audio' | 'video'): RTCRtpTransceiver | undefined {
    const screenSenders = new Set(this.screenSenders.values());
    const candidates = pc.getTransceivers().filter(t =>
      !(t as RTCRtpTransceiver & { stopped?: boolean }).stopped &&
      t.currentDirection !== 'stopped' &&
      t.direction !== 'stopped' &&
      t.receiver?.track?.kind === kind &&
      !screenSenders.has(t.sender),
    );
    return candidates.find(t => t.mid !== null) ?? candidates[0];
  }

  /**
   * After applying a remote offer: send our mic/camera on the transceivers
   * it negotiated, and retire any unnegotiated local ones of the same kind
   * (left over from glare rollback) so they cannot trigger a duplicate
   * m-line later.
   */
  private async adoptOfferedTransceivers(peerId: string, pc: RTCPeerConnection): Promise<void> {
    for (const kind of ['audio', 'video'] as const) {
      const main = this.mediaTransceiver(pc, kind);
      if (!main || main.mid === null) continue;
      const local = (kind === 'audio' ? this.localStream?.getAudioTracks() : this.localStream?.getVideoTracks())
        ?.find(t => t.readyState === 'live') ?? null;
      const screenSenders = new Set(this.screenSenders.values());
      for (const t of pc.getTransceivers()) {
        if (t === main || t.mid !== null || screenSenders.has(t.sender)) continue;
        if (t.receiver?.track?.kind !== kind) continue;
        try { await t.sender.replaceTrack(null); } catch { /* ignore */ }
        try { t.stop(); } catch { /* ignore */ }
      }
      if (local && main.sender.track !== local) {
        try { await main.sender.replaceTrack(local); } catch (err) {
          console.warn(`[WebRTC] could not attach local ${kind} to offered transceiver`, err);
        }
      }
      // Always be ready to send, even before the mic/camera exists, so a
      // later replaceTrack needs no renegotiation.
      if (main.direction !== 'sendrecv') {
        try { main.direction = 'sendrecv'; } catch { /* ignore */ }
      }
    }
    // Sharing our screen: add it now as its own stream. It needs a new
    // m-line, so the browser raises negotiationneeded and we offer it once
    // this answer settles.
    const screenTrack = this.screenStream?.getVideoTracks()[0] ?? null;
    if (screenTrack && this.screenStream && !this.screenSenders.has(peerId)) {
      try { this.attachScreenTrack(peerId, pc, screenTrack, this.screenStream); } catch (err) {
        console.warn(`[WebRTC] could not attach screen share for ${peerId}`, err);
      }
    }
  }

  /**
   * Slot a freshly-acquired local track into the upfront sendrecv
   * transceiver for the peer. Uses ordered lookup (index 0 = audio,
   * 1 = video) — these are created in `createPeerConnection` in that
   * exact order. Returns true if the caller should renegotiate.
   *
   * This replaces the previous heuristic that matched by
   * `receiver.track?.kind`, which is null pre-negotiation and silently
   * dropped late-added mic/camera tracks — the root cause of live rooms
   * showing each user only their own video.
   */
  private async slotTrackIntoPeer(pc: RTCPeerConnection, track: MediaStreamTrack): Promise<boolean> {
    const upfront = track.kind === 'audio' || track.kind === 'video'
      ? this.mediaTransceiver(pc, track.kind)
      : undefined;
    if (upfront && upfront.sender) {
      const previous = upfront.sender.track;
      if (previous && previous !== track && previous.readyState === 'live' && previous.kind === track.kind) {
        // Live track already on this slot — swap to the newer source and
        // renegotiate anyway. If the prior SDP was created while this slot
        // was null/quiet, the remote may still have no SSRC for this kind;
        // skipping an offer here is what makes cameras fade out after a
        // camera-off/camera-on cycle.
        await upfront.sender.replaceTrack(track);
        try { upfront.direction = 'sendrecv'; } catch { /* not all browsers allow direction set post-create */ }
        return true;
      }
      await upfront.sender.replaceTrack(track);
      try { upfront.direction = 'sendrecv'; } catch { /* not all browsers allow direction set post-create */ }
      return true; // first-time slot fill requires renegotiation
    }
    // Fallback — should not happen because createPeerConnection always
    // adds audio + video transceivers, but stay defensive.
    const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
    if (sender && (!sender.track || sender.track.readyState === 'ended')) {
      await sender.replaceTrack(track);
      return true;
    }
    if (!sender) {
      if (this.localStream) pc.addTrack(track, this.localStream);
      return true;
    }
    await sender.replaceTrack(track);
    return false;
  }

  /**
   * Public resync — operator-triggered when a tile is silent or
   * black-screened. Resets backoff and forces a fresh negotiation
   * against the peer.
   */
  async resyncPeer(peerId: string): Promise<void> {
    if (!this.currentRoomId) return;
    console.log(`[WebRTC] 🔁 Manual resync for ${peerId}`);
    this.lastRepairAt.set(peerId, Date.now());
    this.reconnectAttempts.set(peerId, 0);
    this.clearReconnectTimer(peerId);
    this.removePeer(peerId);
    sendReconnectRequest(peerId, this.currentRoomId, 'reconnect-request');
    // If no ack arrives, attempt our own offer as a fallback.
    setTimeout(() => {
      const pc = this.connections.get(peerId);
      if (!pc || pc.connectionState !== 'connected') {
        this.createOfferForPeer(peerId).catch((e) =>
          console.error('[WebRTC] resync offer failed:', e),
        );
      }
    }, 800);
  }

  /**
   * Restart ICE on an existing peer connection without tearing it
   * down. Used by the black-frame watchdog when a track is attached
   * but `videoWidth === 0`.
   */
  async restartIceFor(peerId: string): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) {
      await this.resyncPeer(peerId);
      return;
    }
    try {
      console.log(`[WebRTC] ❄️ restartIce for ${peerId}`);
      (pc as RTCPeerConnection & { restartIce?: () => void }).restartIce?.();
    } catch (err) {
      console.warn('[WebRTC] restartIce failed, falling back to resync:', err);
      await this.resyncPeer(peerId);
    }
  }

  /**
   * Half-open repair sweep. For every known participant whose PC isn't
   * in `connected` state, trigger a resync. Safe to call on a timer.
   */
  sweepHalfOpenConnections(): void {
    if (!this.currentRoomId) return;
    for (const peerId of this.participants.keys()) {
      const pc = this.connections.get(peerId);
      if (this.disconnectTimers.has(peerId) || this.reconnectTimers.has(peerId) ||
          this.negotiationLock.get(peerId) || this.applyingRemoteOffer.has(peerId) ||
          (pc && pc.signalingState !== 'stable')) continue;
      const last = this.lastRepairAt.get(peerId);
      if (last !== undefined && Date.now() - last < MEDIA_REPAIR_COOLDOWN_MS) continue;
      if (pc?.connectionState === 'disconnected') this.startDisconnectGrace(peerId);
      else if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.attemptRecovery(peerId);
      }
    }
  }

  async handleSignal(signal: WebRTCSignal): Promise<void> {
    const { type, from, data } = signal;

    if (type === 'offer') {
      await this.handleRemoteOffer(from, data as RTCSessionDescriptionInit);
    } else if (type === 'answer') {
      await this.handleRemoteAnswer(from, data as RTCSessionDescriptionInit);
    } else if (type === 'candidate') {
      await this.handleRemoteCandidate(from, data as RTCIceCandidateInit);
    }
  }

  // ── Moderation ─────────────────────────────────────────────────────

  mutePeer(peerId: string): void {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;
    if (!room.mutedPeers.includes(peerId)) room.mutedPeers.push(peerId);
    this.broadcastMessage({ type: 'peer-muted', roomId: this.currentRoomId, peerId });
  }

  banPeer(peerId: string): void {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;
    if (!room.bannedPeers.includes(peerId)) room.bannedPeers.push(peerId);
    room.participants = room.participants.filter(p => p !== peerId);
    this.broadcastMessage({ type: 'peer-banned', roomId: this.currentRoomId, peerId });
    this.cleanupPeer(peerId);
  }

  // ── Internal Helpers ───────────────────────────────────────────────

  private closeAllConnections(): void {
    // Cleanup all recovery timers
    for (const peerId of this.connections.keys()) {
      this.clearDisconnectTimer(peerId);
      this.clearReconnectTimer(peerId);
    }
    for (const peerId of Array.from(this.connections.keys())) this.removePeer(peerId);
    this.negotiationTimers.forEach(timer => clearTimeout(timer));
    this.negotiationTimers.clear();
    this.queuedIceRestarts.clear();
    this.ignoredOffers.clear();
    this.applyingRemoteOffer.clear();
    this.pendingCandidates.clear();
    this.participants.clear();
    this.reconnectAttempts.clear();
    this.negotiationLock.clear();
    this.negotiationNeeded.clear();
    this.makingOffer.clear();
  }

  /**
   * Look up (or create) a participant. A real username is backfilled the
   * moment any later signal carries one — the first signal about a peer
   * often has no name, and keeping that placeholder forever is what showed
   * "Peer" / "Unknown" under video and screen tiles.
   */
  private ensureParticipant(peerId: string, username?: string): VideoParticipant {
    const clean = typeof username === 'string' ? username.trim() : '';
    const named = clean && clean !== 'Peer' && clean !== 'Unknown' ? clean : '';

    const existing = this.participants.get(peerId);
    if (existing) {
      if (named && existing.username !== named) existing.username = named;
      return existing;
    }

    const participant: VideoParticipant = {
      peerId,
      username: named,
      stream: null,
      isMuted: false,
      // No camera until the peer says otherwise: an empty video slot must
      // never render as a black tile.
      isVideoEnabled: false,
      joinedAt: new Date().toISOString(),
    };
    this.participants.set(peerId, participant);
    return participant;
  }

  private broadcastMessage(message: VideoRoomMessage): void {
    this.messageHandlers.forEach(handler => {
      try { handler(message); } catch (error) {
        console.error('[WebRTC] Message handler error:', error);
      }
    });
  }

  onMessage(handler: (message: VideoRoomMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  getCurrentRoom(): VideoRoom | null {
    if (!this.currentRoomId) return null;
    return this.rooms.get(this.currentRoomId) || null;
  }

  hasActivePeerConnection(peerId: string): boolean {
    const pc = this.connections.get(peerId);
    return Boolean(pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed');
  }

  getLocalStream(): MediaStream | null { return this.localStream; }
  getParticipants(): VideoParticipant[] { return Array.from(this.participants.values()); }
  getRooms(): VideoRoom[] { return Array.from(this.rooms.values()); }

  /**
   * Remembered microphone state. `toggleAudio(false)` means muted, and the
   * choice survives camera toggles, reconnects and stream re-acquisition
   * because `applyLocalMuteState` re-applies it to every new audio track.
   */
  toggleAudio(enabled: boolean): void {
    this.selfMuted = !enabled;
    this.applyLocalMuteState();
    this.announceMediaState();
  }

  /** True when the user has muted themselves. */
  isSelfMuted(): boolean { return this.selfMuted; }

  /** True when the user's camera is on. */
  isCameraOn(): boolean { return this.cameraEnabled; }

  /** Re-apply the remembered mute to every live audio track. */
  applyLocalMuteState(): void {
    if (!this.localStream) return;
    const enabled = !this.selfMuted;
    this.localStream.getAudioTracks().forEach(track => { track.enabled = enabled; });
  }

  toggleVideo(enabled: boolean): void {
    this.cameraEnabled = enabled;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => { track.enabled = enabled; });
    }
    this.announceMediaState();
  }

  /** Broadcast our name plus camera/mic state to everyone in the room. */
  private announceMediaState(): void {
    if (!this.currentRoomId) return;
    const cameraLive =
      this.cameraEnabled &&
      !!this.localStream?.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
    try {
      sendMediaState(
        this.currentRoomId,
        { camera: cameraLive, mic: !this.selfMuted },
        this.username,
        this.userId,
      );
    } catch (err) {
      console.warn('[WebRTC] media-state announce failed', err);
    }
  }

  /**
   * Periodic two-way media check. A connection that is up but carrying no
   * inbound media (or missing entirely) is re-offered once, with a cooldown
   * so both sides cannot fight each other. This is the repair for the
   * "I can hear them, they cannot hear me" split.
   */
  private startMediaHealthCheck(): void {
    this.stopMediaHealthCheck();
    this.healthTimer = setInterval(() => {
      if (!this.currentRoomId) return;
      const now = Date.now();
      for (const peerId of this.participants.keys()) {
        const pc = this.connections.get(peerId);
        const last = this.lastRepairAt.get(peerId);
        if (last !== undefined && now - last < MEDIA_REPAIR_COOLDOWN_MS) continue;
        if (this.negotiationLock.get(peerId) || this.applyingRemoteOffer.has(peerId) ||
            (pc && pc.signalingState !== 'stable')) continue;
        // A disconnect grace or recovery already owns this peer. Repairing
        // on top of it tore down the connection the recovery was building,
        // and the two sides kept resetting each other.
        if (this.disconnectTimers.has(peerId) || this.reconnectTimers.has(peerId)) continue;

        const state = pc?.connectionState;
        // 'disconnected' is usually a blip that heals by itself; the
        // grace timer started by onconnectionstatechange handles it.
        const halfOpen = !pc || state === 'failed' || state === 'closed';
        const receivingNothing =
          !!pc &&
          state === 'connected' &&
          this.participants.get(peerId)?.isMuted !== true &&
          pc.getReceivers().every(r => !r.track || r.track.readyState === 'ended');
        // Our live mic must be on a negotiated transceiver. A track parked
        // on an unnegotiated one looks fine locally but never leaves.
        const liveMic = this.localStream?.getAudioTracks().find(t => t.readyState === 'live');
        const micTransceiver = pc ? this.mediaTransceiver(pc, 'audio') : undefined;
        const notSending =
          !!pc &&
          state === 'connected' &&
          !this.selfMuted &&
          !!liveMic &&
          (!micTransceiver || micTransceiver.mid === null || micTransceiver.sender.track !== liveMic ||
            (micTransceiver.currentDirection !== 'sendrecv' && micTransceiver.currentDirection !== 'sendonly'));

        if (halfOpen || receivingNothing || notSending) {
          this.lastRepairAt.set(peerId, now);
          console.log(`[WebRTC] 🩺 media health repair for ${peerId}`, { state, receivingNothing, notSending });
          if (halfOpen) {
            this.attemptRecovery(peerId);
          } else if (notSending && liveMic && pc) {
            void this.slotTrackIntoPeer(pc, liveMic)
              .catch(() => false)
              .then(() => this.ensureOfferToPeer(peerId))
              .catch(() => {});
          } else {
            void this.ensureOfferToPeer(peerId).catch(() => {});
          }
        }
      }
      // Keep our own state fresh for anyone who missed the last announce.
      this.announceMediaState();
    }, MEDIA_HEALTH_INTERVAL_MS);
  }

  private stopMediaHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.lastRepairAt.clear();
  }

  destroy(): void {
    if (this.signalUnsub) {
      this.signalUnsub();
      this.signalUnsub = null;
    }
    this.leaveRoom();
    this.stopMediaHealthCheck();
    this.messageHandlers.clear();
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.reconnectTimers.forEach(t => clearTimeout(t));
  }
}

let webrtcManager: WebRTCManager | null = null;

export function getWebRTCManager(userId: string, username: string): WebRTCManager {
  if (!webrtcManager) {
    webrtcManager = new WebRTCManager(userId, username);
  }
  return webrtcManager;
}

export function destroyWebRTCManager(): void {
  if (webrtcManager) {
    webrtcManager.destroy();
    webrtcManager = null;
  }
}
