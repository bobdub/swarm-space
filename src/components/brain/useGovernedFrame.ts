import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { createTierGate, renderGovernor, type RenderTier } from '@/lib/brain/renderGovernor';

/** useFrame paced by the render governor; the callback gets accumulated delta. */
export function useGovernedFrame(tier: RenderTier, name: string, cb: (state: RootState, delta: number) => void): void {
  const gate = useMemo(() => createTierGate(tier), [tier]);
  const ref = useRef(cb);
  ref.current = cb;
  useFrame((state, delta) => {
    const d = gate(delta);
    if (d === null) return;
    const t0 = performance.now();
    ref.current(state, d);
    renderGovernor.observeSubsystem(name, performance.now() - t0);
  });
}

/** Mount once inside the Canvas: trains the governor on real frame time. */
export function RenderGovernorProbe(): null {
  useFrame((_, delta) => { renderGovernor.observeFrame(delta * 1000); });
  return null;
}

/**
 * Mount once inside the Canvas: the Brain is GPU-bound, so when frames stay
 * strained the cheapest real saving is fewer pixels. Drops the render
 * resolution to 1× (from up to 1.5× on high-DPI screens) and keeps it there
 * for the session, so the picture never pumps between sharp and soft.
 */
export function AdaptiveDpr(): null {
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => renderGovernor.onPressure((p) => {
    if (p === 'strained') setDpr(1);
  }), [setDpr]);
  return null;
}
