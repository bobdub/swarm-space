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
 *   - 1 hive + 1 queen + 6 worker bees clustered around hive
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { NATURE_CATALOG, type NatureKind } from './natureCatalog';

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
  const PCX = 0;        // right offset of pond centre
  const PCZ = -30;      // forward offset (negative = behind apartment)

  // ── Pond: 12 water tiles in a soft disc around (PCX, PCZ) ──
  const POND_R = 5.5;
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
    placedFlowers++;
  }

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

  // ── Hive + bees: hive ~22 m forward + 8 m right; queen + 6 workers ──
  const HX = 8, HZ = 22;
  place({
    anchorPeerId,
    kind: 'hive',
    id: 'hive-0',
    rightOffset: HX,
    forwardOffset: HZ,
    meta: { honey: 0, workerCap: 8 },
  });
  ids.push('hive-0');

  place({
    anchorPeerId,
    kind: 'queen_bee',
    id: 'queen-0',
    rightOffset: HX + 0.2,
    forwardOffset: HZ + 0.2,
    meta: { hiveId: 'hive-0' },
  });
  ids.push('queen-0');

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const id = `bee-${i}`;
    place({
      anchorPeerId,
      kind: 'bee',
      id,
      rightOffset: HX + Math.cos(a) * 1.4,
      forwardOffset: HZ + Math.sin(a) * 1.4,
      meta: { hiveId: 'hive-0', state: 'idle' },
    });
    ids.push(id);
  }

  return { anchorPeerId, blockIds: ids };
}