import { useEffect, useMemo, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoParticipant } from "@/lib/webrtc/types";

interface BrainVideoGridProps {
  participants: VideoParticipant[];
  localStream: MediaStream | null;
  localUsername: string;
  localMuted: boolean;
  cameraOn: boolean;
}

interface Tile {
  key: string;
  label: string;
  stream: MediaStream;
  isSelf: boolean;
  muted: boolean;
}

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== tile.stream) {
      el.srcObject = tile.stream;
    }
  }, [tile.stream]);
  return (
    <div className="pointer-events-auto relative overflow-hidden rounded-md border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] shadow-lg backdrop-blur">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={tile.isSelf}
        className={cn(
          "block bg-black object-cover",
          "h-[72px] w-[96px] sm:h-[96px] sm:w-[128px]",
        )}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10px] text-white">
        {tile.muted ? (
          <MicOff className="h-3 w-3 text-red-400" />
        ) : (
          <Mic className="h-3 w-3 text-emerald-400" />
        )}
        <span className="truncate">{tile.label}</span>
      </div>
    </div>
  );
}

export function BrainVideoGrid({
  participants,
  localStream,
  localUsername,
  localMuted,
  cameraOn,
}: BrainVideoGridProps) {
  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    if (cameraOn && localStream && localStream.getVideoTracks().some((t) => t.enabled)) {
      out.push({
        key: "self",
        label: `${localUsername} (you)`,
        stream: localStream,
        isSelf: true,
        muted: localMuted,
      });
    }
    for (const p of participants) {
      if (!p.stream) continue;
      const hasVideo = p.stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
      if (!hasVideo) continue;
      out.push({
        key: p.peerId,
        label: p.username || p.peerId.slice(0, 8),
        stream: p.stream,
        isSelf: false,
        muted: p.isMuted,
      });
    }
    return out;
  }, [cameraOn, localStream, localMuted, localUsername, participants]);

  if (tiles.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-3 top-14 z-20 flex max-w-[80vw] flex-wrap justify-end gap-2",
        "animate-in fade-in slide-in-from-top-2 duration-200",
      )}
    >
      {tiles.map((t) => (
        <VideoTile key={t.key} tile={t} />
      ))}
    </div>
  );
}

export default BrainVideoGrid;