import type { HubPiece } from "@/types";
import { getBuilderItem } from "./builderCatalog";

const ANGLE_TOLERANCE_DEG = 5;

function normalizeYaw(rad: number): number {
  const twoPi = Math.PI * 2;
  let r = rad % twoPi;
  if (r < 0) r += twoPi;
  return r;
}

function nearestRightAngle(rad: number): number {
  const step = Math.PI / 2;
  return Math.round(normalizeYaw(rad) / step) * step;
}

function rightAngleAligned(a: number, b: number): boolean {
  const da = Math.abs(normalizeYaw(a) - nearestRightAngle(a));
  const db = Math.abs(normalizeYaw(b) - nearestRightAngle(b));
  const tolRad = (ANGLE_TOLERANCE_DEG * Math.PI) / 180;
  return da <= tolRad && db <= tolRad;
}

/** Returns the 4 edge midpoints (in world space) on the XZ plane. */
function edgeMidpoints(piece: HubPiece): { x: number; z: number }[] {
  const item = getBuilderItem(piece.kind);
  if (!item) return [];
  const halfW = item.width / 2;
  const halfD = item.depth / 2;
  const cos = Math.cos(piece.rotationY);
  const sin = Math.sin(piece.rotationY);
  const [px, , pz] = piece.position;

  // local edge midpoints: +X, -X, +Z, -Z
  const local = [
    { x: halfW, z: 0 },
    { x: -halfW, z: 0 },
    { x: 0, z: halfD },
    { x: 0, z: -halfD },
  ];
  return local.map((p) => ({
    x: px + p.x * cos + p.z * sin,
    z: pz - p.x * sin + p.z * cos,
  }));
}

export interface SnapResult {
  dx: number;
  dz: number;
  distance: number;
}

/**
 * Find the closest matching edge midpoint between `piece` and any other piece.
 * Returns the world-space delta to apply to `piece.position` to make the edges
 * coincide. Returns null when no neighbour is within `threshold` metres.
 */
export function findSnap(
  piece: HubPiece,
  others: HubPiece[],
  threshold = 0.4,
): SnapResult | null {
  const myEdges = edgeMidpoints(piece);
  if (myEdges.length === 0) return null;

  let best: SnapResult | null = null;
  for (const other of others) {
    if (other.id === piece.id) continue;
    if (!rightAngleAligned(piece.rotationY, other.rotationY)) continue;
    const otherEdges = edgeMidpoints(other);
    for (const m of myEdges) {
      for (const o of otherEdges) {
        const dx = o.x - m.x;
        const dz = o.z - m.z;
        const d = Math.hypot(dx, dz);
        if (d <= threshold && (!best || d < best.distance)) {
          best = { dx, dz, distance: d };
        }
      }
    }
  }
  return best;
}