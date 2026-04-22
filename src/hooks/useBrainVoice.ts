import { useCallback, useEffect, useRef, useState } from "react";
import { getWebRTCManager } from "@/lib/webrtc/manager";
import type { VideoParticipant } from "@/lib/webrtc/types";
import { useAuth } from "./useAuth";
import { loadHubPrefs } from "@/lib/virtualHub/avatars";
import {
  sendRoomChatMessage,
  onRoomChatMessage,
  type RoomChatMessage,
} from "@/lib/streaming/webrtcSignalingBridge.standalone";

/** Fixed shared room so every visitor to /brain hears every other visitor. */
export const BRAIN_ROOM_ID = "brain-universe-shared";

/**
 * P2P voice chat for the Brain. Reuses the existing WebRTCManager exactly
 * the same way streaming rooms do — `BRAIN_ROOM_ID` is just another room.
 * Audio rendering is handled by `<PersistentAudioLayer roomId={BRAIN_ROOM_ID} />`.
 */
export function useBrainVoice(enabled: boolean) {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !user) return;
    const manager = getWebRTCManager(user.id, user.username);
    let cancelled = false;

    const unsub = manager.onMessage((msg) => {
      if (msg.type === "peer-joined" || msg.type === "peer-left") {
        setParticipants(manager.getParticipants());
      }
    });

    void (async () => {
      try {
        const prefs = loadHubPrefs();
        // Audio-only stream from prefs mic.
        await manager.startLocalStream(true, false).catch(() => null);
        if (prefs.audioInputId) {
          // Best-effort: replace track with the chosen mic.
          try {
            const fresh = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: prefs.audioInputId } },
              video: false,
            });
            const local = manager.getLocalStream?.();
            const newTrack = fresh.getAudioTracks()[0];
            if (local && newTrack) {
              local.getAudioTracks().forEach((t) => t.stop());
              local.removeTrack(local.getAudioTracks()[0]);
              local.addTrack(newTrack);
            }
          } catch { /* fall back to default mic */ }
        }
        const ok = await manager.joinRoom(BRAIN_ROOM_ID);
        if (!cancelled && ok) {
          joinedRef.current = true;
          setJoined(true);
          setParticipants(manager.getParticipants());
        }
      } catch (err) {
        console.warn("[BrainVoice] join failed", err);
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      if (joinedRef.current) {
        joinedRef.current = false;
        try { void manager.leaveRoom(); } catch { /* ignore */ }
        try { manager.stopLocalStream(); } catch { /* ignore */ }
      }
      setJoined(false);
      setParticipants([]);
    };
  }, [enabled, user]);

  const toggleMute = useCallback(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const next = !isMuted;
    manager.toggleAudio(!next); // toggleAudio(enabled): muted means disabled
    setIsMuted(next);
  }, [isMuted, user]);

  /** Broadcast a chat line to every peer in the Brain room over the mesh. */
  const sendChatLine = useCallback(
    (text: string, lineId: string) => {
      if (!user) return;
      try {
        sendRoomChatMessage(
          BRAIN_ROOM_ID,
          // Tag the line id into the text via a sentinel so we can dedup
          // remote echoes against our local id.
          `${lineId}\u0001${text}`,
          user.id,
          user.username,
        );
      } catch (err) {
        console.warn("[BrainVoice] chat broadcast failed", err);
      }
    },
    [user],
  );

  /** Subscribe to remote chat lines on the Brain room. */
  const onChatLine = useCallback(
    (
      handler: (line: {
        id: string;
        author: string;
        text: string;
        ts: number;
        peerId: string;
      }) => void,
    ) => {
      return onRoomChatMessage((msg: RoomChatMessage) => {
        if (msg.roomId !== BRAIN_ROOM_ID) return;
        // Drop our own echoes — bridge already appends locally.
        if (user && msg.senderUserId === user.id) return;
        const sep = msg.text.indexOf("\u0001");
        const id = sep > 0 ? msg.text.slice(0, sep) : msg.id;
        const text = sep > 0 ? msg.text.slice(sep + 1) : msg.text;
        handler({
          id,
          author: msg.senderUsername || msg.senderPeerId.slice(0, 8),
          text,
          ts: msg.ts,
          peerId: msg.senderPeerId,
        });
      });
    },
    [user],
  );

  return { participants, isMuted, toggleMute, joined, sendChatLine, onChatLine };
}