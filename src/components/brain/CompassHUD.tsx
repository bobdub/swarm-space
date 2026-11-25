import { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compassPoint, formatBearing, getViewHeading } from '@/lib/brain/navigation';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * CSS-only compass bezel pinned to the bottom-right of the canvas. Reads
 * the player's facing (radians clockwise from true north, published by
 * the camera rig) every animation frame and turns the dial so "N" points
 * at true north relative to the view. Tap to open the mini-map.
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
    const tick = () => {
      // Which way you face, measured from true north by the camera rig.
      const h = getViewHeading();
      if (h !== null) setHeading((prev) => (Math.abs(prev - h) > 0.002 ? h : prev));
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
      aria-label={`Open map. Facing ${compassPoint(heading)} ${formatBearing(heading)}`}
      title={`Facing ${compassPoint(heading)} ${formatBearing(heading)}`}
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