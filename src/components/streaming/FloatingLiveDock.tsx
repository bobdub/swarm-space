import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { LivePostBoxBody } from './LivePostBoxBody';
import { useStreaming } from '@/hooks/useStreaming';
import { useFloatingRect, type FloatingRect } from '@/hooks/useFloatingRect';
import {
  getFloatingLiveDock,
  setFloatingLiveDock,
  subscribeFloatingLiveDock,
} from '@/lib/streaming/floatingLiveDockStore';

const STORAGE_KEY = 'swarm:floating-live-dock-rect';

function initialRect(vw: number): FloatingRect {
  const w = Math.min(440, vw - 32);
  return { x: vw - w - 24, y: 72, w, h: 660 };
}

/**
 * App-level floating window that hosts a "popped out" LivePostBox so
 * the live chat survives page navigation. Draggable from its header,
 * resizable from the bottom-right corner. Position/size persist via
 * localStorage.
 */
export function FloatingLiveDock(): JSX.Element | null {
  const entry = useSyncExternalStore(subscribeFloatingLiveDock, getFloatingLiveDock, () => null);
  const { roomsById } = useStreaming();
  const liveRoom = entry ? roomsById[entry.roomId] ?? entry.room : null;
  const roomEnded = Boolean(
    liveRoom &&
      (liveRoom.state === 'ended' ||
        liveRoom.broadcast?.state === 'ended' ||
        liveRoom.endedAt),
  );

  // When the underlying room ends (host hangs up, last user leaves,
  // peer cleanup, etc.) auto-close the floating window and tell the
  // user so the live doesn't just silently vanish.
  const closedForRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!entry) return;
    if (!roomEnded) return;
    if (closedForRoomIdRef.current === entry.roomId) return;
    closedForRoomIdRef.current = entry.roomId;
    toast.info('Live room ended');
    setFloatingLiveDock(null);
  }, [entry, roomEnded]);

  const { style, beginMove, beginResize } = useFloatingRect({
    storageKey: STORAGE_KEY,
    minW: 340,
    minH: 440,
    initial: initialRect,
  });

  if (!entry || typeof document === 'undefined') return null;
  const headerTitle = (entry.title || liveRoom?.title || 'Live room').trim();

  return createPortal(
    <div
      role="dialog"
      aria-label="Live chat window"
      className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-[hsla(180,80%,60%,0.3)] bg-[hsla(245,70%,8%,0.85)] shadow-2xl"
      style={style}
    >
      <div
        onPointerDown={beginMove}
        className="flex h-9 shrink-0 cursor-move items-center justify-between gap-3 bg-black/45 px-3 text-foreground"
      >
        <span className="min-w-0 truncate text-sm font-semibold">{headerTitle}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-foreground/50">Drag · resize</span>
      </div>
      <div className="min-h-0 flex-1 p-1.5">
        <LivePostBoxBody
          room={entry.room}
          title={entry.title}
          visibility={entry.visibility}
          floating
          onDockBack={() => setFloatingLiveDock(null)}
        />
      </div>
      <div
        onPointerDown={beginResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-gradient-to-br from-transparent to-[hsla(180,80%,60%,0.5)]"
        aria-label="Resize window"
      />
    </div>,
    document.body,
  );
}

export default FloatingLiveDock;