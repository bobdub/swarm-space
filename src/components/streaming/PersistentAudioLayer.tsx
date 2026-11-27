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
import { resumeCallAudio } from "@/lib/webrtc/sharedAudioContext";

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
            // Only the local Brain mute silences the element. A peer's own
            // mute already silences their track at the source, and their
            // mic state can still be a placeholder when audio starts
            // arriving, which used to keep a live voice muted here.
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
 * is added or unmutes — otherwise a late mic track stays silent. A play()
 * the browser blocks for autoplay is retried on the next user gesture, and
 * the shared call AudioContext is resumed with it.
 */
function RemoteAudio({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    let waitingForGesture = false;
    const onGesture = () => {
      waitingForGesture = false;
      removeGesture();
      kick();
    };
    const removeGesture = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      window.removeEventListener("touchend", onGesture, true);
    };
    const kick = () => {
      resumeCallAudio();
      if (!el.paused && el.srcObject === stream) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch((err: unknown) => {
        // Autoplay policy: wait for the next tap or key, then try again.
        if ((err as { name?: string } | null)?.name !== "NotAllowedError" || waitingForGesture) return;
        waitingForGesture = true;
        window.addEventListener("pointerdown", onGesture, true);
        window.addEventListener("keydown", onGesture, true);
        window.addEventListener("touchend", onGesture, true);
      });
    };
    const bindTrack = (t: MediaStreamTrack) => t.addEventListener("unmute", kick);
    stream.getAudioTracks().forEach(bindTrack);
    const onAdd = (e: MediaStreamTrackEvent) => { bindTrack(e.track); kick(); };
    stream.addEventListener("addtrack", onAdd);
    // Something paused playback (route change, a media key, a stalled
    // element): resume while the stream still carries live audio.
    const onPause = () => {
      if (stream.getAudioTracks().some((t) => t.readyState === "live")) kick();
    };
    el.addEventListener("pause", onPause);
    el.addEventListener("stalled", kick);
    kick();
    return () => {
      removeGesture();
      el.removeEventListener("pause", onPause);
      el.removeEventListener("stalled", kick);
      stream.removeEventListener("addtrack", onAdd);
      stream.getAudioTracks().forEach((t) => t.removeEventListener("unmute", kick));
    };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline muted={muted} />;
}
