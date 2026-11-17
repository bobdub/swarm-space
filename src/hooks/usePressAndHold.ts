/**
 * usePressAndHold — the press-and-hold gesture used to raise a staged
 * build, packaged so other "walk up and do it" prompts can share it.
 *
 * Same feel as the build ring in PendingBuildsLayer: holding fills the
 * ring over `durationMs`, letting go eases it back down (it does not snap
 * to zero), and `onComplete` fires once when the ring is full. Pointer
 * events cover mouse, pen and touch alike; `touchAction: none` on the
 * target keeps a held finger from scrolling or zooming the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Progress eases back at this fraction of the fill rate when released. */
const RELEASE_DECAY = 0.55;

export interface PressAndHold {
  /** 0..1 fill of the ring. */
  progress: number;
  /** True while the pointer is held down on the target. */
  holding: boolean;
  /** Spread onto the element the user presses. */
  bind: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  };
  /** Drop progress to zero immediately. */
  reset: () => void;
}

export function usePressAndHold(
  onComplete: () => void,
  { durationMs = 900, enabled = true }: { durationMs?: number; enabled?: boolean } = {},
): PressAndHold {
  const holdingRef = useRef(false);
  const progressRef = useRef(0);
  const completedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);

  const stopLoop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const tick = useCallback((now: number) => {
    const delta = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const duration = Math.max(0.05, durationMs / 1000);
    if (holdingRef.current) {
      progressRef.current = Math.min(1, progressRef.current + delta / duration);
    } else {
      progressRef.current = Math.max(0, progressRef.current - (delta / duration) * (1 / RELEASE_DECAY));
    }
    setProgress(progressRef.current);

    if (progressRef.current >= 1 && !completedRef.current) {
      completedRef.current = true;
      holdingRef.current = false;
      setHolding(false);
      progressRef.current = 0;
      setProgress(0);
      rafRef.current = null;
      onCompleteRef.current();
      return;
    }
    if (holdingRef.current || progressRef.current > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }, [durationMs]);

  const ensureLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    ensureLoop();
  }, [ensureLoop]);

  const reset = useCallback(() => {
    holdingRef.current = false;
    progressRef.current = 0;
    setHolding(false);
    setProgress(0);
    stopLoop();
  }, []);

  useEffect(() => () => stopLoop(), []);
  useEffect(() => { if (!enabled) reset(); }, [enabled, reset]);

  const bind: PressAndHold['bind'] = {
    onPointerDown: (e) => {
      e.stopPropagation();
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Keep receiving up/cancel even if a finger slides a little.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      completedRef.current = false;
      holdingRef.current = true;
      setHolding(true);
      ensureLoop();
    },
    onPointerUp: (e) => {
      e.stopPropagation();
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      release();
    },
    onPointerCancel: () => release(),
    onPointerLeave: () => release(),
    // Long-press on touch opens the context menu on some browsers.
    onContextMenu: (e) => e.preventDefault(),
  };

  return { progress, holding, bind, reset };
}
