import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import type { VideoParticipant } from '@/lib/webrtc/types';
import {
  getRoomChatMessages,
  helloRoom,
  onRoomChatMessage,
  sendRoomChatMessage,
  type RoomChatMessage,
} from '@/lib/streaming/webrtcSignalingBridge.standalone';

export interface LiveRoomChatLine {
  id: string;
  author: string;
  text: string;
  ts: number;
  peerId: string;
}

function hasLiveEnabledTrack(stream: MediaStream | null | undefined, kind: 'audio' | 'video'): boolean {
  if (!stream) return false;
  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.some((track) => track.readyState === 'live' && track.enabled);
}

function unpackChatText(text: string): string {
  return text.includes('\u0001') ? text.split('\u0001').slice(1).join('\u0001') : text;
}

function toChatLine(message: RoomChatMessage): LiveRoomChatLine {
  return {
    id: message.id,
    author: message.senderUsername || message.senderPeerId.slice(0, 8),
    text: unpackChatText(message.text),
    ts: message.ts,
    peerId: message.senderPeerId,
  };
}

/**
 * Passive live-room media binding for feed/dock live shows.
 *
 * This intentionally does NOT request mic/camera on mount. Viewers join the
 * WebRTC room as receive-only spectators so they can hear/see the show from
 * the post or floating dock; mic/camera are acquired only after an explicit
 * control click. The Brain room hook keeps its old behavior untouched.
 */
export function useLiveRoomMedia(roomId: string, enabled = true) {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const joinedRef = useRef(false);

  const refresh = useCallback(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const stream = manager.getLocalStream?.() ?? null;
    setParticipants(manager.getParticipants());
    setLocalStream(stream);
    setMicOn(hasLiveEnabledTrack(stream, 'audio'));
    setCameraOn(hasLiveEnabledTrack(stream, 'video'));
  }, [user]);

  useEffect(() => {
    if (!enabled || !user || !roomId) return;
    const manager = getWebRTCManager(user.id, user.username);
    let cancelled = false;

    void manager.joinRoom(roomId).then((ok) => {
      if (cancelled) return;
      joinedRef.current = Boolean(ok);
      setConnected(Boolean(ok));
      refresh();
      try { helloRoom(roomId); } catch { /* ignore */ }
      window.setTimeout(() => {
        if (!cancelled && joinedRef.current) {
          try { helloRoom(roomId); } catch { /* ignore */ }
        }
      }, 1200);
      window.setTimeout(() => {
        if (!cancelled && joinedRef.current) {
          try { helloRoom(roomId); } catch { /* ignore */ }
        }
      }, 3500);
    }).catch((error) => {
      console.warn('[useLiveRoomMedia] passive join failed', error);
      if (!cancelled) setConnected(false);
    });

    const unsubscribe = manager.onMessage((message) => {
      if (message.roomId && message.roomId !== roomId) return;
      refresh();
    });
    const poll = window.setInterval(refresh, 1200);
    const repair = window.setInterval(() => manager.sweepHalfOpenConnections(), 4500);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(poll);
      window.clearInterval(repair);
      // Do not leave the WebRTC room here: the same live room can be mounted
      // in both the inline post and the floating dock. Explicit Leave/End
      // controls own teardown so docking/reopening cannot kill A/V.
    };
  }, [enabled, refresh, roomId, user]);

  const toggleMic = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (micOn) {
      manager.toggleAudio(false);
      refresh();
      return;
    }
    const stream = await manager.startLocalStream(true, cameraOn).catch((error) => {
      console.warn('[useLiveRoomMedia] mic request denied', error);
      return null;
    });
    if (stream) {
      manager.toggleAudio(true);
      refresh();
    }
  }, [cameraOn, micOn, refresh, user]);

  const toggleCamera = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (cameraOn) {
      manager.toggleVideo(false);
      refresh();
      return;
    }
    const stream = await manager.startLocalStream(micOn, true).catch((error) => {
      console.warn('[useLiveRoomMedia] camera request denied', error);
      return null;
    });
    if (stream) {
      manager.toggleVideo(true);
      refresh();
    }
  }, [cameraOn, micOn, refresh, user]);

  const sendChatLine = useCallback((text: string, lineId: string) => {
    if (!user) return;
    sendRoomChatMessage(roomId, `${lineId}\u0001${text}`, user.id, user.username);
  }, [roomId, user]);

  const onChatLine = useCallback((handler: (line: LiveRoomChatLine) => void) => {
    return onRoomChatMessage((message) => {
      if (message.roomId !== roomId) return;
      if (user && message.senderUserId === user.id) return;
      handler(toChatLine(message));
    });
  }, [roomId, user]);

  const getRecentChatLines = useCallback((): LiveRoomChatLine[] => {
    try {
      return getRoomChatMessages(roomId).map(toChatLine);
    } catch {
      return [];
    }
  }, [roomId]);

  return {
    participants,
    localStream,
    connected,
    micOn,
    cameraOn,
    toggleMic,
    toggleCamera,
    sendChatLine,
    onChatLine,
    getRecentChatLines,
  };
}

export default useLiveRoomMedia;