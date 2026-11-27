import { useCallback, useEffect, useRef, useState } from 'react';

export interface FloatingRect { x: number; y: number; w: number; h: number; }

interface Options {
  /** localStorage key the position and size persist under. */
  storageKey: string;
  minW: number;
  minH: number;
  /** Where the window opens the first time (no saved rect yet). */
  initial: (vw: number, vh: number) => FloatingRect;
}

/** Keep a floating window fully on screen and no smaller than its minimum. */
export function clampFloatingRect(r: FloatingRect, minW: number, minH: number): FloatingRect {
  if (typeof window === 'undefined') return r;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // The viewport wins over the minimum, so a short window never hides the bottom.
  const w = Math.min(Math.max(minW, r.w), Math.max(0, vw - 16));
  const h = Math.min(Math.max(minH, r.h), Math.max(0, vh - 16));
  const x = Math.max(8, Math.min(r.x, vw - w - 8));
  const y = Math.max(8, Math.min(r.y, vh - h - 8));
  return { x, y, w, h };
}

/** Header controls (close, dock, tabs…) must stay clickable inside a drag handle. */
function startsOnControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, a, input, select, textarea, [role="tab"]');
}

/**
 * Position and size for an app-level floating window: drag it from a
 * handle, resize it from a corner, and it is restored where the user left
 * it. Shared by the popped-out live dock and the Global Chat window.
 */
export function useFloatingRect({ storageKey, minW, minH, initial }: Options) {
  const clamp = useCallback((r: FloatingRect) => clampFloatingRect(r, minW, minH), [minW, minH]);

  const [rect, setRect] = useState<FloatingRect>(() => {
    if (typeof window === 'undefined') return initial(1280, 800);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as FloatingRect;
        if (typeof parsed?.x === 'number' && typeof parsed?.w === 'number') return clamp(parsed);
      }
    } catch { /* ignore */ }
    return clamp(initial(window.innerWidth, window.innerHeight));
  });

  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; orig: FloatingRect } | null>(null);
  const pendingRectRef = useRef<FloatingRect | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Re-clamp when the browser window changes size.
  useEffect(() => {
    const onResize = () => setRect((r) => clamp(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(rect)); } catch { /* ignore */ }
  }, [rect, storageKey]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const next = d.mode === 'move'
      ? clamp({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy })
      : clamp({ ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy });
    pendingRectRef.current = next;
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pending = pendingRectRef.current;
      pendingRectRef.current = null;
      if (pending) setRect(pending);
    });
  }, [clamp]);

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
    window.removeEventListener('pointercancel', onPointerUp);
  }, [onPointerMove]);

  // A window closed mid-drag must not leave listeners behind.
  useEffect(() => () => onPointerUp(), [onPointerUp]);

  const beginDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (mode === 'move' && startsOnControl(e.target)) return;
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: { ...rect } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  return {
    rect,
    style: { left: rect.x, top: rect.y, width: rect.w, height: rect.h } as React.CSSProperties,
    beginMove: beginDrag('move'),
    beginResize: beginDrag('resize'),
  };
}
