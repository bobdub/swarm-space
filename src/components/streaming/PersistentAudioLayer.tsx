/**
 * PersistentAudioLayer — Always-mounted hidden <audio> elements for remote participants.
 * Renders outside the collapsible tray section so audio is never interrupted by UI state.
 */
import { useWebRTC } from "@/hooks/useWebRTC";

export function PersistentAudioLayer({ roomId }: { roomId: string }) {
  const { participants } = useWebRTC();

  if (!roomId) return null;

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
