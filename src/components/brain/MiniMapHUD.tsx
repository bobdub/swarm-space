import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getEarthPose, getSurfaceFrame, EARTH_RADIUS } from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '@/lib/brain/volcanoOrgan';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  selfId: string;
  onClose: () => void;
}

const MAP_SIZE = 280;
const MAP_RANGE_M = 600; // half-width of the projection in metres

/**
 * 2-D azimuthal mini-map centred on the local self body. Land/ocean tint
 * comes from the canonical surfaceClass LUT so the map matches the
 * world. Remote avatars (read live from physics) appear as cyan dots,
 * portals as amber, the volcano as orange, the shared village at origin.
 */
export function MiniMapHUD({ selfId, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physics = useMemo(() => getBrainPhysics(), []);
  const isMobile = useIsMobile();

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      try {
        const body = physics.getBody(selfId);
        const pose = getEarthPose();
        const center = body?.pos ?? pose.center;
        const frame = getSurfaceFrame(center, pose);
        ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

        // Surface tint — sample a coarse grid using the LUT.
        const STEP = 14;
        for (let y = 0; y < MAP_SIZE; y += STEP) {
          for (let x = 0; x < MAP_SIZE; x += STEP) {
            const tx = ((x - MAP_SIZE / 2) / (MAP_SIZE / 2)) * MAP_RANGE_M;
            const tz = ((y - MAP_SIZE / 2) / (MAP_SIZE / 2)) * MAP_RANGE_M;
            const wx = center[0] + frame.right[0] * tx + frame.forward[0] * tz;
            const wy = center[1] + frame.right[1] * tx + frame.forward[1] * tz;
            const wz = center[2] + frame.right[2] * tx + frame.forward[2] * tz;
            const dx = wx - pose.center[0];
            const dy = wy - pose.center[1];
            const dz = wz - pose.center[2];
            const len = Math.hypot(dx, dy, dz) || 1;
            const localN: [number, number, number] = [dx / len, dy / len, dz / len];
            const cls = sampleSurfaceClass(localN, getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID));
            const fill =
              cls === 'ocean' ? 'hsl(210, 60%, 22%)'
              : cls === 'shore' ? 'hsl(45, 50%, 55%)'
              : cls === 'ice' ? 'hsl(200, 30%, 80%)'
              : cls === 'volcLand' ? 'hsl(15, 60%, 35%)'
              : 'hsl(120, 30%, 32%)';
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, STEP, STEP);
          }
        }

        // Origin marker (player center)
        ctx.fillStyle = 'hsl(180, 90%, 65%)';
        ctx.beginPath();
        ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, 5, 0, Math.PI * 2);
        ctx.fill();

        // Remote bodies — cyan dots, projected into the local tangent plane.
        for (const b of physics.getBodies()) {
          if (b.id === selfId) continue;
          if (b.kind !== 'avatar' && b.kind !== 'portal') continue;
          const dx = b.pos[0] - center[0];
          const dy = b.pos[1] - center[1];
          const dz = b.pos[2] - center[2];
          const tx = dx * frame.right[0] + dy * frame.right[1] + dz * frame.right[2];
          const tz = dx * frame.forward[0] + dy * frame.forward[1] + dz * frame.forward[2];
          if (Math.abs(tx) > MAP_RANGE_M || Math.abs(tz) > MAP_RANGE_M) continue;
          const px = MAP_SIZE / 2 + (tx / MAP_RANGE_M) * (MAP_SIZE / 2);
          const py = MAP_SIZE / 2 + (tz / MAP_RANGE_M) * (MAP_SIZE / 2);
          ctx.fillStyle = b.kind === 'portal' ? 'hsl(38, 90%, 60%)' : 'hsl(265, 80%, 70%)';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Border
        ctx.strokeStyle = 'hsla(180, 80%, 60%, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
      } catch { /* best-effort */ }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    void EARTH_RADIUS;
    return () => cancelAnimationFrame(raf);
  }, [selfId, physics]);

  return (
    <div className="absolute bottom-44 right-4 z-[80] rounded-2xl border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[hsl(174,59%,66%)]">Mini Map</span>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <canvas ref={canvasRef} width={MAP_SIZE} height={MAP_SIZE} className="rounded" />
      <p className="mt-2 max-w-[280px] text-[10px] text-foreground/50">
        Cyan = peers · amber = portals · centre = you
      </p>
    </div>
  );
}