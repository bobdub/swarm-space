import { useEffect, useState, useCallback } from 'react';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import type { VideoRoom, VideoParticipant } from '@/lib/webrtc/types';
import { useAuth } from './useAuth';

export function useWebRTC() {
  const { user } = useAuth();
  const [currentRoom, setCurrentRoom] = useState<VideoRoom | null>(null);
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const manager = user ? getWebRTCManager(user.id, user.username) : null;

  useEffect(() => {
    if (!manager) return;

    const unsubscribe = manager.onMessage((message) => {
      console.log('[useWebRTC] Received message:', message);
      
      if (message.type === 'room-updated' || message.type === 'room-created') {
        if (message.room && message.room.id === currentRoom?.id) {
          setCurrentRoom(message.room);
        }
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
  }, [manager]);

  const startLocalStream = useCallback(async (audio: boolean = true, video: boolean = true) => {
    if (!manager) return null;
    
    try {
      const stream = await manager.startLocalStream(audio, video);
      setLocalStream(stream);
      setIsAudioEnabled(audio);
      setIsVideoEnabled(video);
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

  const startStreaming = useCallback(async (projectId?: string) => {
    if (!manager) return null;
    return await manager.startStreaming(projectId);
  }, [manager]);

  const pauseStreaming = useCallback(async () => {
    if (!manager) return;
    await manager.pauseStreaming();
  }, [manager]);

  const resumeStreaming = useCallback(async () => {
    if (!manager) return;
    await manager.resumeStreaming();
  }, [manager]);

  const stopStreaming = useCallback(async () => {
    if (!manager) return;
    await manager.stopStreaming();
  }, [manager]);

  const endStreaming = useCallback(async () => {
    if (!manager) return;
    await manager.endStreaming();
  }, [manager]);

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
    isAudioEnabled,
    isVideoEnabled,
    createRoom,
    joinRoom,
    leaveRoom,
    startLocalStream,
    stopLocalStream,
    toggleAudio,
    toggleVideo,
    startStreaming,
    pauseStreaming,
    resumeStreaming,
    stopStreaming,
    endStreaming,
    mutePeer,
    banPeer,
  };
}
