/**
 * The Brain's Canvas, paused while a screen share is open full size: the
 * viewer covers the whole page, so drawing the scene is wasted GPU work.
 * Physics, boats and position broadcasts run on their own timers, so the
 * world keeps moving and peers keep seeing us.
 *
 * The pause lives here rather than in the Brain page so opening or closing
 * the viewer re-renders only this wrapper. The scene passed as `children`
 * is the same element as before, so React skips it.
 */
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree, type CanvasProps } from '@react-three/fiber';
import { useScreenViewerOpen } from '@/lib/brain/screenViewerOpen';

/**
 * Switching the frame loop resets the scene clock to zero, which made every
 * time-driven effect (sea, sky, animations) jump on each open and close.
 * Carry the clock across the pause instead.
 */
function KeepClockAcrossPause({ paused }: { paused: boolean }): null {
  const clock = useThree((s) => s.clock);
  const last = useRef(0);
  useFrame(() => { last.current = clock.elapsedTime; });
  useEffect(() => {
    clock.elapsedTime = last.current;
  }, [paused, clock]);
  return null;
}

export function BrainCanvas({ children, ...props }: Omit<CanvasProps, 'frameloop'>) {
  const paused = useScreenViewerOpen();
  return (
    <Canvas {...props} frameloop={paused ? 'never' : 'always'}>
      <>{children}</>
      <KeepClockAcrossPause paused={paused} />
    </Canvas>
  );
}

export default BrainCanvas;
