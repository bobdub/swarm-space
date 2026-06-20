/**
 * PlotSurveyOverlay — draws the player's walked trail while plotting
 * land and detects loop closure. Pure r3f; no DOM.
 *
 * Coordinate system: samples live in the lattice-origin tangent frame
 * (WORLD_GRID_ORIGIN_ANCHOR) as `(tx, tz)` metres. They are projected
 * back to world space each frame (`earthLocalToWorld`) so the line
 * follows the spinning planet exactly like the player does.
 *
 * Loop closure: when the latest sample comes within `PLOT_CELL` of the
 * starting sample and the trail has at least 4 samples, the survey
 * closes — the resulting AABB and price are handed up via `onClose`.
 *
 * Foreign-plot rejection: samples that fall inside someone else's plot
 * are dropped (the trail simply stops extending there).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  earthLocalToWorld,
  getEarthPose,
  getEarthLocalSiteFrame,
  worldDisplacementToEarthLocal,
  EARTH_RADIUS,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import {
  PLOT_CELL,
  cellRectFromTrail,
  priceForRect,
  rectBoxCount,
  getPlotAtCell,
  tangentToCell,
  type PendingPlotInfo,
} from '@/lib/world/landPlots';
import type { PendingPlot } from '@/lib/brain/useBrainBuilder';

// Re-export-friendly stand-in (avoid type-only import cycle).
// PendingPlotInfo isn't exported from landPlots; we just satisfy the field
// shape inline above. Keep the import only for type inference convenience.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Touch = PendingPlotInfo;

interface PlotSurveyOverlayProps {
  selfId: string;
  ownerId: string;
  onClose: (next: PendingPlot) => void;
  /** Minimum spacing between trail samples (m). */
  sampleStep?: number;
  /** Max trail samples before forcibly closing (safety). */
  maxSamples?: number;
}

const TRAIL_COLOR = '#fbbf24';
const START_COLOR = '#22c55e';
const REJECT_FLASH_MS = 250;

export function PlotSurveyOverlay({
  selfId,
  ownerId,
  onClose,
  sampleStep = 0.35,
  maxSamples = 600,
}: PlotSurveyOverlayProps) {
  const lineRef = useRef<THREE.Line>(null);
  const startMarkerRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<Array<{ tx: number; tz: number }>>([]);
  const closedRef = useRef(false);
  const rejectFlashUntilRef = useRef(0);

  // Pre-sized buffer; we update `drawRange` to control visible length.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxSamples * 3 + 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, [maxSamples]);

  const material = useMemo(() => new THREE.LineBasicMaterial({
    color: TRAIL_COLOR,
    linewidth: 2,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  }), []);

  // Reset trail when the overlay (re-)mounts.
  useEffect(() => {
    trailRef.current = [];
    closedRef.current = false;
    geometry.setDrawRange(0, 0);
    return () => {
      try { geometry.dispose(); } catch { /* ignore */ }
      try { material.dispose(); } catch { /* ignore */ }
    };
    // Mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    if (closedRef.current) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(selfId);
    if (!body) return;
    const pose = getEarthPose();
    const ref = getEarthLocalSiteFrame(WORLD_GRID_ORIGIN_ANCHOR);

    // Player local position → tangent coords against lattice origin.
    const disp: [number, number, number] = [
      body.pos[0] - pose.center[0],
      body.pos[1] - pose.center[1],
      body.pos[2] - pose.center[2],
    ];
    const local = worldDisplacementToEarthLocal(disp, pose);
    const tx = local[0] * ref.right[0] + local[1] * ref.right[1] + local[2] * ref.right[2];
    const tz = local[0] * ref.forward[0] + local[1] * ref.forward[1] + local[2] * ref.forward[2];

    // Foreign-plot guard.
    const cell = tangentToCell(tx, tz);
    const owning = getPlotAtCell(cell.cx, cell.cz);
    if (owning && owning.ownerId !== ownerId) {
      rejectFlashUntilRef.current = performance.now() + REJECT_FLASH_MS;
      // Don't push — line just stops extending here.
    } else {
      const trail = trailRef.current;
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(tx - last.tx, tz - last.tz) >= sampleStep) {
        if (trail.length < maxSamples) trail.push({ tx, tz });
      }

      // Closure check.
      if (trail.length >= 4) {
        const a = trail[0];
        const b = trail[trail.length - 1];
        if (Math.hypot(b.tx - a.tx, b.tz - a.tz) <= PLOT_CELL) {
          const rect = cellRectFromTrail(trail);
          if (rect && rectBoxCount(rect) > 0) {
            closedRef.current = true;
            const price = priceForRect(rect);
            onClose({
              rect,
              priceSwarm: price,
              boxes: rectBoxCount(rect),
              widthM: (rect.cx1 - rect.cx0) * PLOT_CELL,
              depthM: (rect.cz1 - rect.cz0) * PLOT_CELL,
            });
          }
        }
      }
    }

    // Material tint while rejecting.
    if (performance.now() < rejectFlashUntilRef.current) {
      material.color.set('#ef4444');
    } else {
      material.color.set(TRAIL_COLOR);
    }

    // Rebuild line geometry in world space.
    const trail = trailRef.current;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    let count = 0;
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      // Local position on the unit normal + tangent offsets, lifted to terrain.
      const nx = ref.normal[0] + (ref.right[0] * p.tx + ref.forward[0] * p.tz) / EARTH_RADIUS;
      const ny = ref.normal[1] + (ref.right[1] * p.tx + ref.forward[1] * p.tz) / EARTH_RADIUS;
      const nz = ref.normal[2] + (ref.right[2] * p.tx + ref.forward[2] * p.tz) / EARTH_RADIUS;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
      const lift = sampleSurfaceLift(un);
      const r = EARTH_RADIUS + lift + 0.05;
      const worldPos = earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
      arr[count * 3 + 0] = worldPos[0];
      arr[count * 3 + 1] = worldPos[1];
      arr[count * 3 + 2] = worldPos[2];
      count++;
    }
    posAttr.needsUpdate = true;
    geometry.setDrawRange(0, count);
    geometry.computeBoundingSphere();

    // Start marker — place at the first sample (if any) lifted onto terrain.
    if (startMarkerRef.current && trail.length > 0) {
      const p = trail[0];
      const nx = ref.normal[0] + (ref.right[0] * p.tx + ref.forward[0] * p.tz) / EARTH_RADIUS;
      const ny = ref.normal[1] + (ref.right[1] * p.tx + ref.forward[1] * p.tz) / EARTH_RADIUS;
      const nz = ref.normal[2] + (ref.right[2] * p.tx + ref.forward[2] * p.tz) / EARTH_RADIUS;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const un: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
      const lift = sampleSurfaceLift(un);
      const r = EARTH_RADIUS + lift + 0.1;
      const worldPos = earthLocalToWorld([un[0] * r, un[1] * r, un[2] * r], pose);
      startMarkerRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
      startMarkerRef.current.visible = true;
    } else if (startMarkerRef.current) {
      startMarkerRef.current.visible = false;
    }
  });

  return (
    <group renderOrder={6}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <primitive object={new THREE.Line(geometry, material)} ref={lineRef} />
      <mesh ref={startMarkerRef} visible={false} renderOrder={7}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={START_COLOR} transparent opacity={0.85} depthTest={false} />
      </mesh>
    </group>
  );
}

export default PlotSurveyOverlay;