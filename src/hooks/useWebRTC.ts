import { useEffect, useState, useCallback } from 'react';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import type { VideoRoom, VideoParticipant } from '@/lib/webrtc/types';
import { useAuth } from './useAuth';

export function useWebRTC() {
  const { user } = useAuth();
  const [currentRoom, setCurrentRoom] = useState<VideoRoom | null>(null);
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const manager = user ? getWebRTCManager(user.id, user.username) : null;

  useEffect(() => {
    if (!manager) return;

    const unsubscribe = manager.onMessage((message) => {
      console.log('[useWebRTC] Received message:', message);
      
      if (message.type === 'room-updated' || message.type === 'room-created') {
        if (message.room && message.room.id === currentRoom?.id) {
          setCurrentRoom(message.room);
        }
        // Check if screen share was stopped externally
        setScreenStream(manager.getScreenStream());
        setIsScreenSharing(Boolean(manager.getScreenStream()));
      } else if (message.type === 'peer-joined' || message.type === 'peer-left') {
        setParticipants(manager.getParticipants());
      }
    });

    return () => {
      unsubscribe();
    };
  }, [manager, currentRoom]);

  const createRoom = useCallback(async (options: {
    name: string;
    projectId?: string;
    isPrivate?: boolean;
    allowedPeers?: string[];
  }) => {
    if (!manager) return null;
    
    const room = await manager.createRoom(options);
    setCurrentRoom(room);
    return room;
  }, [manager]);

  const joinRoom = useCallback(async (roomId: string) => {
    if (!manager) return false;
    
    const success = await manager.joinRoom(roomId);
    if (success) {
      setCurrentRoom(manager.getCurrentRoom());
      setParticipants(manager.getParticipants());
    }
    return success;
  }, [manager]);

  const leaveRoom = useCallback(async () => {
    if (!manager) return;
    
    await manager.leaveRoom();
    setCurrentRoom(null);
    setParticipants([]);
    setLocalStream(null);
    setScreenStream(null);
    setIsScreenSharing(false);
  }, [manager]);

  const startLocalStream = useCallback(async (audio: boolean = true, video: boolean = true) => {
    if (!manager) return null;
    
    try {
      const stream = await manager.startLocalStream(audio, video);
      setLocalStream(stream);
      if (audio) setIsAudioEnabled(true);
      if (video) setIsVideoEnabled(true);
      return stream;
    } catch (error) {
      console.error('[useWebRTC] Failed to start local stream:', error);
      return null;
    }
  }, [manager]);

  const stopLocalStream = useCallback(() => {
    if (!manager) return;
    
    manager.stopLocalStream();
    setLocalStream(null);
  }, [manager]);

  const startScreenShare = useCallback(async () => {
    if (!manager) return null;

    try {
      const stream = await manager.startScreenShare();
      setScreenStream(stream);
      setIsScreenSharing(true);

      // Listen for browser-level stop (user clicks "Stop sharing")
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setScreenStream(null);
        setIsScreenSharing(false);
      });

      return stream;
    } catch (error) {
      console.error('[useWebRTC] Failed to start screen share:', error);
      return null;
    }
  }, [manager]);

  const stopScreenShare = useCallback(() => {
    if (!manager) return;

    manager.stopScreenShare();
    setScreenStream(null);
    setIsScreenSharing(false);
  }, [manager]);

  const toggleAudio = useCallback(() => {
    if (!manager) return;
    
    const newState = !isAudioEnabled;
    manager.toggleAudio(newState);
    setIsAudioEnabled(newState);
  }, [manager, isAudioEnabled]);

  const toggleVideo = useCallback(() => {
    if (!manager) return;
    
    const newState = !isVideoEnabled;
    manager.toggleVideo(newState);
    setIsVideoEnabled(newState);
  }, [manager, isVideoEnabled]);

  const mutePeer = useCallback((peerId: string) => {
    if (!manager) return;
    manager.mutePeer(peerId);
  }, [manager]);

  const banPeer = useCallback((peerId: string) => {
    if (!manager) return;
    manager.banPeer(peerId);
  }, [manager]);

  return {
    currentRoom,
    participants,
    localStream,
    screenStream,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    createRoom,
    joinRoom,
    leaveRoom,
    startLocalStream,
    stopLocalStream,
    startScreenShare,
    stopScreenShare,
    toggleAudio,
    toggleVideo,
    mutePeer,
    banPeer,
  };
}
