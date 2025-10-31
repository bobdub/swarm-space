import type { VideoRoom, VideoParticipant, WebRTCSignal, VideoRoomMessage } from './types';

export class WebRTCManager {
  private rooms = new Map<string, VideoRoom>();
  private connections = new Map<string, RTCPeerConnection>();
  private participants = new Map<string, VideoParticipant>();
  private localStream: MediaStream | null = null;
  private currentRoomId: string | null = null;
  private messageHandlers = new Set<(message: VideoRoomMessage) => void>();
  private userId: string;
  private username: string;

  constructor(userId: string, username: string) {
    this.userId = userId;
    this.username = username;
  }

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

    this.broadcastMessage({
      type: 'room-created',
      roomId: room.id,
      room,
    });

    console.log('[WebRTC] Room created:', room);
    return room;
  }

  async joinRoom(roomId: string): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error('[WebRTC] Room not found:', roomId);
      return false;
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

    this.stopLocalStream();
    this.closeAllConnections();
    this.currentRoomId = null;
  }

  async startLocalStream(audio: boolean = true, video: boolean = true): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
      console.log('[WebRTC] Local stream started');
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
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    const pc = new RTCPeerConnection(config);
    this.connections.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.ontrack = (event) => {
      console.log('[WebRTC] Received remote track from:', peerId);
      const participant = this.participants.get(peerId);
      if (participant) {
        participant.stream = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'candidate',
          from: this.userId,
          to: peerId,
          data: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.removePeer(peerId);
      }
    };

    return pc;
  }

  async createOffer(peerId: string): Promise<void> {
    const pc = await this.createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignal({
      type: 'offer',
      from: this.userId,
      to: peerId,
      data: offer,
    });
  }

  async handleSignal(signal: WebRTCSignal): Promise<void> {
    const { type, from, data } = signal;

    if (type === 'offer') {
      const pc = await this.createPeerConnection(from);
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendSignal({
        type: 'answer',
        from: this.userId,
        to: from,
        data: answer,
      });
    } else if (type === 'answer') {
      const pc = this.connections.get(from);
      if (pc) {
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      }
    } else if (type === 'candidate') {
      const pc = this.connections.get(from);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(data as RTCIceCandidateInit));
      }
    }
  }

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

    this.broadcastMessage({
      type: 'stream-started',
      roomId: this.currentRoomId,
      room,
    });

    console.log('[WebRTC] Streaming started, post ID:', postId);
    return { id: postId, roomId: this.currentRoomId };
  }

  async stopStreaming(): Promise<void> {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room) return;

    room.isStreaming = false;
    room.streamPostId = undefined;

    this.broadcastMessage({
      type: 'stream-stopped',
      roomId: this.currentRoomId,
      room,
    });

    console.log('[WebRTC] Streaming stopped');
  }

  mutePeer(peerId: string): void {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;

    if (!room.mutedPeers.includes(peerId)) {
      room.mutedPeers.push(peerId);
    }

    this.broadcastMessage({
      type: 'peer-muted',
      roomId: this.currentRoomId,
      peerId,
    });
  }

  banPeer(peerId: string): void {
    if (!this.currentRoomId) return;

    const room = this.rooms.get(this.currentRoomId);
    if (!room || room.hostId !== this.userId) return;

    if (!room.bannedPeers.includes(peerId)) {
      room.bannedPeers.push(peerId);
    }

    room.participants = room.participants.filter(p => p !== peerId);

    this.broadcastMessage({
      type: 'peer-banned',
      roomId: this.currentRoomId,
      peerId,
    });

    this.removePeer(peerId);
  }

  private removePeer(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.participants.delete(peerId);
  }

  private closeAllConnections(): void {
    this.connections.forEach(pc => pc.close());
    this.connections.clear();
    this.participants.clear();
  }

  private sendSignal(signal: WebRTCSignal): void {
    // This should be sent via P2P network
    console.log('[WebRTC] Sending signal:', signal);
    // TODO: Integrate with P2P manager to send signals
  }

  private broadcastMessage(message: VideoRoomMessage): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('[WebRTC] Message handler error:', error);
      }
    });
  }

  onMessage(handler: (message: VideoRoomMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  getCurrentRoom(): VideoRoom | null {
    if (!this.currentRoomId) return null;
    return this.rooms.get(this.currentRoomId) || null;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getParticipants(): VideoParticipant[] {
    return Array.from(this.participants.values());
  }

  getRooms(): VideoRoom[] {
    return Array.from(this.rooms.values());
  }

  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  destroy(): void {
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
