import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { StreamRoom } from '@/types/streaming';
import { LivePostPreview } from './LivePostPreview';
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
  onJoin?: () => void;
  canJoin?: boolean;
  isJoining?: boolean;
  autoPop?: boolean;
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
export function LivePostBox({
  room,
  title,
  visibility,
  onJoin,
  canJoin = true,
  isJoining = false,
  autoPop = false,
}: LivePostBoxProps): JSX.Element {
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
  // dedicated, draggable window. The user can dock it back inline at
  // which point the compact `LivePostPreview` is shown.
  const autoPoppedRef = useRef(false);
  useEffect(() => {
    if (!autoPop) return;
    if (autoPoppedRef.current) return;
    if (isPoppedOut) { autoPoppedRef.current = true; return; }
    autoPoppedRef.current = true;
    handlePopOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPop, room.id]);

  const roomEnded = Boolean(
    room?.state === 'ended' || room?.broadcast?.state === 'ended' || room?.endedAt,
  );
  if (isPoppedOut && roomEnded) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsla(0,0%,60%,0.2)] bg-[hsla(245,70%,12%,0.55)] px-3 py-2 text-sm text-foreground/70 shadow-inner">
        <span>Live ended.</span>
      </div>
    );
  }

  // Always render the inline preview — even when popped out — so the
  // post stays a real live surface (participant count, badges, Dock
  // back / Join Brain). The floating dock owns the heavy A/V + chat;
  // the inline preview is the post-side handle for it.
  return (
    <LivePostPreview
      room={room}
      title={title}
      visibility={visibility}
      onPopOut={handlePopOut}
      isPoppedOut={isPoppedOut}
      onJoin={onJoin}
      canJoin={canJoin}
      isJoining={isJoining}
    />
  );
}

export default LivePostBox;