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
  private negotiationQueue = new Map<string, boolean>();
  /** true = we are "polite" toward this peer (will rollback on glare) */
  private makingOffer = new Map<string, boolean>();

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
      this.negotiationQueue.set(meshPeerId, true);
      console.log(`[WebRTC] Queued negotiation for ${meshPeerId}`);
      return;
    }

    this.negotiationLock.set(meshPeerId, true);
    this.makingOffer.set(meshPeerId, true);

    try {
      const pc = await this.createPeerConnection(meshPeerId);

      if (pc.signalingState !== 'stable') {
        console.log(`[WebRTC] Skipping offer for ${meshPeerId}; signalingState=${pc.signalingState}`);
        return;
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignalViaMesh(meshPeerId, this.currentRoomId, 'offer', offer);
      console.log(`[WebRTC] 📤 Sent offer to ${meshPeerId}`);
    } finally {
      this.makingOffer.set(meshPeerId, false);
      this.negotiationLock.set(meshPeerId, false);

      // Drain queued negotiation
      if (this.negotiationQueue.get(meshPeerId)) {
        this.negotiationQueue.delete(meshPeerId);
        void this.createOfferForPeer(meshPeerId);
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
        // Impolite peer ignores the incoming offer during glare
        console.log(`[WebRTC] ⚡ Glare detected with ${meshPeerId} — ignoring (impolite)`);
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
    if (pc) {
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

  async startLocalStream(audio: boolean = true, video: boolean = true): Promise<MediaStream> {
    try {
      // If we already have a stream, only request the missing track kind
      if (this.localStream) {
        const hasAudio = this.localStream.getAudioTracks().length > 0;
        const hasVideo = this.localStream.getVideoTracks().length > 0;

        const needAudio = audio && !hasAudio;
        const needVideo = video && !hasVideo;

        if (needAudio || needVideo) {
          const constraints: MediaStreamConstraints = {
            audio: needAudio,
            video: needVideo,
          };
          const extraStream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('[WebRTC] Adding incremental tracks:', { needAudio, needVideo });

          for (const newTrack of extraStream.getTracks()) {
            this.localStream.addTrack(newTrack);

            // Update senders on every existing peer connection
            for (const [peerId, pc] of this.connections) {
              const existingSender = pc.getSenders().find(s => s.track?.kind === newTrack.kind);
              if (existingSender) {
                await existingSender.replaceTrack(newTrack);
              } else {
                pc.addTrack(newTrack, this.localStream!);
              }
              // Renegotiate so the remote peer picks up the new track
              if (this.currentRoomId) {
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

      // First-time: create fresh stream
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
      console.log('[WebRTC] Local stream started');

      // Add tracks to any existing connections
      for (const [peerId, pc] of this.connections) {
        const existingSenders = pc.getSenders();
        let addedTrack = false;

        this.localStream.getTracks().forEach(track => {
          const hasSender = existingSenders.some(s => s.track?.kind === track.kind);
          if (!hasSender) {
            pc.addTrack(track, this.localStream!);
            addedTrack = true;
          }
        });

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

    // Add local camera/mic tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
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

      // Determine if this is a screen-share stream (separate from camera)
      // Screen shares arrive as a distinct MediaStream
      const isScreenTrack = incomingStream && participant.stream && incomingStream.id !== participant.stream.id
        && event.track.kind === 'video';

      if (isScreenTrack) {
        // Store as screen stream on the participant
        participant.screenStream = incomingStream;
        console.log('[WebRTC] 🖥️ Screen share track received from', peerId);
      } else {
        // Camera / mic track — merge into the main participant stream
        if (!participant.stream) {
          participant.stream = incomingStream ?? new MediaStream([event.track]);
        } else {
          const existingTrack = participant.stream.getTracks().find(t => t.id === event.track.id);
          if (!existingTrack) {
            participant.stream.addTrack(event.track);
          }
        }
      }

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

    const queuedCandidates = this.pendingCandidates.get(peerId) ?? [];
    if (queuedCandidates.length > 0) {
      queuedCandidates.forEach((candidate) => {
        void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
          console.warn(`[WebRTC] Failed to apply queued ICE candidate for ${peerId}:`, error);
        });
      });
      this.pendingCandidates.delete(peerId);
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
    this.negotiationQueue.delete(peerId);
    this.makingOffer.delete(peerId);
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
    this.negotiationQueue.clear();
    this.makingOffer.clear();
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
