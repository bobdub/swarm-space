/**
 * ═══════════════════════════════════════════════════════════════════════
 * VOLCANO SEED — pressure release made visible
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The lava mantle accumulates pressure under convergent plate seams. That
 * pressure has to leave somewhere; the geologically correct answer is a
 * volcano. We do *not* extrude geometry from the field. We seed
 * BuilderBlockEngine volcano blocks at convergent seam midpoints (from
 * `getVolcanoSites`) that fall within walking distance of the village
 * anchor. The renderer in `NatureLayer.tsx` paints them as cones with a
 * glowing vent.
 *
 * Deterministic — identical anchor + identical plates → identical layout.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import {
  getEarthLocalSiteFrame,
  EARTH_RADIUS,
} from '@/lib/brain/earth';
import { getVolcanoSites } from '@/lib/brain/tectonics';
import { NATURE_CATALOG } from './natureCatalog';

const VOLCANO_TAG = 'nature.biome.v1';
/** Maximum tangent distance (m) from the village anchor to a vent. */
const REACH = 260;
/** Cap so we don't carpet the village in cones. */
const MAX_VOLCANOES = 8;

export interface SeededVolcanoes {
  anchorPeerId: string;
  blockIds: string[];
}

export function seedVolcanoes(anchorPeerId: string): SeededVolcanoes {
  const engine = getBuilderBlockEngine();
  const lf = getEarthLocalSiteFrame(anchorPeerId);
  const spec = NATURE_CATALOG.volcano;
  const ids: string[] = [];
  const sites = getVolcanoSites();

  // Project each global vent normal into the village local tangent frame.
  type Cand = { id: string; rightOffset: number; forwardOffset: number; height: number };
  const cands: Cand[] = [];

  for (let i = 0; i < sites.length; i++) {
    const n = sites[i];
    // Express n in the local frame: components along normal/right/forward.
    const dotN = n[0] * lf.normal[0] + n[1] * lf.normal[1] + n[2] * lf.normal[2];
    if (dotN <= 0) continue; // hemisphere check — skip antipodal vents
    const dotR = n[0] * lf.right[0] + n[1] * lf.right[1] + n[2] * lf.right[2];
    const dotF = n[0] * lf.forward[0] + n[1] * lf.forward[1] + n[2] * lf.forward[2];
    // Tangent offset in metres = arc length on the EARTH_RADIUS sphere.
    const tx = dotR * EARTH_RADIUS;
    const tz = dotF * EARTH_RADIUS;
    const dist = Math.hypot(tx, tz);
    if (dist > REACH) continue;
    // Height — vents over the strongest seams are tallest. We use 1-dotN
    // as a cheap angular-spread proxy; near 0 = vent right under village.
    const height = 14 + 10 * Math.min(1, 1 - dotN);
    cands.push({
      id: `volcano-${i}`,
      rightOffset: tx,
      forwardOffset: tz,
      height,
    });
  }

  cands.sort((a, b) => b.height - a.height);
  const picked = cands.slice(0, MAX_VOLCANOES);

  for (const c of picked) {
    engine.placeBlock({
      id: c.id,
      kind: 'volcano',
      anchorPeerId,
      rightOffset: c.rightOffset,
      forwardOffset: c.forwardOffset,
      mass: spec.mass,
      basin: spec.basin,
      meta: {
        biome: VOLCANO_TAG,
        species: 'volcano',
        height: c.height,
      },
    });
    ids.push(c.id);
  }

  return { anchorPeerId, blockIds: ids };
}