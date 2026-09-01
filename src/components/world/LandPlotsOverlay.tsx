/**
 * LandPlotsOverlay — renders claimed plot footprints as flat outlined
 * rectangles glued to the Earth-local lattice-origin frame.
 *
 * Always visible (unless the player turns markers off) so ownership is
 * legible while walking, not only while building:
 *   • own plot      → green outline, faint green fill
 *   • foreign plot  → red outline + red fill (no-build)
 *   • commons/road  → slate outline + pale fill (dev-laid public land)
 *
 * Each plot carries a small owner nameplate so the boundary is
 * attributable at a glance.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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

function shortId(id: string): string {
  const clean = id.replace(/^peer-/, '');
  return clean.length > 10 ? `${clean.slice(0, 6)}…${clean.slice(-3)}` : clean;
}

export function LandPlotsOverlay({ selfId, emphasized = false }: LandPlotsOverlayProps) {
  const [plots, setPlots] = useState<LandPlot[]>(() => loadLandPlots());
  const [visible, setVisible] = useState(true);
  useEffect(() => subscribeLandPlots(setPlots), []);
  useEffect(() => subscribeShowLandMarkers(setVisible), []);

  if (!visible || plots.length === 0) return null;
  return (
    <group renderOrder={5}>
      {plots.map((p) => (
        <PlotOutline
          key={p.id}
          plot={p}
          style={styleFor(p, selfId)}
          selfId={selfId}
          emphasized={emphasized}
        />
      ))}
    </group>
  );
}

function PlotOutline({
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
  // Generate the rect perimeter in tangent coords (with sub-segments so
  // the curved Earth surface doesn't show kinks).
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
    pts.push([x0, z0]); // close the loop
    return pts;
  }, [plot.cellRect]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tangentPoints.length * 3), 3));
    return geo;
  }, [tangentPoints]);

  const material = useMemo(
    () => new THREE.LineBasicMaterial({
      color: COLORS[style],
      transparent: true,
      opacity: style === 'commons' ? 0.6 : 0.85,
      depthTest: false,
    }),
    [style],
  );

  useEffect(() => {
    return () => {
      try { geometry.dispose(); } catch { /* ignore */ }
      try { material.dispose(); } catch { /* ignore */ }
    };
  }, [geometry, material]);

  useFrame(() => {
    const pose = getEarthPose();
    const ref = getEarthLocalSiteFrame(plot.anchorId || WORLD_GRID_ORIGIN_ANCHOR);
    const arr = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < tangentPoints.length; i++) {
      const [tx, tz] = tangentPoints[i];
      const nx = ref.normal[0] + (ref.right[0] * tx + ref.forward[0] * tz) / EARTH_RADIUS;
      const ny = ref.normal[1] + (ref.right[1] * tx + ref.forward[1] * tz) / EARTH_RADIUS;
      const nz = ref.normal[2] + (ref.right[2] * tx + ref.forward[2] * tz) / EARTH_RADIUS;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
      const lift = sampleSurfaceLift(un);
      const r = EARTH_RADIUS + lift + 0.04;
      const world = earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
      arr[i * 3 + 0] = world[0];
      arr[i * 3 + 1] = world[1];
      arr[i * 3 + 2] = world[2];
    }
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);
  return (
    <>
      <primitive object={line} />
      <PlotFill plot={plot} style={style} emphasized={emphasized} />
      <PlotNameplate plot={plot} style={style} selfId={selfId} />
    </>
  );
}

function PlotFill({
  plot,
  style,
  emphasized,
}: {
  plot: LandPlot;
  style: PlotStyle;
  emphasized: boolean;
}) {
  const fillGeometry = useMemo(() => {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    const x0 = cx0 * PLOT_CELL, x1 = cx1 * PLOT_CELL;
    const z0 = cz0 * PLOT_CELL, z1 = cz1 * PLOT_CELL;
    // 6x6 grid of vertices so the curved Earth surface doesn't show
    // through the flat quad.
    const N = 6;
    const positions = new Float32Array(N * N * 3);
    const indices: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        const b = j * N + i + 1;
        const c = (j + 1) * N + i;
        const d = (j + 1) * N + i + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const tangent: Array<[number, number]> = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const tx = x0 + (x1 - x0) * (i / (N - 1));
        const tz = z0 + (z1 - z0) * (j / (N - 1));
        tangent.push([tx, tz]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    (geo as unknown as { _tangent: Array<[number, number]> })._tangent = tangent;
    return geo;
  }, [plot.cellRect]);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: COLORS[style],
      transparent: true,
      opacity: FILL_OPACITY[style] * (emphasized ? 1.4 : 1),
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    [style, emphasized],
  );

  useEffect(() => {
    return () => {
      try { fillGeometry.dispose(); } catch { /* ignore */ }
      try { material.dispose(); } catch { /* ignore */ }
    };
  }, [fillGeometry, material]);

  useFrame(() => {
    const pose = getEarthPose();
    const ref = getEarthLocalSiteFrame(plot.anchorId || WORLD_GRID_ORIGIN_ANCHOR);
    const arr = (fillGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const tangent = (fillGeometry as unknown as { _tangent: Array<[number, number]> })._tangent;
    for (let i = 0; i < tangent.length; i++) {
      const [tx, tz] = tangent[i];
      const nx = ref.normal[0] + (ref.right[0] * tx + ref.forward[0] * tz) / EARTH_RADIUS;
      const ny = ref.normal[1] + (ref.right[1] * tx + ref.forward[1] * tz) / EARTH_RADIUS;
      const nz = ref.normal[2] + (ref.right[2] * tx + ref.forward[2] * tz) / EARTH_RADIUS;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
      const lift = sampleSurfaceLift(un);
      const r = EARTH_RADIUS + lift + 0.03;
      const world = earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
      arr[i * 3 + 0] = world[0];
      arr[i * 3 + 1] = world[1];
      arr[i * 3 + 2] = world[2];
    }
    (fillGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    fillGeometry.computeBoundingSphere();
  });

  const mesh = useMemo(() => new THREE.Mesh(fillGeometry, material), [fillGeometry, material]);
  return <primitive object={mesh} />;
}

/**
 * Owner nameplate — a small billboard pinned above the plot centre so
 * the boundary is attributable without opening any panel.
 */
function PlotNameplate({
  plot,
  style,
  selfId,
}: {
  plot: LandPlot;
  style: PlotStyle;
  selfId: string;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const centre = useMemo(() => {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    return {
      tx: ((cx0 + cx1) / 2) * PLOT_CELL,
      tz: ((cz0 + cz1) / 2) * PLOT_CELL,
    };
  }, [plot.cellRect]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    const ref = getEarthLocalSiteFrame(plot.anchorId || WORLD_GRID_ORIGIN_ANCHOR);
    const nx = ref.normal[0] + (ref.right[0] * centre.tx + ref.forward[0] * centre.tz) / EARTH_RADIUS;
    const ny = ref.normal[1] + (ref.right[1] * centre.tx + ref.forward[1] * centre.tz) / EARTH_RADIUS;
    const nz = ref.normal[2] + (ref.right[2] * centre.tx + ref.forward[2] * centre.tz) / EARTH_RADIUS;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
    const r = EARTH_RADIUS + sampleSurfaceLift(un) + 1.6;
    const world = earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
    g.position.set(world[0], world[1], world[2]);
  });

  const label =
    style === 'commons'
      ? plot.label || 'Public land'
      : plot.ownerId === selfId
        ? 'Your land'
        : `${shortId(plot.ownerId)}'s land`;

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={26} occlude="blending" zIndexRange={[8, 0]}>
        <div
          style={{ borderColor: COLORS[style], color: COLORS[style] }}
          className="pointer-events-none whitespace-nowrap rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm"
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

export default LandPlotsOverlay;
