import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getEarthPose, EARTH_RADIUS, quatRotate, type Vec3 } from '@/lib/brain/earth';
import {
  canvasToMap, getNorthFrame, mapToCanvas, projectToMap, unprojectFromMap, worldToLocalNormal, type NorthFrame,
} from '@/lib/brain/mapProjection';
import { MAP_SURFACE_FILL, sampleMapSurface } from '@/lib/brain/mapSurface';
import { getWeather, isWeatherFallback } from '@/lib/world/weather';
import { fahrenheitToCelsius } from '@/lib/world/temperature';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '@/lib/brain/volcanoOrgan';
import { useIsMobile } from '@/hooks/use-mobile';
import { getFleet } from '@/lib/brain/sea/fleet';
import { getVillageDockSite, travel } from '@/lib/brain/sea/dockSite';
import { getCrewBoatKey } from '@/lib/brain/sea/crew';

interface Props {
  selfId: string;
  onClose: () => void;
}

const MAP_SIZE = 280;
const MAP_RANGE_M = 600; // half-width of the projection in metres

/**
 * North-up mini-map centred on the local self body. Everything is drawn
 * in Earth-local space through the shared azimuthal-equidistant
 * projection (`mapProjection.ts`), so the ground stays put while Earth
 * spins. Land and sea come from the same ground height the world is
 * built from (`mapSurface.ts`). Peers are violet, portals amber, boats
 * are hull arrows and the jetty is a brown line.
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

    // Land and sea live on their own offscreen layer, repainted only when
    // you have moved about one cell. Markers are drawn over it every frame.
    const terrain = document.createElement('canvas');
    terrain.width = MAP_SIZE;
    terrain.height = MAP_SIZE;
    const tctx = terrain.getContext('2d');
    let terrainAt: Vec3 | null = null;
    let frameRef: NorthFrame | null = null;
    const CELL_PX = 4;
    const REPAINT_ARC = ((MAP_RANGE_M * 2) / (MAP_SIZE / CELL_PX)) / EARTH_RADIUS;

    const paintTerrain = (frame: NorthFrame) => {
      if (!tctx) return;
      const volcano = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
      for (let y = 0; y < MAP_SIZE; y += CELL_PX) {
        for (let x = 0; x < MAP_SIZE; x += CELL_PX) {
          const [e, n] = canvasToMap(x + CELL_PX / 2, y + CELL_PX / 2, MAP_SIZE, MAP_RANGE_M);
          const local = unprojectFromMap(frame, e, n);
          tctx.fillStyle = MAP_SURFACE_FILL[sampleMapSurface(local, volcano)];
          tctx.fillRect(x, y, CELL_PX, CELL_PX);
        }
      }
    };

    let raf = 0;
    const draw = () => {
      try {
        const body = physics.getBody(selfId);
        if (!body) throw new Error('no self body yet');
        const pose = getEarthPose();
        const self = worldToLocalNormal(body.pos as Vec3, pose);
        const frame = getNorthFrame(self, frameRef);
        frameRef = frame;

        // Repaint land/sea once you've moved about a cell.
        const moved = terrainAt
          ? Math.acos(Math.max(-1, Math.min(1, self[0] * terrainAt[0] + self[1] * terrainAt[1] + self[2] * terrainAt[2])))
          : Infinity;
        if (moved >= REPAINT_ARC) {
          paintTerrain(frame);
          terrainAt = self;
        }

        ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
        // The cached layer was painted around `terrainAt`; shift it so it
        // stays fixed to the ground until the next repaint.
        if (terrainAt) {
          const [oe, on] = projectToMap(frame, terrainAt);
          const [ox, oy] = mapToCanvas(oe, on, MAP_SIZE, MAP_RANGE_M);
          ctx.drawImage(terrain, ox - MAP_SIZE / 2, oy - MAP_SIZE / 2);
        }

        const toMap = (n: Vec3, slack = 1): [number, number] | null => {
          const [e, nn] = projectToMap(frame, n);
          if (Math.abs(e) > MAP_RANGE_M * slack || Math.abs(nn) > MAP_RANGE_M * slack) return null;
          return mapToCanvas(e, nn, MAP_SIZE, MAP_RANGE_M);
        };

        // Remote bodies: violet peers, amber portals.
        for (const b of physics.getBodies()) {
          if (b.id === selfId) continue;
          if (b.kind !== 'avatar' && b.kind !== 'portal') continue;
          const p = toMap(worldToLocalNormal(b.pos as Vec3, pose));
          if (!p) continue;
          ctx.fillStyle = b.kind === 'portal' ? 'hsl(38, 90%, 60%)' : 'hsl(265, 80%, 70%)';
          ctx.beginPath();
          ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // The jetty and the boats (already Earth-local): the hull points along her heading.
        const site = getVillageDockSite();
        if (site) {
          const a = toMap(site.jettyStart, 1.2);
          const b = toMap(travel(site.jettyStart, site.jettyDir, site.jettyLength), 1.2);
          if (a && b) {
            ctx.strokeStyle = 'hsl(30, 45%, 50%)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
          }
        }
        const crewKey = getCrewBoatKey();
        for (const boat of getFleet().list()) {
          if (!boat.visible) continue;
          const { n, heading } = boat.vessel.motion;
          const c = toMap(n, 1.2);
          const bow = toMap(travel(n, heading, 40), 1.4);
          if (!c || !bow) continue;
          const ang = Math.atan2(bow[1] - c[1], bow[0] - c[0]);
          const mine = boat.kind === 'mine' || boat.key === crewKey;
          ctx.save();
          ctx.translate(c[0], c[1]);
          ctx.rotate(ang);
          ctx.fillStyle = mine ? 'hsl(45, 95%, 60%)' : boat.kind === 'dock' ? 'hsl(30, 45%, 62%)' : 'hsl(0, 0%, 92%)';
          ctx.strokeStyle = 'hsla(265, 70%, 8%, 0.9)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(7, 0); ctx.lineTo(-5, -3.5); ctx.lineTo(-5, 3.5); ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }

        // You, at the centre.
        ctx.fillStyle = 'hsl(180, 90%, 65%)';
        ctx.strokeStyle = 'hsla(265, 70%, 8%, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, 5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // North is always up.
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'hsla(265, 70%, 8%, 0.75)';
        ctx.fillRect(MAP_SIZE / 2 - 9, 3, 18, 16);
        ctx.fillStyle = 'hsl(0, 85%, 65%)';
        ctx.fillText('N', MAP_SIZE / 2, 5);

        // Border
        ctx.strokeStyle = 'hsla(180, 80%, 60%, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
      } catch { /* best-effort */ }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
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
          <span className="font-bold">{wx.tempF}°F / {wx.tempC}°C</span>
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
        North is up · centre = you · violet = peers · amber = portals · gold = your boat · white = others' boats
      </p>
    </div>
  );
}
interface LocalWeather { icon: string; label: string; tempF: number; tempC: number; rainChance: number }

/** Local conditions read from the live weather field at the player's position. */
function readLocalWeather(pos: Vec3): LocalWeather {
  const pose = getEarthPose();
  const d: Vec3 = [pos[0] - pose.center[0], pos[1] - pose.center[1], pos[2] - pose.center[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const worldN: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  const localN = quatRotate(pose.invSpinQuat, worldN);
  const s: Vec3 = [pose.sun[0] - pose.center[0], pose.sun[1] - pose.center[1], pose.sun[2] - pose.center[2]];
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
  const tempC = Math.round(fahrenheitToCelsius(tempF));
  tempF = Math.round(tempF);
  const rainChance = Math.round(Math.min(100, raining ? 90 + charge * 10 : under ? charge * 80 : w.humidity * 20));
  const cold = tempF <= 32;
  let icon = '☀️'; let label = 'Sunny';
  if (raining) { icon = cold ? '🌨️' : '🌧️'; label = cold ? 'Snow' : 'Rain'; }
  else if (under) { icon = '☁️'; label = 'Cloudy'; }
  else if (sunDot < 0) { icon = '🌙'; label = 'Clear night'; }
  else if (sunDot < 0.2) { icon = '🌤️'; label = 'Low sun'; }
  if (isWeatherFallback()) label += ' (lite)';
  return { icon, label, tempF, tempC, rainChance };
}
