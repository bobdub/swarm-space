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

export function CompassHUD({ selfId, onOpenMap }: Props) {
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
      // Mobile: park the compass on the LEFT side, just above the run bolt
      // (which sits at left/5rem). Desktop keeps the original right-side
      // stack so cursor users see the same layout they're used to.
      className="absolute z-[70] h-14 w-14 rounded-full border-2 border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
      style={
        isMobile
          ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12rem)', left: '1rem' }
          : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8.5rem)', right: '1rem' }
      }
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={{ transform: `rotate(${-heading}rad)`, transition: 'transform 80ms linear' }}
      >
        <Compass className="h-5 w-5 text-[hsl(174,59%,66%)]" />
        <span className="absolute top-0.5 text-[8px] font-bold text-destructive">N</span>
      </div>
    </Button>
  );
}