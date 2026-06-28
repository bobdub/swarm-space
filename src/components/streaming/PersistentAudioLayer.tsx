/**
 * PersistentAudioLayer — always-mounted hidden <audio> elements for every
 * remote participant on the WebRTC manager. Reads the participant list
 * directly from the manager (not from `useWebRTC`) so audio is correct
 * even when no React tree has explicitly called `joinRoom` from a hook.
 *
 * Mount ONCE at the app root. The `roomId` prop is informational only;
 * the manager has a single current room so we render every participant
 * it knows about.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getWebRTCManager } from "@/lib/webrtc/manager";
import type { VideoParticipant } from "@/lib/webrtc/types";

export function PersistentAudioLayer({ roomId }: { roomId?: string }) {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);

  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const sync = () => setParticipants(manager.getParticipants());
    sync();
    const unsubscribe = manager.onMessage(() => sync());
    const poll = window.setInterval(sync, 1500);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [user]);

  if (!user) return null;
  void roomId;

  return (
    <div aria-hidden className="sr-only">
      {participants.map((p) =>
        p.stream ? (
          <audio
            key={`persistent-audio-${p.peerId}`}
            autoPlay
            playsInline
            ref={(el) => {
              if (!el || !p.stream) return;
              if (el.srcObject !== p.stream) {
                el.srcObject = p.stream;
              }
              void el.play().catch(() => {});
            }}
          />
        ) : null,
      )}
    </div>
  );
}
