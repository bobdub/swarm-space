import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type RootState } from '@react-three/fiber';
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

const FULL_DPR: [number, number] = [1, 1.5];

/**
 * Render resolution for the Brain Canvas. The Brain is GPU-bound, so when
 * frames stay strained the cheapest real saving is fewer pixels: drop to 1×
 * (from up to 1.5× on high-DPI screens) and keep it there for the session, so
 * the picture never pumps between sharp and soft. Returned as the Canvas
 * `dpr` prop, because the Canvas re-applies that prop on every render and
 * would undo an imperative setDpr.
 */
export function useAdaptiveDpr(): number | [number, number] {
  const [reduced, setReduced] = useState(() => renderGovernor.pressure() === 'strained');
  useEffect(() => {
    if (reduced) return;
    return renderGovernor.onPressure((p) => { if (p === 'strained') setReduced(true); });
  }, [reduced]);
  return reduced ? 1 : FULL_DPR;
}
