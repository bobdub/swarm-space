import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getEarthPose, getSurfaceFrame, EARTH_RADIUS, SUN_POSITION, quatRotate, type Vec3 } from '@/lib/brain/earth';
import { getWeather, isWeatherFallback } from '@/lib/world/weather';
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
  const [wx, setWx] = useState<LocalWeather | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; sx: number; sy: number; bx: number; by: number } | null>(null);
  const onDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: drag.x, by: drag.y };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [drag.x, drag.y]);
  const onMove = useCallback((e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s || s.id !== e.pointerId) return;
    setDrag({ x: s.bx + e.clientX - s.sx, y: s.by + e.clientY - s.sy });
  }, []);
  const onUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const read = () => {
      try {
        const body = physics.getBody(selfId);
        if (body) setWx(readLocalWeather(body.pos as Vec3));
      } catch { /* noop */ }
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [selfId, physics]);

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
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute z-[80] touch-none select-none rounded-2xl border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] p-3 shadow-2xl"
      // Mobile anchors left (above the compass/bolt stack) to clear the joystick.
      style={
        isMobile
          ? { top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)', left: '0.75rem', transform: `translate(${drag.x}px, ${drag.y}px)` }
          : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 11rem)', right: '1rem', transform: `translate(${drag.x}px, ${drag.y}px)` }
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="cursor-grab text-[10px] font-bold uppercase tracking-widest text-[hsl(174,59%,66%)]">⠿ Mini Map</span>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {wx && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-foreground/5 px-2 py-1.5 text-xs text-foreground/90">
          <span className="font-semibold">{wx.icon} {wx.label}</span>
          <span className="font-bold">{wx.tempF}°F</span>
          <span className="text-foreground/60">{wx.rainChance}% {wx.tempF <= 32 ? 'snow' : 'rain'}</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={MAP_SIZE}
        height={MAP_SIZE}
        className="rounded"
        style={{ width: isMobile ? 'min(220px, calc(100vw - 3rem))' : MAP_SIZE, height: 'auto', aspectRatio: '1 / 1' }}
      />
      <p className="mt-2 max-w-[220px] md:max-w-[280px] text-[10px] text-foreground/50">
        Cyan = peers · amber = portals · centre = you
      </p>
    </div>
  );
}
interface LocalWeather { icon: string; label: string; tempF: number; rainChance: number }

/** Local conditions read from the live weather field at the player's position. */
function readLocalWeather(pos: Vec3): LocalWeather {
  const pose = getEarthPose();
  const d: Vec3 = [pos[0] - pose.center[0], pos[1] - pose.center[1], pos[2] - pose.center[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const worldN: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  const localN = quatRotate(pose.invSpinQuat, worldN);
  const s: Vec3 = [SUN_POSITION[0] - pose.center[0], SUN_POSITION[1] - pose.center[1], SUN_POSITION[2] - pose.center[2]];
  const sl = Math.hypot(s[0], s[1], s[2]) || 1;
  const sunDot = (worldN[0] * s[0] + worldN[1] * s[1] + worldN[2] * s[2]) / sl;
  const w = getWeather();
  // Latitude cooling: |y| of the local normal ≈ sin(latitude).
  const lat = Math.abs(localN[1]);
  let tempF = 50 + Math.max(0, sunDot) * 38 - Math.max(0, -sunDot) * 14 - lat * 40 + w.humidity * 6;
  let nearest = Infinity; let raining = false; let charge = 0;
  for (const c of w.clouds) {
    const dot = Math.max(-1, Math.min(1, c.normal[0] * localN[0] + c.normal[1] * localN[1] + c.normal[2] * localN[2]));
    const ang = Math.acos(dot);
    const reach = (c.radius * 3) / EARTH_RADIUS + 0.03;
    if (ang < reach && ang < nearest) { nearest = ang; raining = c.raining; charge = c.charge; }
  }
  const under = nearest !== Infinity;
  if (under) tempF -= raining ? 8 : 4;
  tempF = Math.round(tempF);
  const rainChance = Math.round(Math.min(100, raining ? 90 + charge * 10 : under ? charge * 80 : w.humidity * 20));
  const cold = tempF <= 32;
  let icon = '☀️'; let label = 'Sunny';
  if (raining) { icon = cold ? '🌨️' : '🌧️'; label = cold ? 'Snow' : 'Rain'; }
  else if (under) { icon = '☁️'; label = 'Cloudy'; }
  else if (sunDot < 0) { icon = '🌙'; label = 'Clear night'; }
  else if (sunDot < 0.2) { icon = '🌤️'; label = 'Low sun'; }
  if (isWeatherFallback()) label += ' (lite)';
  return { icon, label, tempF, rainChance };
}
