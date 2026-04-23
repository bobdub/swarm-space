/**
 * ═══════════════════════════════════════════════════════════════════════
 * MOUNTAIN SEED — Phase 3 of the Earth's-Core plan
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Mountains are crust uplifted at *convergent* plate boundaries. We do
 * not extrude geometry from the field — we let the existing
 * `builderBlockEngine` place mountain blocks at tangent-plane offsets
 * around the village anchor, seeded only where `boundaryInfo(normal)`
 * reports a convergent seam within a small angular window.
 *
 * Heights are proportional to the local "closing speed" of the two
 * plates (recovered from the same drift vectors `boundaryInfo` uses to
 * classify the boundary), passed via `meta.height`. The renderer in
 * NatureLayer reads that field and scales the cone.
 *
 * Deterministic — same anchor + same plates → identical layout.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getEarthLocalSiteFrame, EARTH_RADIUS } from '@/lib/brain/earth';
import { boundaryInfo, getPlates } from '@/lib/brain/tectonics';
import { NATURE_CATALOG } from './natureCatalog';

const MOUNTAIN_TAG = 'nature.biome.v1';

/** Candidate ring radii (m) and step counts around the anchor. */
const RINGS: { radius: number; steps: number }[] = [
  { radius: 80,  steps: 24 },
  { radius: 140, steps: 36 },
  { radius: 220, steps: 48 },
];

/** Maximum angular distance (radians) from a convergent seam to seed. */
const SEAM_WINDOW = 0.04;

/** Cap so we don't carpet the planet. */
const MAX_MOUNTAINS = 24;

/** Recover closing speed for a given normal (mirrors tectonics.boundaryInfo). */
function closingAt(normal: [number, number, number]): number {
  const info = boundaryInfo(normal);
  if (info.boundaryKind !== 'convergent') return 0;
  const ps = getPlates();
  const a = ps[info.plateId];
  const b = ps[info.neighbourId];
  const seamX = b.centerNormal[0] - a.centerNormal[0];
  const seamY = b.centerNormal[1] - a.centerNormal[1];
  const seamZ = b.centerNormal[2] - a.centerNormal[2];
  const sn = Math.hypot(seamX, seamY, seamZ) || 1;
  const sx = seamX / sn, sy = seamY / sn, sz = seamZ / sn;
  const aAlong = a.drift[0] * sx + a.drift[1] * sy + a.drift[2] * sz;
  const bAlong = b.drift[0] * sx + b.drift[1] * sy + b.drift[2] * sz;
  return Math.max(0, aAlong - bAlong);
}

export interface SeededMountains {
  anchorPeerId: string;
  blockIds: string[];
}

/**
 * Place mountain blocks along convergent plate seams within walking
 * distance of the village anchor. Idempotent (engine.placeBlock returns
 * the existing block on duplicate id).
 */
export function seedMountains(anchorPeerId: string): SeededMountains {
  const engine = getBuilderBlockEngine();
  const lf = getEarthLocalSiteFrame(anchorPeerId);
  const spec = NATURE_CATALOG.mountain;
  const ids: string[] = [];

  // Score every candidate site, keep the strongest convergent ones.
  type Cand = {
    id: string;
    rightOffset: number;
    forwardOffset: number;
    height: number;
    basin: number;
  };
  const cands: Cand[] = [];

  for (const ring of RINGS) {
    for (let s = 0; s < ring.steps; s++) {
      const a = (s / ring.steps) * Math.PI * 2;
      const tx = Math.cos(a) * ring.radius;
      const tz = Math.sin(a) * ring.radius;
      // Surface normal at this tangent offset, on the unit sphere.
      const nx = lf.normal[0] * EARTH_RADIUS + lf.right[0] * tx + lf.forward[0] * tz;
      const ny = lf.normal[1] * EARTH_RADIUS + lf.right[1] * tx + lf.forward[1] * tz;
      const nz = lf.normal[2] * EARTH_RADIUS + lf.right[2] * tx + lf.forward[2] * tz;
      const len = Math.hypot(nx, ny, nz) || 1;
      const normal: [number, number, number] = [nx / len, ny / len, nz / len];

      const info = boundaryInfo(normal);
      if (info.boundaryKind !== 'convergent') continue;
      if (info.boundaryDistance > SEAM_WINDOW) continue;

      const closing = closingAt(normal);
      if (closing <= 0) continue;

      // Falloff toward the seam centre — peaks near the boundary itself.
      const proximity = 1 - info.boundaryDistance / SEAM_WINDOW;
      // Height scales with closing × proximity. Range ~6 .. ~24 m.
      const height = 6 + 18 * Math.min(1, closing) * proximity;
      // Bigger mountains get a wider basin (more crust pinned beneath).
      const basin = spec.basin * (0.6 + height / 24);

      cands.push({
        id: `mountain-r${ring.radius}-s${s}`,
        rightOffset: tx,
        forwardOffset: tz,
        height,
        basin,
      });
    }
  }

  // Prefer the tallest. Cap total count so we don't spam the engine.
  cands.sort((a, b) => b.height - a.height);
  const picked = cands.slice(0, MAX_MOUNTAINS);

  for (const c of picked) {
    engine.placeBlock({
      id: c.id,
      kind: 'mountain',
      anchorPeerId,
      rightOffset: c.rightOffset,
      forwardOffset: c.forwardOffset,
      mass: spec.mass,
      basin: c.basin,
      meta: {
        biome: MOUNTAIN_TAG,
        species: 'mountain',
        height: c.height,
      },
    });
    ids.push(c.id);
  }

  return { anchorPeerId, blockIds: ids };
}
