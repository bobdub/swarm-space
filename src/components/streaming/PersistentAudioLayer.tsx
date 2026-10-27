/**
 * PersistentAudioLayer — always-mounted hidden <audio> elements for every
 * remote participant on the WebRTC manager. Reads the participant list
 * directly from the manager (not from `useWebRTC`) so audio is correct
 * even when no React tree has explicitly called `joinRoom` from a hook.
 * Mount ONCE at the app root.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getWebRTCManager } from "@/lib/webrtc/manager";
import type { VideoParticipant } from "@/lib/webrtc/types";
import { isPeerMuted, useMutedPeers } from "@/lib/brain/mutedPeersStore";

export function PersistentAudioLayer() {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  // Brain mute is local-only: silences the peer's audio element without
  // touching the mesh connection.
  const mutedPeers = useMutedPeers();

  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const sync = () => setParticipants(manager.getParticipants());
    sync();
    const unsubscribe = manager.onMessage(() => sync());
    // Safety-net poll: the manager.onMessage callback already fires on
    // stream/participant changes; the poll only catches edge cases where
    // a stream attaches without a message. 5s is plenty.
    const poll = window.setInterval(sync, 5000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [user]);

  if (!user) return null;

  return (
    <div aria-hidden className="sr-only">
      {participants.map((p) =>
        p.stream ? (
          <RemoteAudio
            key={`persistent-audio-${p.peerId}`}
            stream={p.stream}
            muted={isPeerMuted(p.peerId)}
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * One <audio> per remote participant. Tracks are merged into the same
 * MediaStream after it is bound, so playback is restarted whenever a track
 * is added or unmutes — otherwise a late mic track stays silent.
 */
function RemoteAudio({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    const kick = () => { void el.play().catch(() => {}); };
    const bindTrack = (t: MediaStreamTrack) => t.addEventListener("unmute", kick);
    stream.getAudioTracks().forEach(bindTrack);
    const onAdd = (e: MediaStreamTrackEvent) => { bindTrack(e.track); kick(); };
    stream.addEventListener("addtrack", onAdd);
    kick();
    return () => {
      stream.removeEventListener("addtrack", onAdd);
      stream.getAudioTracks().forEach((t) => t.removeEventListener("unmute", kick));
    };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline muted={muted} />;
}
