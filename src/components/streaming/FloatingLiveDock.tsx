import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { LivePostBoxBody } from './LivePostBoxBody';
import { useStreaming } from '@/hooks/useStreaming';
import {
  getFloatingLiveDock,
  setFloatingLiveDock,
  subscribeFloatingLiveDock,
} from '@/lib/streaming/floatingLiveDockStore';

const STORAGE_KEY = 'swarm:floating-live-dock-rect';

interface Rect { x: number; y: number; w: number; h: number; }

function clampRect(r: Rect): Rect {
  if (typeof window === 'undefined') return r;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(340, Math.min(r.w, vw - 16));
  const h = Math.max(440, Math.min(r.h, vh - 16));
  const x = Math.max(8, Math.min(r.x, vw - w - 8));
  const y = Math.max(8, Math.min(r.y, vh - h - 8));
  return { x, y, w, h };
}

function loadRect(): Rect {
  if (typeof window === 'undefined') {
    return { x: 24, y: 80, w: 440, h: 660 };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Rect;
      if (typeof parsed.x === 'number') return clampRect(parsed);
    }
  } catch { /* ignore */ }
  const vw = window.innerWidth;
  const w = Math.min(440, vw - 32);
  return clampRect({ x: vw - w - 24, y: 72, w, h: 660 });
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

  const [rect, setRect] = useState<Rect>(() => loadRect());
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; orig: Rect } | null>(null);
  const pendingRectRef = useRef<Rect | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Re-clamp on resize.
  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Persist
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch { /* ignore */ }
  }, [rect]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const next = d.mode === 'move'
      ? clampRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy })
      : clampRect({ ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy });
    pendingRectRef.current = next;
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pending = pendingRectRef.current;
      pendingRectRef.current = null;
      if (pending) setRect(pending);
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    if (rafIdRef.current != null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (pendingRectRef.current) {
      const pending = pendingRectRef.current;
      pendingRectRef.current = null;
      setRect(pending);
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const beginDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: { ...rect } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (!entry || typeof document === 'undefined') return null;
  const headerTitle = (entry.title || liveRoom?.title || 'Live room').trim();

  return createPortal(
    <div
      role="dialog"
      aria-label="Live chat window"
      className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-[hsla(180,80%,60%,0.3)] bg-[hsla(245,70%,8%,0.85)] shadow-2xl"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        onPointerDown={beginDrag('move')}
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
        onPointerDown={beginDrag('resize')}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-gradient-to-br from-transparent to-[hsla(180,80%,60%,0.5)]"
        aria-label="Resize window"
      />
    </div>,
    document.body,
  );
}

export default FloatingLiveDock;