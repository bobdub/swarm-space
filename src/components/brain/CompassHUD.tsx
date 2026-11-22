import { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getEarthPose, getSurfaceFrame } from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * CSS-only compass bezel pinned to the bottom-right of the canvas.
 * Reads the live Earth pose + the local self body each animation frame
 * and rotates the dial so "N" points along +tangent_z in the local
 * surface frame. Tap to open the mini-map.
 */
interface Props {
  selfId: string;
  onOpenMap: () => void;
}

export function CompassHUD({ selfId, onOpenMap, atWheel = false }: Props & { atWheel?: boolean }) {
  const [heading, setHeading] = useState(0);
  const raf = useRef(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    const physics = getBrainPhysics();
    const tick = () => {
      try {
        const body = physics.getBody(selfId);
        if (body) {
          const pose = getEarthPose();
          const { forward } = getSurfaceFrame(body.pos, pose);
          // 2-D heading from local-tangent forward → screen rotation.
          // Atan2 over the world-XZ projection of the local-forward axis;
          // an absolute compass needs only consistent rotation, not true N.
          const h = Math.atan2(forward[0], forward[2]);
          setHeading(h);
        }
      } catch { /* ignore */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [selfId]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onOpenMap}
      aria-label="Open map"
      // Mobile stacks the compass on the left above the run bolt; desktop keeps right.
      className={`absolute z-[70] rounded-full border-2 border-accent/40 bg-background/80 ${atWheel ? 'h-10 w-10' : 'h-14 w-14'}`}
      style={
        atWheel
          ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 3.25rem)', right: '3.25rem' }
          : isMobile
          ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12rem)', left: '1rem' }
          : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8.5rem)', right: '1rem' }
      }
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={{ transform: `rotate(${-heading}rad)`, transition: 'transform 80ms linear' }}
      >
        <Compass className="h-4 w-4 text-accent" />
        <span className="absolute top-0.5 text-[8px] font-bold text-destructive">N</span>
      </div>
    </Button>
  );
}