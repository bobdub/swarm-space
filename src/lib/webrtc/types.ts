export interface VideoRoom {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  projectId?: string;
  isPrivate: boolean;
  allowedPeers?: string[];
  mutedPeers: string[];
  bannedPeers: string[];
  isStreaming: boolean;
  streamPostId?: string;
  createdAt: string;
  participants: string[];
}

export interface VideoParticipant {
  peerId: string;
  username: string;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  joinedAt: string;
}

export interface WebRTCSignal {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  to: string;
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export interface VideoRoomMessage {
  type: 'room-created' | 'room-updated' | 'peer-joined' | 'peer-left' | 'peer-muted' | 'peer-unmuted' | 'peer-banned' | 'stream-started' | 'stream-stopped' | 'stream-paused' | 'stream-resumed' | 'stream-ended';
  roomId: string;
  room?: VideoRoom;
  peerId?: string;
  username?: string;
}
