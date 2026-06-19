import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ExternalLink, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StreamRoom } from '@/types/streaming';
import { LivePostBoxBody } from './LivePostBoxBody';
import {
  getFloatingLiveDock,
  isFloatingLiveDockActive,
  refreshFloatingLiveDockRoom,
  setFloatingLiveDock,
  subscribeFloatingLiveDock,
} from '@/lib/streaming/floatingLiveDockStore';

interface LivePostBoxProps {
  room: StreamRoom;
  title?: string;
  visibility?: string;
}

/**
 * LivePostBox — the post-card surface for a live-stream post the
 * local user has joined. Shows a "brain preview" pane (participant
 * video tiles over a brain-gradient backdrop), a classic chat tab
 * (no Infinity), classic A/V controls, and a primary "Join Live
 * Brain" CTA that opens the full immersive scene as an overlay so
 * leaving the immersive view returns the user to this post box.
 *
 * Scoped strictly to live-stream posts; the lobby `/brain` and
 * project hubs are untouched.
 */
export function LivePostBox({ room, title, visibility }: LivePostBoxProps): JSX.Element {
  // Subscribe to the floating dock store so the inline post collapses
  // when this room has been popped out into the floating window.
  useSyncExternalStore(subscribeFloatingLiveDock, getFloatingLiveDock, () => null);
  const isPoppedOut = isFloatingLiveDockActive(room.id);

  // Keep the floating dock's room snapshot fresh while the post is mounted.
  useEffect(() => {
    if (isPoppedOut) refreshFloatingLiveDockRoom(room);
  }, [isPoppedOut, room]);

  const handlePopOut = () => {
    setFloatingLiveDock({
      roomId: room.id,
      room,
      title: (room.title || title || 'Live room').trim(),
      visibility,
    });
  };

  // Auto-pop into the floating dock the first time this room mounts so
  // creating a live from the post composer immediately presents the
  // dedicated, draggable window. The user can dock it back inline.
  const autoPoppedRef = useRef(false);
  useEffect(() => {
    if (autoPoppedRef.current) return;
    if (isPoppedOut) { autoPoppedRef.current = true; return; }
    autoPoppedRef.current = true;
    handlePopOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  if (isPoppedOut) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(245,70%,12%,0.55)] p-4 shadow-inner">
        <div className="flex items-center gap-2 text-sm text-foreground/80">
          <Badge variant="destructive" className="gap-1">
            <Radio className="h-3 w-3 animate-pulse" /> Live
          </Badge>
          <span>Chat is open in the floating window.</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setFloatingLiveDock(null)}
          className="gap-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Dock back here
        </Button>
      </div>
    );
  }

  return (
    <LivePostBoxBody
      room={room}
      title={title}
      visibility={visibility}
      onPopOut={handlePopOut}
    />
  );
}

export default LivePostBox;