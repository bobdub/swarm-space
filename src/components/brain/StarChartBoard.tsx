import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPoseTime } from '@/lib/brain/earth';
import type { ConstellationChart } from '@/lib/brain/constellations';
import { isUpTonight, nightIndexAt, sightingHint, sightingsForNight, type NightSighting } from '@/lib/brain/starHunt';
import { markChartRead, useStarHunt, type StarLogEntry } from '@/lib/brain/starHuntStore';

/** Standing this close to the chart counts as reading it. */
const READ_DISTANCE_M = 6;
const CANVAS_W = 768;

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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the preview page
export function drawStarChart(
  canvas: HTMLCanvasElement,
  sighting: NightSighting,
  entry: StarLogEntry | undefined,
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
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.strokeStyle = '#7a1f1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  const chart = sighting.chart;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = foundTonight ? '#9fd67a' : '#f4c46a';
  ctx.font = 'bold 76px Georgia, "Times New Roman", serif';
  ctx.fillText(foundTonight ? `${chart.name} ✓` : chart.name, W / 2, 92);

  drawChartPanel(ctx, chart, 56, 150, W - 112, 500);

  // Tonight's hint for this figure, from the shared clock.
  ctx.fillStyle = isUpTonight(sighting) ? '#f2e6c9' : 'rgba(232,220,192,0.6)';
  ctx.font = '40px Georgia, serif';
  wrapLines(ctx, sightingHint(sighting), W - 120).slice(0, 2)
    .forEach((line, i, all) => ctx.fillText(line, W / 2, 720 + (i - (all.length - 1) / 2) * 48));

  ctx.font = 'italic 32px Georgia, serif';
  ctx.fillStyle = foundTonight ? '#9fd67a' : 'rgba(232,220,192,0.7)';
  const status = foundTonight ? 'Found tonight' : isUpTonight(sighting) ? 'Find it outside after dark' : '';
  if (status) ctx.fillText(status, W / 2, 812);

  ctx.strokeStyle = 'rgba(201,162,74,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(80, 852); ctx.lineTo(W - 80, 852); ctx.stroke();
  ctx.font = `${entry ? 'bold ' : ''}36px Georgia, serif`;
  ctx.fillStyle = entry ? '#ffd35a' : 'rgba(232,220,192,0.45)';
  ctx.fillText(
    entry ? `★ In your star log${entry.count > 1 ? ` ×${entry.count}` : ''}` : '☆ Not in your star log yet',
    W / 2,
    900,
  );
}

/**
 * One of the four star charts on the bar's wall: its constellation, tonight's
 * hint for it, and whether it is in your star log. Standing at the charts
 * opens tonight's hunt. A plane facing local +Z; the caller turns it to face
 * into the room.
 */
export function StarChartBoard({ chartId, width, height }: { chartId: string; width: number; height: number }) {
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

  const sighting = useMemo(
    () => sightingsForNight(night).find((s) => s.chart.id === chartId) ?? sightingsForNight(night)[0],
    [night, chartId],
  );
  const entry = hunt.log[chartId];
  const found = entry?.lastNight === night;
  useEffect(() => {
    drawStarChart(canvas, sighting, entry, found);
    texture.needsUpdate = true;
  }, [canvas, texture, sighting, entry, found]);

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
        <boxGeometry args={[width + 0.08, height + 0.08, 0.06]} />
        <meshStandardMaterial color="#3a2414" roughness={0.8} />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.7} />
      </mesh>
    </group>
  );
}
