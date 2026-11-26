import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { CONSTELLATIONS, type ConstellationChart } from '@/lib/brain/constellations';
import { nightIndexAt, sightingHint, tonightsConstellation, type NightSighting } from '@/lib/brain/starHunt';
import { markChartRead, useStarHunt, type StarLogEntry } from '@/lib/brain/starHuntStore';

/** Standing this close to the chart counts as reading it. */
const READ_DISTANCE_M = 6;
const CANVAS_W = 1024;

/** Deterministic scatter of faint stars so the chart reads like a sky, not a diagram. */
function scatter(seed: number, count: number): Array<[number, number, number]> {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => [rand(), rand(), rand()] as [number, number, number]);
}

function drawChartPanel(
  ctx: CanvasRenderingContext2D,
  chart: ConstellationChart,
  x0: number,
  y0: number,
  w: number,
  h: number,
) {
  // Night-blue panel.
  const sky = ctx.createLinearGradient(0, y0, 0, y0 + h);
  sky.addColorStop(0, '#0d1633');
  sky.addColorStop(1, '#070b1c');
  ctx.fillStyle = sky;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(201,162,74,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, w, h);

  // Faint field stars.
  for (const [u, v, m] of scatter(chart.id.length * 7919 + chart.ra, 140)) {
    ctx.fillStyle = `rgba(200,215,255,${0.15 + m * 0.3})`;
    ctx.beginPath();
    ctx.arc(x0 + 10 + u * (w - 20), y0 + 10 + v * (h - 20), 1 + m * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fit the figure in the panel, north up.
  const xs = chart.stars.map((s) => s.x);
  const ys = chart.stars.map((s) => s.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 70;
  const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const px = (x: number) => cx + (x - (minX + maxX) / 2) * scale;
  const py = (y: number) => cy - (y - (minY + maxY) / 2) * scale;

  // The figure's lines are a learning aid on the chart only; the sky has none.
  ctx.strokeStyle = 'rgba(244,196,106,0.55)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  for (const [a, b] of chart.lines) {
    ctx.beginPath();
    ctx.moveTo(px(chart.stars[a].x), py(chart.stars[a].y));
    ctx.lineTo(px(chart.stars[b].x), py(chart.stars[b].y));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const star of chart.stars) {
    const r = 6 + star.mag * 9;
    const glow = ctx.createRadialGradient(px(star.x), py(star.y), 0, px(star.x), py(star.y), r * 2.2);
    glow.addColorStop(0, 'rgba(255,250,235,1)');
    glow.addColorStop(0.35, 'rgba(255,240,200,0.8)');
    glow.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px(star.x), py(star.y), r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Compass marks: north up, east to the right as you face the sky.
  ctx.fillStyle = '#c9a24a';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', x0 + w / 2, y0 + 30);
  ctx.font = '26px Georgia, serif';
  ctx.fillText('E', x0 + w - 24, y0 + h / 2);
  ctx.fillText('W', x0 + 24, y0 + h / 2);
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the preview test
export function drawStarChart(
  canvas: HTMLCanvasElement,
  sighting: NightSighting,
  log: Record<string, StarLogEntry>,
  foundTonight: boolean,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const wood = ctx.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#2b1a10');
  wood.addColorStop(1, '#1a0f08');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = '#7a1f1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4c46a';
  ctx.font = 'bold 72px Georgia, "Times New Roman", serif';
  ctx.fillText("Tonight's Stars", W / 2, 100);
  ctx.fillStyle = '#7fae5a';
  ctx.font = 'italic 32px Georgia, serif';
  ctx.fillText('Star chart of The Green Cat & Red Dragon', W / 2, 158);

  const chart = sighting.chart;
  drawChartPanel(ctx, chart, 80, 200, W - 160, 600);

  ctx.fillStyle = foundTonight ? '#9fd67a' : '#ffd35a';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.fillText(foundTonight ? `${chart.name} ✓` : chart.name, W / 2, 870);
  ctx.fillStyle = '#f2e6c9';
  ctx.font = '38px Georgia, serif';
  ctx.fillText(sightingHint(sighting), W / 2, 935);
  ctx.fillStyle = 'rgba(232,220,192,0.7)';
  ctx.font = 'italic 28px Georgia, serif';
  ctx.fillText(
    foundTonight ? 'Found tonight. A new chart goes up tomorrow.' : 'Go outside after dark, find it, and hold your gaze on it.',
    W / 2,
    985,
  );

  // Star log.
  ctx.strokeStyle = 'rgba(201,162,74,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(90, 1030); ctx.lineTo(W - 90, 1030); ctx.stroke();
  ctx.fillStyle = '#c9a24a';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText('Your star log', W / 2, 1070);
  const colW = (W - 180) / CONSTELLATIONS.length;
  CONSTELLATIONS.forEach((c, i) => {
    const entry = log[c.id];
    const x = 90 + colW * (i + 0.5);
    ctx.fillStyle = entry ? '#ffd35a' : 'rgba(232,220,192,0.35)';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillText(entry ? '★' : '☆', x, 1125);
    ctx.font = `${entry ? 'bold ' : ''}26px Georgia, serif`;
    ctx.fillStyle = entry ? '#f2e6c9' : 'rgba(232,220,192,0.45)';
    ctx.fillText(c.name.replace(/^The /, ''), x, 1170);
    if (entry && entry.count > 1) {
      ctx.font = '22px Georgia, serif';
      ctx.fillText(`×${entry.count}`, x, 1200);
    }
  });
  if (CONSTELLATIONS.every((c) => log[c.id])) {
    ctx.fillStyle = '#ffd35a';
    ctx.font = 'italic bold 30px Georgia, serif';
    ctx.fillText('★ Star Navigator ★', W / 2, 1232);
  }
}

/**
 * The star chart on the bar's wall: tonight's constellation, a loose hint of
 * where to look, and your star log. Standing at it opens tonight's hunt.
 * A plane facing local +Z; the caller turns it to face into the room.
 */
export function StarChartBoard({ width, height }: { width: number; height: number }) {
  const hunt = useStarHunt();
  const [night, setNight] = useState(() => nightIndexAt(getEarthPoseTime()));
  const groupRef = useRef<THREE.Group>(null);
  const tick = useRef({ acc: 0, pos: new THREE.Vector3() });
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = Math.round(CANVAS_W * (height / width));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);

  const sighting = useMemo(() => tonightsConstellation(night), [night]);
  const found = hunt.log[sighting.chart.id]?.lastNight === night;
  useEffect(() => {
    drawStarChart(canvas, sighting, hunt.log, found);
    texture.needsUpdate = true;
  }, [canvas, texture, sighting, hunt.log, found]);

  // Twice a second: has the night turned, and is the player reading the chart?
  useFrame(({ camera }, delta) => {
    const t = tick.current;
    t.acc += delta;
    if (t.acc < 0.5 || !groupRef.current) return;
    t.acc = 0;
    const n = nightIndexAt(getEarthPoseTime());
    if (n !== night) setNight(n);
    groupRef.current.getWorldPosition(t.pos);
    if (t.pos.distanceTo(camera.position) <= READ_DISTANCE_M) markChartRead(n);
  });

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[width + 0.12, height + 0.12, 0.06]} />
        <meshStandardMaterial color="#3a2414" roughness={0.8} />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.7} />
      </mesh>
    </group>
  );
}
