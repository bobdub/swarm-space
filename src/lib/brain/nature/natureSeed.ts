/**
 * Deterministic starter biome — Phase 2.
 *
 * `seedDefaultBiome(anchorPeerId)` places the static nature pieces via
 * `builderBlockEngine.placeBlock`. Same anchor → identical layout
 * (golden-angle scatter, hashed by anchor). No behavior, no motion.
 *
 * Biome composition:
 *   - 1 pond (cluster of water tiles)
 *   - 18 flowers
 *   - 30 grass blades
 *   - 10 tree seeds (rendered as mature trees in Phase 2)
 *   - 10 fish (7 ♀ + 3 ♂) clustered inside the pond
 *   - 1 hive hanging from a branch of the tree nearest the meadow's
 *     north-east corner, + 1 queen + 8 worker bees that forage the flowers
 *   - 8 granite boulders (gatherable stone), kept off the pond and hive
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { hiveSpotOnTree } from '@/lib/brain/nature/hiveRehome';
import { buildGrowthLayout, registerGrowthLayout, type Spot } from '@/lib/brain/nature/natureGrowth';
import { NATURE_CATALOG, type NatureKind } from './natureCatalog';
import { POND_CENTRE, POND_RADIUS } from './pond';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Deterministic [0,1) PRNG seeded by string. */
function rng(seed: string): () => number {
  let s = hash32(seed) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Sentinel meta tag so we can tell biome-placed blocks apart from one-offs. */
const BIOME_TAG = 'nature.biome.v1';

interface PlaceArgs {
  anchorPeerId: string;
  kind: NatureKind;
  id: string;
  rightOffset: number;
  forwardOffset: number;
  meta?: Record<string, unknown>;
}

function place({ anchorPeerId, kind, id, rightOffset, forwardOffset, meta }: PlaceArgs) {
  const spec = NATURE_CATALOG[kind];
  return getBuilderBlockEngine().placeBlock({
    id,
    kind,
    anchorPeerId,
    rightOffset,
    forwardOffset,
    mass: spec.mass,
    basin: spec.basin,
    meta: { ...(meta ?? {}), biome: BIOME_TAG, species: kind },
  });
}

export interface SeededBiome {
  anchorPeerId: string;
  blockIds: string[];
}

/**
 * Place the default biome. Idempotent — re-calling with the same anchor
 * is a no-op because BuilderBlockEngine.placeBlock returns the existing
 * handle when the body id is already registered.
 */
export function seedDefaultBiome(anchorPeerId: string): SeededBiome {
  const r = rng(`biome:${anchorPeerId}`);
  const ids: string[] = [];

  // Pond centre — 30 m forward, 0 m right (opposite side of the apartment).
  const PCX = POND_CENTRE.right;     // right offset of pond centre
  const PCZ = POND_CENTRE.forward;   // forward offset (negative = behind apartment)

  // ── Pond: 12 water tiles in a soft disc around (PCX, PCZ) ──
  const POND_R = POND_RADIUS;
  for (let i = 0; i < 12; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = Math.sqrt((i + 0.5) / 12) * POND_R;
    const id = `water-${i}`;
    place({
      anchorPeerId,
      kind: 'water',
      id,
      rightOffset: PCX + Math.cos(a) * rr,
      forwardOffset: PCZ + Math.sin(a) * rr,
    });
    ids.push(id);
  }

  // ── Grass: 30 blades scattered in a 25 m disc around the village ──
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2;
    const rr = 6 + r() * 19;
    const id = `grass-${i}`;
    place({
      anchorPeerId,
      kind: 'grass',
      id,
      rightOffset: Math.cos(a) * rr,
      forwardOffset: Math.sin(a) * rr,
    });
    ids.push(id);
  }

  // ── Flowers: 18 around the meadow, kept off the pond ──
  const flowerSpots: Spot[] = [];
  let placedFlowers = 0;
  for (let i = 0; placedFlowers < 18 && i < 200; i++) {
    const a = r() * Math.PI * 2;
    const rr = 8 + r() * 16;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (Math.hypot(x - PCX, z - PCZ) < POND_R + 1) continue;
    const id = `flower-${placedFlowers}`;
    place({
      anchorPeerId,
      kind: 'flower',
      id,
      rightOffset: x,
      forwardOffset: z,
      meta: { compound: ['carotenoid', 'anthocyanin', 'chlorophyll'][placedFlowers % 3] },
    });
    ids.push(id);
    flowerSpots.push({ x, z });
    placedFlowers++;
  }

  const trees: { id: string; x: number; z: number }[] = [];
  // ── Trees: 10 in a wide ring (the tile-pinned `tree-01` legacy id is
  // also already placed by SurfaceTree; we skip that one to avoid id collision). ──
  for (let i = 0; i < 10; i++) {
    const a = i * GOLDEN_ANGLE + 0.5;
    const rr = 14 + (i % 3) * 4;
    const id = `tree-${i}`;  // tree-01 may collide with SurfaceTree; engine is idempotent so the duplicate is a no-op.
    place({
      anchorPeerId,
      kind: 'tree',
      id,
      rightOffset: Math.cos(a) * rr,
      forwardOffset: Math.sin(a) * rr,
      meta: { stage: 'mature' },
    });
    trees.push({ id, x: Math.cos(a) * rr, z: Math.sin(a) * rr });
    ids.push(id);
  }

  // ── Fish: 10 inside the pond (7 female, 3 male) ──
  for (let i = 0; i < 10; i++) {
    const a = r() * Math.PI * 2;
    const rr = r() * (POND_R - 0.6);
    const id = `fish-${i}`;
    place({
      anchorPeerId,
      kind: 'fish',
      id,
      rightOffset: PCX + Math.cos(a) * rr,
      forwardOffset: PCZ + Math.sin(a) * rr,
      meta: { sex: i < 7 ? 'female' : 'male' },
    });
    ids.push(id);
  }

  // ── Hive + bees: wild hives hang from a branch, not sit on the grass.
  // Pick the tree closest to the hive's old meadow spot and hang the hive
  // HIVE_REACH metres out along a branch, on the side facing the village so
  // it is in view. The renderer draws the branch back to the trunk. ──
  const OLD_HX = 8, OLD_HZ = 22;
  const host = trees.reduce((best, t) =>
    Math.hypot(t.x - OLD_HX, t.z - OLD_HZ) < Math.hypot(best.x - OLD_HX, best.z - OLD_HZ) ? t : best);
  const spot = hiveSpotOnTree(host);
  const HX = spot.x;
  const HZ = spot.z;
  place({
    anchorPeerId,
    kind: 'hive',
    id: 'hive-0',
    rightOffset: HX,
    forwardOffset: HZ,
    meta: {
      honey: 0,
      workerCap: WORKER_BEES,
      treeId: `tree:${host.id}`,
      // Trunk position relative to the hive, in the hive's right/forward frame.
      trunkRight: spot.trunkRight,
      trunkForward: spot.trunkForward,
    },
  });
  ids.push('hive-0');

  place({
    anchorPeerId,
    kind: 'queen_bee',
    id: 'queen-0',
    rightOffset: HX,
    forwardOffset: HZ,
    meta: { hiveId: 'hive-0' },
  });
  ids.push('queen-0');

  for (let i = 0; i < WORKER_BEES; i++) {
    const a = (i / WORKER_BEES) * Math.PI * 2;
    const id = `bee-${i}`;
    place({
      anchorPeerId,
      kind: 'bee',
      id,
      rightOffset: HX + Math.cos(a) * 1.4,
      forwardOffset: HZ + Math.sin(a) * 1.4,
      meta: { hiveId: 'hive-0', state: 'foraging', worker: i },
    });
    ids.push(id);
  }

  // ── Stone: granite boulders scattered round the meadow. Each carries a
  // size + shape seed so the renderer can build a unique procedural rock
  // (no imported model). Placed last so earlier species keep their layout.
  const stoneSpots: Spot[] = [];
  let placedStones = 0;
  for (let i = 0; placedStones < STONE_COUNT && i < 200; i++) {
    const a = r() * Math.PI * 2;
    const rr = 10 + r() * 16;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const size = 0.55 + r() * 0.5;
    const shapeSeed = Math.floor(r() * 0x7fffffff);
    if (Math.hypot(x - PCX, z - PCZ) < POND_R + 2) continue;
    if (Math.hypot(x - HX, z - HZ) < 4) continue;
    const id = `stone-${placedStones}`;
    place({
      anchorPeerId,
      kind: 'stone',
      id,
      rightOffset: x,
      forwardOffset: z,
      meta: { size, shapeSeed },
    });
    ids.push(id);
    stoneSpots.push({ x, z });
    placedStones++;
  }

  // ── Growth: seed spots around the starter trees and flowers, where new
  // trees and flowers come and go on the shared clock (see natureGrowth).
  // Kept off the pond, the boulders and the village centre. ──
  registerGrowthLayout(anchorPeerId, {
    ...buildGrowthLayout(
      anchorPeerId,
      trees,
      flowerSpots,
      [
        { c: { x: PCX, z: PCZ }, r: POND_R + 1.5 },
        { c: { x: 0, z: 0 }, r: 8 },
        ...stoneSpots.map((c) => ({ c, r: 1.8 })),
      ],
    ),
    starters: trees.map((t) => ({ id: `tree:${t.id}`, x: t.x, z: t.z })),
    hiveHost: `tree:${host.id}`,
  });

  return { anchorPeerId, blockIds: ids };
}

/** How far out along its branch the hive hangs from the trunk (m). */
export { HIVE_REACH } from '@/lib/brain/nature/hiveRehome';

/** Worker bees that forage from the hive. */
export const WORKER_BEES = 8;

/** How many gatherable boulders the starter biome scatters. */
export const STONE_COUNT = 8;