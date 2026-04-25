import type { VideoRoom, VideoParticipant, WebRTCSignal, VideoRoomMessage } from './types';
import {
  sendSignalViaMesh,
  sendReconnectRequest,
  announceJoinRoom,
  announceLeaveRoom,
  onSignal,
  getLocalMeshPeerId,
  isBridgeActive,
} from '@/lib/streaming/webrtcSignalingBridge.standalone';

const MAX_RECONNECT_ATTEMPTS = 3;
const DISCONNECT_GRACE_MS = 10_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const MAX_NEGOTIATION_RETRIES = 5;

export class WebRTCManager {
  private rooms = new Map<string, VideoRoom>();
  private connections = new Map<string, RTCPeerConnection>();
  private participants = new Map<string, VideoParticipant>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
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
  /** Consecutive deferred-offer retries per peer; resets on successful send. */
  private negotiationRetryCount = new Map<string, number>();

  // ── Reconnection state ──────────────────────────────────────────
  private reconnectAttempts = new Map<string, number>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(userId: string, username: string) {
    this.userId = userId;
    this.username = username;
    this.setupSignalListener();
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

          // A new peer joined our room — send them an offer
          console.log(`[WebRTC] Peer ${meshPeerId} joining, creating offer`);
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Unknown');
          this.broadcastMessage({
            type: 'peer-joined',
            roomId: this.currentRoomId,
            peerId: meshPeerId,
            username: envelope.username,
          });

          // Create offer to the new peer
          this.createOfferForPeer(meshPeerId).catch(e =>
            console.error('[WebRTC] Failed to create offer:', e)
          );
          break;
        }

        case 'room-sync': {
          const participants = envelope.participants ?? [];
          console.log(`[WebRTC] Room sync: ${participants.length} participants`);
          for (const p of participants) {
            if (p !== getLocalMeshPeerId()) {
              this.ensureParticipant(p, 'Peer');
            }
          }
          this.broadcastMessage({
            type: 'peer-joined',
            roomId: this.currentRoomId!,
            peerId: meshPeerId,
          });
          break;
        }

        case 'leave-room': {
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
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Peer');
          this.handleRemoteOffer(meshPeerId, envelope.data as RTCSessionDescriptionInit);
          break;
        }

        case 'answer': {
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Peer');
          this.handleRemoteAnswer(meshPeerId, envelope.data as RTCSessionDescriptionInit);
          break;
        }

        case 'candidate': {
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Peer');
          this.handleRemoteCandidate(meshPeerId, envelope.data as RTCIceCandidateInit);
          break;
        }

        case 'reconnect-request': {
          console.log(`[WebRTC] 🔄 Reconnect request from ${meshPeerId}`);
          // Tear down stale connection and let them re-offer
          this.removePeer(meshPeerId);
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Peer');
          // Send ack via mesh
          sendReconnectRequest(meshPeerId, this.currentRoomId!, 'reconnect-ack');
          break;
        }

        case 'reconnect-ack': {
          console.log(`[WebRTC] 🔄 Reconnect ack from ${meshPeerId} — creating fresh offer`);
          this.clearReconnectTimer(meshPeerId);
          this.ensureParticipant(meshPeerId, envelope.username ?? 'Peer');
          this.createOfferForPeer(meshPeerId).catch(e =>
            console.error('[WebRTC] Failed reconnect offer:', e)
          );
          break;
        }
      }
    });
  }

  // ── WebRTC Negotiation ─────────────────────────────────────────────

  private async createOfferForPeer(meshPeerId: string): Promise<void> {
    if (!this.currentRoomId) return;

    // Prevent parallel negotiations with the same peer
    if (this.negotiationLock.get(meshPeerId)) {
      this.negotiationNeeded.set(meshPeerId, true);
      console.log(`[WebRTC] Queued negotiation for ${meshPeerId}`);
      return;
    }

    this.negotiationLock.set(meshPeerId, true);
    this.makingOffer.set(meshPeerId, true);

    try {
      const pc = await this.createPeerConnection(meshPeerId);

      if (pc.signalingState !== 'stable') {
        console.log(`[WebRTC] Deferring offer for ${meshPeerId}; signalingState=${pc.signalingState}`);
        this.negotiationNeeded.set(meshPeerId, true);
        return;
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignalViaMesh(meshPeerId, this.currentRoomId, 'offer', offer);
      console.log(`[WebRTC] 📤 Sent offer to ${meshPeerId}`);
      this.negotiationRetryCount.delete(meshPeerId);
    } finally {
      this.makingOffer.set(meshPeerId, false);
      this.negotiationLock.set(meshPeerId, false);

      // Drain pending renegotiation. Keep retrying with backoff until the
      // late track actually gets advertised — silently dropping here is the
      // root cause of asymmetric one-way audio.
      if (this.negotiationNeeded.get(meshPeerId)) {
        this.negotiationNeeded.delete(meshPeerId);
        const retries = (this.negotiationRetryCount.get(meshPeerId) ?? 0) + 1;
        if (retries > MAX_NEGOTIATION_RETRIES) {
          console.warn(
            `[WebRTC] ⚠️ Negotiation retry cap (${MAX_NEGOTIATION_RETRIES}) hit for ${meshPeerId} — escalating to recovery`,
          );
          this.negotiationRetryCount.delete(meshPeerId);
          this.attemptRecovery(meshPeerId);
        } else {
          this.negotiationRetryCount.set(meshPeerId, retries);
          setTimeout(() => {
            void this.createOfferForPeer(meshPeerId);
          }, 300);
        }
      }
    }
  }

  private async handleRemoteOffer(meshPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[WebRTC] 📥 Received offer from ${meshPeerId}`);
    const pc = await this.createPeerConnection(meshPeerId);

    const isCurrentlyMakingOffer = this.makingOffer.get(meshPeerId) ?? false;
    const offerCollision = isCurrentlyMakingOffer || pc.signalingState !== 'stable';

    if (offerCollision) {
      const polite = this.isPolite(meshPeerId);
      if (!polite) {
        // Impolite peer ignores the incoming offer during glare — but we
        // MUST schedule a follow-up offer, otherwise our late-added local
        // tracks (e.g. mic) never reach this peer and they'll never hear us.
        console.log(`[WebRTC] ⚡ Glare detected with ${meshPeerId} — ignoring (impolite); will re-offer`);
        this.negotiationNeeded.set(meshPeerId, true);
        setTimeout(() => {
          void this.createOfferForPeer(meshPeerId).catch(err =>
            console.warn('[WebRTC] post-glare re-offer failed:', err));
        }, 500);
        return;
      }
      // Polite peer rolls back
      console.log(`[WebRTC] ⚡ Glare detected with ${meshPeerId} — rolling back (polite)`);
      await pc.setLocalDescription({ type: 'rollback' });
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendSignalViaMesh(meshPeerId, this.currentRoomId!, 'answer', answer);
    console.log(`[WebRTC] 📤 Sent answer to ${meshPeerId}`);
  }

  private async handleRemoteAnswer(meshPeerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[WebRTC] 📥 Received answer from ${meshPeerId}`);
    const pc = this.connections.get(meshPeerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleRemoteCandidate(meshPeerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.connections.get(meshPeerId);
    if (pc?.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
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

    console.log('[WebRTC] Joined room:', roomId);
    return true;
  }

  async leaveRoom(): Promise<void> {
    if (!this.currentRoomId) return;

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
          const audioConstraint =
            needAudio && deviceIds?.audioInputId
              ? ({ deviceId: { exact: deviceIds.audioInputId } } as MediaTrackConstraints)
              : needAudio;
          const videoConstraint =
            needVideo && deviceIds?.videoInputId
              ? ({ deviceId: { exact: deviceIds.videoInputId } } as MediaTrackConstraints)
              : needVideo;
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
              // Prefer reusing the upfront sendrecv transceiver via
              // replaceTrack — this preserves SDP m-line ordering and
              // avoids forcing a renegotiation in most cases.
              const transceiver = pc.getTransceivers()
                .find(t => t.sender.track === null && t.receiver.track?.kind === newTrack.kind)
                ?? pc.getTransceivers().find(t => !t.sender.track && (t as any).kind === newTrack.kind);
              const existingSender = pc.getSenders().find(s => s.track?.kind === newTrack.kind);
              let renegotiate = false;
              if (transceiver && !transceiver.sender.track) {
                await transceiver.sender.replaceTrack(newTrack);
                // First-time slot fill on a sendrecv transceiver still needs
                // an offer so the remote learns the SSRC mapping.
                renegotiate = true;
              } else if (existingSender) {
                await existingSender.replaceTrack(newTrack);
              } else {
                pc.addTrack(newTrack, this.localStream!);
                renegotiate = true;
              }
              if (renegotiate && this.currentRoomId) {
                void this.createOfferForPeer(peerId).catch((error) => {
                  console.warn(`[WebRTC] Failed renegotiation with ${peerId}:`, error);
                });
              }
            }
          }
        }

        // Re-enable existing tracks that were disabled
        if (audio && hasAudio) {
          this.localStream.getAudioTracks().forEach(t => { t.enabled = true; });
        }
        if (video && hasVideo) {
          this.localStream.getVideoTracks().forEach(t => { t.enabled = true; });
        }

        return this.localStream;
      }

      // First-time: create fresh stream. Honour optional deviceIds so the
      // call site doesn't need a second getUserMedia (which re-prompts in
      // some browsers and always re-acquires the mic).
      const audioConstraint =
        audio && deviceIds?.audioInputId
          ? ({ deviceId: { exact: deviceIds.audioInputId } } as MediaTrackConstraints)
          : audio;
      const videoConstraint =
        video && deviceIds?.videoInputId
          ? ({ deviceId: { exact: deviceIds.videoInputId } } as MediaTrackConstraints)
          : video;
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoConstraint,
      });
      console.log('[WebRTC] Local stream started');

      // Add tracks to any existing connections
      for (const [peerId, pc] of this.connections) {
        let addedTrack = false;

        for (const track of this.localStream.getTracks()) {
          // Find the matching upfront transceiver (created in
          // createPeerConnection) and slot the track into its sender —
          // this avoids creating duplicate m-sections.
          const transceiver = pc.getTransceivers().find(
            t => !t.sender.track && (
              t.receiver.track?.kind === track.kind ||
              (t as RTCRtpTransceiver & { kind?: string }).kind === track.kind
            ),
          );
          if (transceiver) {
            await transceiver.sender.replaceTrack(track);
            // First-time slot fill — force renegotiation so the remote sees
            // the SSRC for this track and actually plays it back.
            addedTrack = true;
          } else {
            // Treat a sender carrying an ENDED track the same as an empty
            // sender — this is the warm re-entry case (left /brain → tracks
            // stopped → returned → fresh getUserMedia). Without this, the
            // dead-track reference made `existingSender.track` truthy, the
            // replace path was skipped, and peers never learned the new SSRC.
            const existingSender = pc.getSenders().find(s => s.track?.kind === track.kind);
            const senderTrackDead = existingSender?.track?.readyState === 'ended';
            if (existingSender && (!existingSender.track || senderTrackDead)) {
              await existingSender.replaceTrack(track);
              addedTrack = true;
            } else if (!existingSender) {
              pc.addTrack(track, this.localStream!);
              addedTrack = true;
            } else {
              // Live sender with a live track of the same kind — swap to the
              // newer track so callers always get the freshest input device.
              await existingSender.replaceTrack(track);
            }
          }
        }

        if (addedTrack && this.currentRoomId) {
          void this.createOfferForPeer(peerId).catch((error) => {
            console.warn(`[WebRTC] Failed renegotiation with ${peerId}:`, error);
          });
        }
      }

      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] Failed to get user media:', error);
      throw error;
    }
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

  /** True if there is at least one live (not ended) audio track on the local stream. */
  hasLiveAudioTrack(): boolean {
    return !!this.localStream?.getAudioTracks().some(t => t.readyState === 'live');
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      this.screenStream = screenStream;

      // Add screen tracks to all existing peer connections
      for (const [peerId, pc] of this.connections) {
        for (const track of screenStream.getTracks()) {
          pc.addTrack(track, screenStream);
        }
        if (this.currentRoomId) {
          void this.createOfferForPeer(peerId).catch((error) => {
            console.warn(`[WebRTC] Failed renegotiation for screen share with ${peerId}:`, error);
          });
        }
      }

      // Auto-stop when user clicks browser's "Stop sharing" button
      screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        this.stopScreenShare();
      });

      console.log('[WebRTC] Screen share started');
      return screenStream;
    } catch (error) {
      console.error('[WebRTC] Failed to start screen share:', error);
      throw error;
    }
  }

  stopScreenShare(): void {
    if (this.screenStream) {
      const trackIds = new Set(this.screenStream.getTracks().map(t => t.id));
      this.screenStream.getTracks().forEach(track => track.stop());

      // Remove screen-share senders from all peer connections
      for (const [, pc] of this.connections) {
        for (const sender of pc.getSenders()) {
          if (sender.track && trackIds.has(sender.track.id)) {
            pc.removeTrack(sender);
          }
        }
      }

      this.screenStream = null;
      console.log('[WebRTC] Screen share stopped');

      // Notify UI
      this.broadcastMessage({
        type: 'room-updated',
        roomId: this.currentRoomId ?? '',
        room: this.currentRoomId ? this.rooms.get(this.currentRoomId) ?? null : null,
      });
    }
  }

  getScreenStream(): MediaStream | null { return this.screenStream; }

  async createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    // Reuse existing connection if it's still alive
    const existing = this.connections.get(peerId);
    if (existing && existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
      return existing;
    }

    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    };

    const pc = new RTCPeerConnection(config);
    this.connections.set(peerId, pc);

    // Always create audio + video transceivers up front in `sendrecv`.
    // This guarantees the SDP advertises receive directions on BOTH sides
    // even when one peer's mic/camera hasn't been acquired yet — preventing
    // the asymmetric "I hear them but they can't hear me" bug that occurs
    // when an offer is sent with no `m=audio` section and the late-added
    // track never makes it into a renegotiation.
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });

    // Attach local camera/mic tracks if already available
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (audioTrack) {
        void audioTransceiver.sender.replaceTrack(audioTrack);
      }
      if (videoTrack) {
        void videoTransceiver.sender.replaceTrack(videoTrack);
      }
    }

    // Add screen share tracks (if active) so late-joiners see them
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        pc.addTrack(track, this.screenStream!);
      });
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      console.log('[WebRTC] 🎵 Received remote track from:', peerId, event.track.kind, 'streams:', event.streams.length);
      const participant = this.ensureParticipant(peerId, 'Peer');

      const incomingStream = event.streams[0];

      // Distinguish screen-share from camera/mic by **transceiver identity**,
      // not by stream-id heuristics. The third upfront transceiver (if present)
      // is the dedicated screen-share slot; anything arriving on it is the
      // screen track. Everything else is camera/mic and ALWAYS merges into the
      // single participant.stream.
      //
      // The previous heuristic (`incomingStream.id !== participant.stream.id
      // && kind === 'video'`) misclassified late-arriving camera video as a
      // screen share whenever audio arrived first in its own MediaStream —
      // producing the asymmetric "some hear, others don't" bug.
      const transceivers = pc.getTransceivers();
      const screenTransceiver = transceivers[2]; // index 2 = screen slot (audio,video,screen)
      const isScreenTrack = !!screenTransceiver
        && event.transceiver === screenTransceiver
        && event.track.kind === 'video';

      if (isScreenTrack) {
        participant.screenStream = incomingStream ?? new MediaStream([event.track]);
        console.log('[WebRTC] 🖥️ Screen share track received from', peerId);
      } else {
        // Camera / mic — always merge into the main participant stream,
        // regardless of which MediaStream container it arrived in.
        if (!participant.stream) {
          participant.stream = new MediaStream();
        }
        const existingTrack = participant.stream.getTracks().find(t => t.id === event.track.id);
        if (!existingTrack) {
          participant.stream.addTrack(event.track);
          console.log(`[WebRTC] ➕ Merged ${event.track.kind} track into participant stream for ${peerId}`);
        }
      }

      // Drop dead tracks instead of holding silent references.
      event.track.onended = () => {
        console.log(`[WebRTC] 🛑 Remote ${event.track.kind} track ended for ${peerId}`);
        if (participant.stream && participant.stream.getTracks().includes(event.track)) {
          participant.stream.removeTrack(event.track);
        }
      };

      // Notify UI of updated participant
      this.broadcastMessage({
        type: 'peer-joined',
        roomId: this.currentRoomId!,
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
      console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);

      if (pc.connectionState === 'connected') {
        console.log(`[WebRTC] ✅ Media connected with ${peerId}`);
        // Clear any pending recovery timers — connection is healthy
        this.clearDisconnectTimer(peerId);
        this.clearReconnectTimer(peerId);
        this.reconnectAttempts.delete(peerId);
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
    const attempts = this.reconnectAttempts.get(peerId) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
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
    console.log(`[WebRTC] 🔄 Recovery attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} for ${peerId}`);

    // Tear down stale connection
    this.removePeer(peerId);

    // Send reconnect-request via mesh signaling bridge
    if (this.currentRoomId) {
      sendReconnectRequest(peerId, this.currentRoomId, 'reconnect-request');
    }

    // If no ack within timeout, try again or give up
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peerId);
      const pc = this.connections.get(peerId);
      if (!pc || pc.connectionState !== 'connected') {
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
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
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
    this.negotiationRetryCount.delete(peerId);
  }

  async createOffer(peerId: string): Promise<void> {
    await this.createOfferForPeer(peerId);
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
    this.connections.forEach(pc => pc.close());
    this.connections.clear();
    this.pendingCandidates.clear();
    this.participants.clear();
    this.reconnectAttempts.clear();
    this.negotiationLock.clear();
    this.negotiationNeeded.clear();
    this.makingOffer.clear();
    this.negotiationRetryCount.clear();
  }

  private ensureParticipant(peerId: string, username: string): VideoParticipant {
    const existing = this.participants.get(peerId);
    if (existing) {
      return existing;
    }

    const participant: VideoParticipant = {
      peerId,
      username,
      stream: null,
      isMuted: false,
      isVideoEnabled: true,
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

  getLocalStream(): MediaStream | null { return this.localStream; }
  getParticipants(): VideoParticipant[] { return Array.from(this.participants.values()); }
  getRooms(): VideoRoom[] { return Array.from(this.rooms.values()); }

  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => { track.enabled = enabled; });
    }
  }

  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => { track.enabled = enabled; });
    }
  }

  destroy(): void {
    if (this.signalUnsub) {
      this.signalUnsub();
      this.signalUnsub = null;
    }
    this.leaveRoom();
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
