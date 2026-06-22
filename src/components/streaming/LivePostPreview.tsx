import { useMemo } from 'react';
import { Maximize2, MessageSquare, Radio, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StreamRoom } from '@/types/streaming';
import { setFloatingLiveDock } from '@/lib/streaming/floatingLiveDockStore';
import { BrainPreviewBackdrop } from './BrainPreviewBackdrop';

interface LivePostPreviewProps {
  room: StreamRoom;
  title?: string;
  visibility?: string;
  onPopOut: () => void;
}

/**
 * Compact inline preview shown inside the feed post for a live-stream
 * post. The full chat / A-V / brain surface lives in the floating dock;
 * this card is one-glance: title, live badge, participant count, and
 * two CTAs (open chat, join brain).
 *
 * Sizing is clamped so the card never dominates the post:
 *   - aspect 16/9, height capped at 200 px on mobile.
 *   - no internal scroll, no chat panel, no controls.
 */
export function LivePostPreview({
  room,
  title,
  visibility,
  onPopOut,
}: LivePostPreviewProps): JSX.Element {
  const displayTitle = (room.title || title || 'Live room').trim();
  const participantCount = useMemo(() => {
    // StreamRoom.participants is the authoritative server count when present.
    const arr = (room as { participants?: Array<unknown> }).participants;
    return Array.isArray(arr) ? arr.length : 0;
  }, [room]);

  const openChat = () => {
    onPopOut();
    setFloatingLiveDock({
      roomId: room.id,
      room,
      title: displayTitle,
      visibility,
    });
  };

  const joinBrain = () => {
    // Dock owns the immersive surface; opening it routes through the
    // existing dock → "Join Live Brain" button path. Keeping a single
    // immersive mount point avoids two BrainUniverseScene instances.
    openChat();
  };

  return (
    <div
      role="group"
      aria-label={`Live room ${displayTitle}`}
      className="relative w-full overflow-hidden rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsl(245,70%,8%)] shadow-lg"
      style={{ aspectRatio: '16 / 9', maxHeight: 200, minHeight: 140 }}
    >
      <BrainPreviewBackdrop />

      <div className="relative z-10 flex h-full flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-foreground/60">
          <Badge variant="destructive" className="gap-1">
            <Radio className="h-3 w-3 animate-pulse" /> Live
          </Badge>
          {visibility && (
            <Badge variant="outline" className="capitalize">
              {visibility.replace('-', ' ')}
            </Badge>
          )}
          {participantCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-foreground/55">
              <Users className="h-3 w-3" /> {participantCount}
            </span>
          )}
        </div>

        <h3 className="line-clamp-1 text-sm font-semibold text-foreground drop-shadow sm:text-base">
          {displayTitle}
        </h3>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={openChat}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label="Open live chat in floating window"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Open chat
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={joinBrain}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label="Join Live Brain"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Join Brain
          </Button>
        </div>
      </div>
    </div>
  );
}

export default LivePostPreview;