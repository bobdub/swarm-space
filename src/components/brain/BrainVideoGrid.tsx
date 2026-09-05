import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, MonitorUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoParticipant } from "@/lib/webrtc/types";

interface BrainVideoGridProps {
  participants: VideoParticipant[];
  localStream: MediaStream | null;
  localUsername: string;
  localMuted: boolean;
  cameraOn: boolean;
  /** Local screen capture, when this user is sharing. */
  localScreenStream?: MediaStream | null;
}

interface Tile {
  key: string;
  label: string;
  stream: MediaStream;
  isSelf: boolean;
  muted: boolean;
  isScreen: boolean;
}

function TileVideo({
  stream,
  muted,
  className,
}: {
  stream: MediaStream;
  muted: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function VideoTile({ tile, onExpand }: { tile: Tile; onExpand: (key: string) => void }) {
  return (
    <div
      className={cn(
        "pointer-events-auto relative overflow-hidden rounded-md bg-[hsla(265,70%,8%,0.85)] shadow-lg",
        tile.isScreen
          ? "border-2 border-[hsla(180,90%,55%,0.75)]"
          : "border border-[hsla(180,80%,60%,0.3)]",
      )}
    >
      <TileVideo
        stream={tile.stream}
        muted
        className={cn(
          "block bg-black",
          tile.isScreen ? "object-contain" : "object-cover",
          "h-[72px] w-[96px] sm:h-[96px] sm:w-[128px]",
        )}
      />
      {tile.isScreen && (
        <button
          type="button"
          onClick={() => onExpand(tile.key)}
          aria-label={`Expand ${tile.label}`}
          title="Watch full size"
          className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      )}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10px] text-white">
        {tile.isScreen ? (
          <MonitorUp className="h-3 w-3 text-cyan-300" />
        ) : tile.muted ? (
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
  localScreenStream = null,
}: BrainVideoGridProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    if (cameraOn && localStream && localStream.getVideoTracks().some((t) => t.enabled)) {
      out.push({
        key: "self",
        label: `${localUsername} (you)`,
        stream: localStream,
        isSelf: true,
        muted: localMuted,
        isScreen: false,
      });
    }
    if (localScreenStream && localScreenStream.getVideoTracks().length > 0) {
      out.push({
        key: "self-screen",
        label: "Your screen",
        stream: localScreenStream,
        isSelf: true,
        muted: true,
        isScreen: true,
      });
    }
    for (const p of participants) {
      const name = p.username || p.peerId.slice(0, 8);
      if (p.stream) {
        const hasVideo = p.stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
        if (hasVideo) {
          out.push({
            key: p.peerId,
            label: name,
            stream: p.stream,
            isSelf: false,
            muted: p.isMuted,
            isScreen: false,
          });
        }
      }
      if (p.screenStream && p.screenActive !== false && p.screenStream.getVideoTracks().length > 0) {
        out.push({
          key: `${p.peerId}-screen`,
          label: `${name}'s screen`,
          stream: p.screenStream,
          isSelf: false,
          muted: true,
          isScreen: true,
        });
      }
    }
    return out;
  }, [cameraOn, localStream, localMuted, localUsername, localScreenStream, participants]);

  const expanded = expandedKey ? tiles.find((t) => t.key === expandedKey) ?? null : null;

  useEffect(() => {
    if (expandedKey && !tiles.some((t) => t.key === expandedKey)) setExpandedKey(null);
  }, [expandedKey, tiles]);

  if (tiles.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute right-3 top-14 z-20 flex max-w-[80vw] flex-wrap justify-end gap-2",
          "animate-in fade-in slide-in-from-top-2 duration-200",
        )}
      >
        {tiles.map((t) => (
          <VideoTile key={t.key} tile={t} onExpand={setExpandedKey} />
        ))}
      </div>

      {expanded && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-black/85 p-4 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between text-sm text-white">
            <span className="flex items-center gap-2 truncate">
              <MonitorUp className="h-4 w-4 text-cyan-300" />
              {expanded.label}
            </span>
            <button
              type="button"
              onClick={() => setExpandedKey(null)}
              aria-label="Close screen share view"
              className="rounded border border-white/20 bg-white/10 p-1.5 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <TileVideo
            stream={expanded.stream}
            muted
            className="min-h-0 w-full flex-1 rounded-md bg-black object-contain"
          />
        </div>
      )}
    </>
  );
}

export default BrainVideoGrid;
