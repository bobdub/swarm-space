import type { VideoRoom, VideoParticipant, WebRTCSignal, VideoRoomMessage } from './types';
import {
  sendSignalViaMesh,
  announceJoinRoom,
  announceLeaveRoom,
  onSignal,
  getLocalMeshPeerId,
  isBridgeActive,
} from '@/lib/streaming/webrtcSignalingBridge.standalone';

export class WebRTCManager {
  private rooms = new Map<string, VideoRoom>();
  private connections = new Map<string, RTCPeerConnection>();
  private participants = new Map<string, VideoParticipant>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private currentRoomId: string | null = null;
  private messageHandlers = new Set<(message: VideoRoomMessage) => void>();
  private userId: string;
  private username: string;
  private signalUnsub: (() => void) | null = null;

  constructor(userId: string, username: string) {
    this.userId = userId;
    this.username = username;
    this.setupSignalListener();
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
          // We received the list of participants already in the room
          const participants = envelope.participants ?? [];
          console.log(`[WebRTC] Room sync: ${participants.length} participants`);
          // The existing participants will send us offers, we just register them
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
          this.removePeer(meshPeerId);
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
      }
    });
  }

  // ── WebRTC Negotiation ─────────────────────────────────────────────

  private async createOfferForPeer(meshPeerId: string): Promise<void> {
    if (!this.currentRoomId) return;

    const pc = await this.createPeerConnection(meshPeerId);

    if (pc.signalingState !== 'stable') {
      console.log(`[WebRTC] Skipping offer for ${meshPeerId}; signalingState=${pc.signalingState}`);
      return;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendSignalViaMesh(meshPeerId, this.currentRoomId, 'offer', offer);
    console.log(`[WebRTC] 📤 Sent offer to ${meshPeerId}`);
  }

  private async handleRemoteOffer(meshPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[WebRTC] 📥 Received offer from ${meshPeerId}`);
    const pc = await this.createPeerConnection(meshPeerId);
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

    // Announce to mesh that we've created/joined this room
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
    // For remote peers joining, create the room entry if it doesn't exist locally
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
        isStreaming: true,
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

    // Announce join via mesh — existing peers will send us WebRTC offers
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

    // Announce leave via mesh
    announceLeaveRoom(this.currentRoomId);

    this.stopLocalStream();
    this.closeAllConnections();
    this.currentRoomId = null;
  }

  // ── Media ──────────────────────────────────────────────────────────

  async startLocalStream(audio: boolean = true, video: boolean = true): Promise<MediaStream> {
    try {
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

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      console.log('[WebRTC] 🎵 Received remote track from:', peerId, event.track.kind);
      const participant = this.ensureParticipant(peerId, 'Peer');
      participant.stream = event.streams[0] ?? new MediaStream([event.track]);
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

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'connected') {
        console.log(`[WebRTC] ✅ Media connected with ${peerId}`);
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.removePeer(peerId);
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

  // ── Streaming Controls ─────────────────────────────────────────────

  async startStreaming(projectId?: string): Promise<{ id: string; roomId: string } | null> {
    if (!this.currentRoomId) return null;

    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) {
      console.error('[WebRTC] Only host can start streaming');
      return null;
    }

    const postId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    room.isStreaming = true;
    room.streamPostId = postId;

    this.broadcastMessage({ type: 'stream-started', roomId: this.currentRoomId, room });
    console.log('[WebRTC] Streaming started, post ID:', postId);
    return { id: postId, roomId: this.currentRoomId };
  }

  async pauseStreaming(): Promise<void> {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;
    this.broadcastMessage({ type: 'stream-paused', roomId: this.currentRoomId, room });
  }

  async resumeStreaming(): Promise<void> {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;
    this.broadcastMessage({ type: 'stream-resumed', roomId: this.currentRoomId, room });
  }

  async stopStreaming(): Promise<void> {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;
    room.isStreaming = false;
    room.streamPostId = undefined;
    this.broadcastMessage({ type: 'stream-stopped', roomId: this.currentRoomId, room });
  }

  async endStreaming(): Promise<void> {
    if (!this.currentRoomId) return;
    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;
    room.isStreaming = false;
    room.streamPostId = undefined;
    this.broadcastMessage({ type: 'stream-ended', roomId: this.currentRoomId, room });
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
    this.removePeer(peerId);
  }

  // ── Internal Helpers ───────────────────────────────────────────────

  private removePeer(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.pendingCandidates.delete(peerId);
    this.participants.delete(peerId);
  }

  private closeAllConnections(): void {
    this.connections.forEach(pc => pc.close());
    this.connections.clear();
    this.pendingCandidates.clear();
    this.participants.clear();
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
