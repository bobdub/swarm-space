/**
 * LandPlotsOverlay — renders claimed plot footprints as flat outlined
 * rectangles glued to the Earth-local lattice-origin frame.
 *
 *   • own plot      → green outline, faint green fill
 *   • foreign plot  → red outline + red fill (no-build)
 *   • commons/road  → slate outline + pale fill (dev-laid public land)
 *
 * Labels are canvas-texture sprites, NOT drei <Html>: the DOM overlay
 * injected an occlusion plate into the scene that read as a large black
 * slab across the horizon. Sprites are pure WebGL, depth-tested, and
 * cost nothing per frame.
 *
 * Geometry is rebuilt only when the Earth pose moves materially and
 * only for plots near the camera, so the overlay can never become a
 * per-frame stall as claims accumulate.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  earthLocalToWorld,
  getEarthPose,
  getEarthLocalSiteFrame,
  EARTH_RADIUS,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import {
  PLOT_CELL,
  loadLandPlots,
  subscribeLandPlots,
  plotKind,
  type LandPlot,
} from '@/lib/world/landPlots';
import { subscribeShowLandMarkers } from '@/lib/world/landOverlayStore';

interface LandPlotsOverlayProps {
  selfId: string;
  /** Stronger fills while building so boundaries are unmissable. */
  emphasized?: boolean;
}

const SEGMENTS_PER_SIDE = 6;
/** Beyond this camera distance a plot is not drawn at all. */
const PLOT_VIEW_DISTANCE = 420;
/** Labels fade out sooner than the footprint. */
const LABEL_VIEW_DISTANCE = 160;
/** Max plots rendered at once, nearest first. */
const MAX_VISIBLE_PLOTS = 24;

type PlotStyle = 'own' | 'foreign' | 'commons';

function styleFor(plot: LandPlot, selfId: string): PlotStyle {
  if (plotKind(plot) === 'commons') return 'commons';
  return plot.ownerId === selfId ? 'own' : 'foreign';
}

const COLORS: Record<PlotStyle, string> = {
  own: '#22c55e',
  foreign: '#ef4444',
  commons: '#94a3b8',
};

const FILL_OPACITY: Record<PlotStyle, number> = {
  own: 0.07,
  foreign: 0.18,
  commons: 0.12,
};

/** One line material per style, shared by every plot. */
const LINE_MATERIALS: Record<PlotStyle, THREE.LineBasicMaterial> = {
  own: new THREE.LineBasicMaterial({ color: COLORS.own, transparent: true, opacity: 0.85 }),
  foreign: new THREE.LineBasicMaterial({ color: COLORS.foreign, transparent: true, opacity: 0.85 }),
  commons: new THREE.LineBasicMaterial({ color: COLORS.commons, transparent: true, opacity: 0.6 }),
};

function makeFillMaterial(style: PlotStyle, emphasized: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: COLORS[style],
    transparent: true,
    opacity: FILL_OPACITY[style] * (emphasized ? 1.4 : 1),
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const FILL_MATERIALS = new Map<string, THREE.MeshBasicMaterial>();
function fillMaterial(style: PlotStyle, emphasized: boolean): THREE.MeshBasicMaterial {
  const key = `${style}:${emphasized ? 1 : 0}`;
  let m = FILL_MATERIALS.get(key);
  if (!m) {
    m = makeFillMaterial(style, emphasized);
    FILL_MATERIALS.set(key, m);
  }
  return m;
}

function shortId(id: string): string {
  const clean = id.replace(/^peer-/, '');
  return clean.length > 10 ? `${clean.slice(0, 6)}…${clean.slice(-3)}` : clean;
}

/** Project a tangent-frame point onto the Earth surface in world space. */
function tangentToWorld(
  tx: number,
  tz: number,
  ref: ReturnType<typeof getEarthLocalSiteFrame>,
  pose: ReturnType<typeof getEarthPose>,
  extraLift: number,
): [number, number, number] {
  const nx = ref.normal[0] + (ref.right[0] * tx + ref.forward[0] * tz) / EARTH_RADIUS;
  const ny = ref.normal[1] + (ref.right[1] * tx + ref.forward[1] * tz) / EARTH_RADIUS;
  const nz = ref.normal[2] + (ref.right[2] * tx + ref.forward[2] * tz) / EARTH_RADIUS;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
  const r = EARTH_RADIUS + sampleSurfaceLift(un) + extraLift;
  return earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
}

function plotCentreTangent(plot: LandPlot): { tx: number; tz: number } {
  const { cx0, cz0, cx1, cz1 } = plot.cellRect;
  return {
    tx: ((cx0 + cx1) / 2) * PLOT_CELL,
    tz: ((cz0 + cz1) / 2) * PLOT_CELL,
  };
}

export function LandPlotsOverlay({ selfId, emphasized = false }: LandPlotsOverlayProps) {
  const [plots, setPlots] = useState<LandPlot[]>(() => loadLandPlots());
  const [visible, setVisible] = useState(false);
  const [nearby, setNearby] = useState<LandPlot[]>([]);
  useEffect(() => subscribeLandPlots(setPlots), []);
  useEffect(() => subscribeShowLandMarkers(setVisible), []);

  // Distance cull, re-evaluated at ~2 Hz (not per frame).
  const lastCull = useRef(0);
  useFrame((state) => {
    if (!visible) return;
    const now = state.clock.elapsedTime;
    if (now - lastCull.current < 0.5) return;
    lastCull.current = now;
    const pose = getEarthPose();
    const cam = state.camera.position;
    const scored: Array<{ plot: LandPlot; d: number }> = [];
    for (const p of plots) {
      const ref = getEarthLocalSiteFrame(p.anchorId || WORLD_GRID_ORIGIN_ANCHOR);
      const c = plotCentreTangent(p);
      const w = tangentToWorld(c.tx, c.tz, ref, pose, 0);
      const d = Math.hypot(w[0] - cam.x, w[1] - cam.y, w[2] - cam.z);
      const { cx0, cz0, cx1, cz1 } = p.cellRect;
      const halfSpan = 0.5 * Math.hypot((cx1 - cx0) * PLOT_CELL, (cz1 - cz0) * PLOT_CELL);
      if (d - halfSpan <= PLOT_VIEW_DISTANCE) scored.push({ plot: p, d });
    }
    scored.sort((a, b) => a.d - b.d);
    const next = scored.slice(0, MAX_VISIBLE_PLOTS).map((s) => s.plot);
    setNearby((prev) => (
      prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next
    ));
  });

  if (!visible || nearby.length === 0) return null;
  return (
    <group renderOrder={5}>
      {nearby.map((p) => {
        const g = labelGroups.get(p.id);
        return (
          <PlotMarker
            key={p.id}
            plot={p}
            style={styleFor(p, selfId)}
            selfId={selfId}
            emphasized={emphasized}
            labelCentre={g ?? null}
          />
        );
      })}
    </group>
  );
}

/**
 * Group touching same-owner, same-kind plots so a merged holding shows a
 * single nameplate at the centre of its combined footprint instead of one
 * label per parcel. Returns a map of representative plot id → centre.
 */
function computeLabelGroups(plots: LandPlot[]): Map<string, { tx: number; tz: number }> {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const p of plots) parent.set(p.id, p.id);
  for (let i = 0; i < plots.length; i++) {
    for (let j = i + 1; j < plots.length; j++) {
      const a = plots[i], b = plots[j];
      if (a.ownerId !== b.ownerId || plotKind(a) !== plotKind(b)) continue;
      if (!rectsAdjacent(a.cellRect, b.cellRect) && !rectsIntersect(a.cellRect, b.cellRect)) continue;
      const ra = find(a.id), rb = find(b.id);
      if (ra !== rb) parent.set(rb, ra);
    }
  }
  const bounds = new Map<string, { cx0: number; cz0: number; cx1: number; cz1: number }>();
  for (const p of plots) {
    const root = find(p.id);
    const b = bounds.get(root);
    const r = p.cellRect;
    bounds.set(root, b ? {
      cx0: Math.min(b.cx0, r.cx0), cz0: Math.min(b.cz0, r.cz0),
      cx1: Math.max(b.cx1, r.cx1), cz1: Math.max(b.cz1, r.cz1),
    } : { ...r });
  }
  const out = new Map<string, { tx: number; tz: number }>();
  for (const [root, b] of bounds) {
    out.set(root, {
      tx: ((b.cx0 + b.cx1) / 2) * PLOT_CELL,
      tz: ((b.cz0 + b.cz1) / 2) * PLOT_CELL,
    });
  }
  return out;
}


/**
 * Shared pose-change gate: the plot footprints only need rebuilding
 * when the Earth pose actually moved. Rebuilding every frame for every
 * plot was the per-frame stall.
 */
function usePoseGate() {
  const last = useRef<{ c: [number, number, number]; q: [number, number, number, number] } | null>(null);
  return (pose: ReturnType<typeof getEarthPose>, force: boolean): boolean => {
    const q = pose.spinQuat as unknown as [number, number, number, number];
    const prev = last.current;
    const moved = !prev
      || Math.abs(prev.c[0] - pose.center[0]) > 1e-3
      || Math.abs(prev.c[1] - pose.center[1]) > 1e-3
      || Math.abs(prev.c[2] - pose.center[2]) > 1e-3
      || Math.abs(prev.q[0] - q[0]) > 1e-7
      || Math.abs(prev.q[1] - q[1]) > 1e-7
      || Math.abs(prev.q[2] - q[2]) > 1e-7
      || Math.abs(prev.q[3] - q[3]) > 1e-7;
    if (!moved && !force) return false;
    last.current = {
      c: [pose.center[0], pose.center[1], pose.center[2]],
      q: [q[0], q[1], q[2], q[3]],
    };
    return true;
  };
}

function PlotMarker({
  plot,
  style,
  selfId,
  emphasized,
}: {
  plot: LandPlot;
  style: PlotStyle;
  selfId: string;
  emphasized: boolean;
}) {
  const tangentPoints = useMemo(() => {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    const x0 = cx0 * PLOT_CELL, x1 = cx1 * PLOT_CELL;
    const z0 = cz0 * PLOT_CELL, z1 = cz1 * PLOT_CELL;
    const pts: Array<[number, number]> = [];
    const pushSide = (ax: number, az: number, bx: number, bz: number) => {
      for (let i = 0; i < SEGMENTS_PER_SIDE; i++) {
        const t = i / SEGMENTS_PER_SIDE;
        pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    };
    pushSide(x0, z0, x1, z0);
    pushSide(x1, z0, x1, z1);
    pushSide(x1, z1, x0, z1);
    pushSide(x0, z1, x0, z0);
    pts.push([x0, z0]);
    return pts;
  }, [plot.cellRect]);

  const fillTangent = useMemo(() => {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    const x0 = cx0 * PLOT_CELL, x1 = cx1 * PLOT_CELL;
    const z0 = cz0 * PLOT_CELL, z1 = cz1 * PLOT_CELL;
    const N = 6;
    const pts: Array<[number, number]> = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        pts.push([
          x0 + (x1 - x0) * (i / (N - 1)),
          z0 + (z1 - z0) * (j / (N - 1)),
        ]);
      }
    }
    return pts;
  }, [plot.cellRect]);

  const lineGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tangentPoints.length * 3), 3));
    return geo;
  }, [tangentPoints]);

  const fillGeometry = useMemo(() => {
    const N = 6;
    const indices: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = j * N + i + 1, c = (j + 1) * N + i, d = (j + 1) * N + i + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    geo.setIndex(indices);
    return geo;
  }, [fillGeometry_dep(plot)]);

  useEffect(() => () => {
    try { lineGeometry.dispose(); } catch { /* ignore */ }
    try { fillGeometry.dispose(); } catch { /* ignore */ }
  }, [lineGeometry, fillGeometry]);

  const line = useMemo(
    () => new THREE.Line(lineGeometry, LINE_MATERIALS[style]),
    [lineGeometry, style],
  );
  const mesh = useMemo(
    () => new THREE.Mesh(fillGeometry, fillMaterial(style, emphasized)),
    [fillGeometry, style, emphasized],
  );

  const label = style === 'commons'
    ? plot.label || 'Public land'
    : plot.ownerId === selfId
      ? 'Your land'
      : `${shortId(plot.ownerId)}'s land`;

  const sprite = useMemo(() => makeLabelSprite(label, COLORS[style]), [label, style]);
  useEffect(() => () => {
    try { (sprite.material as THREE.SpriteMaterial).map?.dispose(); } catch { /* ignore */ }
    try { (sprite.material as THREE.SpriteMaterial).dispose(); } catch { /* ignore */ }
  }, [sprite]);

  const gate = usePoseGate();
  const first = useRef(true);
  const centre = useMemo(() => plotCentreTangent(plot), [plot]);

  useFrame((state) => {
    const pose = getEarthPose();
    const force = first.current;
    first.current = false;
    if (!gate(pose, force)) return;
    const ref = getEarthLocalSiteFrame(plot.anchorId || WORLD_GRID_ORIGIN_ANCHOR);

    const lineArr = (lineGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < tangentPoints.length; i++) {
      const w = tangentToWorld(tangentPoints[i][0], tangentPoints[i][1], ref, pose, 0.05);
      lineArr[i * 3] = w[0]; lineArr[i * 3 + 1] = w[1]; lineArr[i * 3 + 2] = w[2];
    }
    (lineGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    lineGeometry.computeBoundingSphere();

    const fillArr = (fillGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < fillTangent.length; i++) {
      const w = tangentToWorld(fillTangent[i][0], fillTangent[i][1], ref, pose, 0.03);
      fillArr[i * 3] = w[0]; fillArr[i * 3 + 1] = w[1]; fillArr[i * 3 + 2] = w[2];
    }
    (fillGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    fillGeometry.computeBoundingSphere();

    const lw = tangentToWorld(centre.tx, centre.tz, ref, pose, 1.6);
    sprite.position.set(lw[0], lw[1], lw[2]);
    const cam = state.camera.position;
    const d = Math.hypot(lw[0] - cam.x, lw[1] - cam.y, lw[2] - cam.z);
    sprite.visible = d < LABEL_VIEW_DISTANCE;
  });

  return (
    <>
      <primitive object={line} />
      <primitive object={mesh} />
      <primitive object={sprite} />
    </>
  );
}

/** Stable dependency key for the fill geometry. */
function fillGeometry_dep(plot: LandPlot): string {
  const { cx0, cz0, cx1, cz1 } = plot.cellRect;
  return `${cx0}:${cz0}:${cx1}:${cz1}`;
}

/** Canvas-texture billboard label — no DOM, no occlusion plate. */
function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const pad = 12;
  const fontPx = 34;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.font = `600 ${fontPx}px system-ui, sans-serif`;
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(10,10,18,0.62)';
  const r = h / 2;
  c.beginPath();
  c.moveTo(r, 0);
  c.lineTo(w - r, 0);
  c.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(r, h);
  c.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
  c.closePath();
  c.fill();
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = color;
  c.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scale = 3.2;
  sprite.scale.set((w / h) * scale, scale, 1);
  return sprite;
}

export default LandPlotsOverlay;
