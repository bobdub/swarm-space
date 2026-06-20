/**
 * LandPlotsOverlay — renders claimed plot footprints as flat outlined
 * rectangles glued to the Earth-local lattice-origin frame.
 *
 * Visible whenever Builder Mode is on. Own plots use a green tint;
 * foreign plots use a red tint so the no-build boundary is obvious.
 */
import { useEffect, useMemo, useState } from 'react';
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
  type LandPlot,
} from '@/lib/world/landPlots';

interface LandPlotsOverlayProps {
  selfId: string;
}

const SEGMENTS_PER_SIDE = 6;

export function LandPlotsOverlay({ selfId }: LandPlotsOverlayProps) {
  const [plots, setPlots] = useState<LandPlot[]>(() => loadLandPlots());
  useEffect(() => subscribeLandPlots(setPlots), []);

  if (plots.length === 0) return null;
  return (
    <group renderOrder={5}>
      {plots.map((p) => (
        <PlotOutline key={p.id} plot={p} isOwn={p.ownerId === selfId} />
      ))}
    </group>
  );
}

function PlotOutline({ plot, isOwn }: { plot: LandPlot; isOwn: boolean }) {
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
      color: isOwn ? '#22c55e' : '#ef4444',
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    }),
    [isOwn],
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
  return <primitive object={line} />;
}

export default LandPlotsOverlay;