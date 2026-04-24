import { useCallback, useEffect, useRef, useState } from "react";
import { getWebRTCManager } from "@/lib/webrtc/manager";
import type { VideoParticipant } from "@/lib/webrtc/types";
import { useAuth } from "./useAuth";
import { loadHubPrefs } from "@/lib/virtualHub/avatars";
import {
  sendRoomChatMessage,
  onRoomChatMessage,
  sendRoomPresence,
  onRoomPresence,
  getRoomPresences,
  type RoomPresence,
  type RoomChatMessage,
} from "@/lib/streaming/webrtcSignalingBridge.standalone";
import { BRAIN_PHYSICS_VERSION } from "@/lib/brain/brainPersistence";

/** Default shared room so every visitor to /brain hears every other visitor.
 *  Project universes pass their own room id, e.g. `brain-project-${id}`. */
export const BRAIN_ROOM_ID = "brain-universe-shared";

/** Voice participant enriched with the chosen avatar id from presence broadcasts. */
export interface BrainVoicePeer {
  peerId: string;
  username: string;
  avatarId?: string;
  color?: string;
  /** Last broadcast world-space position, if the peer published one. */
  position?: [number, number, number];
  /** Brain physics protocol version reported by the peer (undefined = pre-versioning / v0). */
  pv?: number;
}

/**
 * P2P voice chat for the Brain. Reuses the existing WebRTCManager exactly
 * the same way streaming rooms do — `BRAIN_ROOM_ID` is just another room.
 * Audio rendering is handled by `<PersistentAudioLayer roomId={BRAIN_ROOM_ID} />`.
 */
export function useBrainVoice(enabled: boolean, roomId: string = BRAIN_ROOM_ID) {
  const { user } = useAuth();
  const [rawParticipants, setRawParticipants] = useState<VideoParticipant[]>([]);
  const [presenceById, setPresenceById] = useState<Record<string, RoomPresence>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  const lastSelfPosRef = useRef<[number, number, number] | undefined>(undefined);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    if (!enabled || !user) return;
    const manager = getWebRTCManager(user.id, user.username);
    let cancelled = false;
    const prefs = (() => { try { return loadHubPrefs(); } catch { return null; } })();
    const localAvatarId = prefs?.avatarId;

    const broadcastSelfPresence = () => {
      try {
        sendRoomPresence(roomId, {
          userId: user.id,
          username: user.username,
          avatarId: localAvatarId,
          position: lastSelfPosRef.current,
          pv: BRAIN_PHYSICS_VERSION,
        });
      } catch (err) {
        console.warn("[BrainVoice] presence broadcast failed", err);
      }
    };

    const unsub = manager.onMessage((msg) => {
      if (msg.type === "peer-joined" || msg.type === "peer-left") {
        setRawParticipants(manager.getParticipants());
        // Re-broadcast our presence so late joiners (and reconnects) learn
        // our avatar selection right away.
        if (msg.type === "peer-joined" && joinedRef.current) {
          broadcastSelfPresence();
        }
      }
    });

    // Subscribe to remote presence updates.
    const unsubPresence = onRoomPresence((p) => {
      if (p.roomId !== roomId) return;
      setPresenceById((prev) => ({ ...prev, [p.peerId]: p }));
    });
    // Hydrate from any presence already cached.
    try {
      const initial = getRoomPresences(roomId);
      if (initial.length > 0) {
        setPresenceById((prev) => {
          const next = { ...prev };
          for (const p of initial) next[p.peerId] = p;
          return next;
        });
      }
    } catch { /* ignore */ }

    void (async () => {
      try {
        // Audio-only stream from the prefs mic. Single getUserMedia call —
        // avoids the second prompt some browsers (Brave/Firefox/Safari)
        // raise when a deviceId-constrained stream is requested separately.
        await manager
          .startLocalStream(true, false, { audioInputId: prefs?.audioInputId })
          .catch(() => null);
        const ok = await manager.joinRoom(roomId);
        if (!cancelled && ok) {
          joinedRef.current = true;
          setJoined(true);
          setRawParticipants(manager.getParticipants());
          // Announce avatar selection to the room.
          broadcastSelfPresence();
        }
      } catch (err) {
        console.warn("[BrainVoice] join failed", err);
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      unsubPresence();
      if (joinedRef.current) {
        joinedRef.current = false;
        try { void manager.leaveRoom(); } catch { /* ignore */ }
        try { manager.stopLocalStream(); } catch { /* ignore */ }
      }
      setJoined(false);
      setRawParticipants([]);
      setPresenceById({});
    };
  }, [enabled, user, roomId]);

  // Merge raw WebRTC participants with presence data so callers get
  // { peerId, username, avatarId } in one shape.
  const participants: BrainVoicePeer[] = rawParticipants.map((p) => {
    const pres = presenceById[p.peerId];
    return {
      peerId: p.peerId,
      username: pres?.username || p.username || p.peerId.slice(0, 8),
      avatarId: pres?.avatarId,
      color: pres?.color,
      position: pres?.position,
      pv: pres?.pv,
    };
  });

  const toggleMute = useCallback(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const next = !isMuted;
    manager.toggleAudio(!next); // toggleAudio(enabled): muted means disabled
    setIsMuted(next);
  }, [isMuted, user]);

  /**
   * Push the local avatar's world-space position into the next presence
   * broadcast. Call from a low-frequency throttled tick (e.g. every 1.5 s)
   * — every call performs a mesh broadcast, so do not call per-frame.
   */
  const broadcastSelfPosition = useCallback(
    (position: [number, number, number]) => {
      lastSelfPosRef.current = position;
      const u = userRef.current;
      if (!u || !joinedRef.current) return;
      try {
        const prefs = (() => { try { return loadHubPrefs(); } catch { return null; } })();
        sendRoomPresence(roomId, {
          userId: u.id,
          username: u.username,
          avatarId: prefs?.avatarId,
          position,
          pv: BRAIN_PHYSICS_VERSION,
        });
      } catch (err) {
        console.warn("[BrainVoice] position broadcast failed", err);
      }
    },
    [roomId],
  );

  /** Broadcast a chat line to every peer in the Brain room over the mesh. */
  const sendChatLine = useCallback(
    (text: string, lineId: string) => {
      if (!user) return;
      try {
        sendRoomChatMessage(
          roomId,
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
    [user, roomId],
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
        if (msg.roomId !== roomId) return;
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
    [user, roomId],
  );

  return {
    participants,
    isMuted,
    toggleMute,
    joined,
    sendChatLine,
    onChatLine,
    broadcastSelfPosition,
  };
}