/**
 * natureGrowth — trees drop seeds that grow into new trees, flowers spread,
 * and grown trees bear fruit.
 *
 * Everything here is a pure function of the shared clock and the starter
 * layout, so every peer sees the same seedling at the same spot at the
 * same size without sending anything over the network:
 *
 *   - Around the starter trees there are fixed "seed spots". Each spot runs
 *     its own staggered life cycle: a seed falls from the nearest parent
 *     tree, sprouts, grows into a full tree, stands for hours, then dies
 *     back and the spot lies empty until the next seed falls.
 *   - Flower spots do the same on a shorter cycle around the starter
 *     flowers: bud, bloom, wilt.
 *   - Every grown tree ripens a crop of fruit on its own repeating timer.
 *
 * What one player takes (a felled young tree, a picked flower, picked
 * fruit) stays gone for that player until the spot's next cycle, the same
 * way chopping and gathering are local today.
 */
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { NATURE_CATALOG } from '@/lib/brain/nature/natureCatalog';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Tree spot life cycle. */
export const TREE_CYCLE_MS = 6 * HOUR;
/** How long a spot's tree stands, from seed to dying back. */
export const TREE_LIFE_MS = 5 * HOUR;
/** Seed to full-grown tree. */
export const TREE_GROW_MS = 40 * MIN;
/** The seed lies on the ground this long before it sprouts. */
export const TREE_SEED_MS = 2 * MIN;
/** How long the seed takes to fall from the parent's canopy. */
export const SEED_FALL_MS = 2500;
/** An old tree withers away over this long at the end of its life. */
export const TREE_DIE_MS = MIN;

/** Flower spot life cycle. */
export const FLOWER_CYCLE_MS = 90 * MIN;
export const FLOWER_LIFE_MS = 80 * MIN;
export const FLOWER_BUD_MS = 4 * MIN;
export const FLOWER_WILT_MS = 3 * MIN;

/** Fruit: every grown tree ripens a crop on this repeating timer. */
export const FRUIT_PERIOD_MS = 45 * MIN;
/** Fruit swells green for this long, then is ripe for the rest of the period. */
export const FRUIT_GROW_MS = 20 * MIN;
export const FRUIT_PER_TREE = 3;

export const TREE_SPOTS = 12;
export const FLOWER_SPOTS = 16;

const BIOME_TAG = 'nature.biome.v1';

export interface Spot { x: number; z: number }

export interface GrowthSpot extends Spot {
  /** Where the parent stands (seed falls from it). */
  parent: Spot;
  /** Phase offset into the cycle (ms), so spots are staggered. */
  offset: number;
}

export interface GrowthLayout {
  trees: GrowthSpot[];
  flowers: GrowthSpot[];
}

function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function rng(seed: string): () => number {
  let s = hash32(seed) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function spread(
  key: string,
  parents: Spot[],
  count: number,
  minD: number,
  maxD: number,
  spacing: number,
  avoid: { c: Spot; r: number }[],
  cycle: number,
): GrowthSpot[] {
  const out: GrowthSpot[] = [];
  if (parents.length === 0) return out;
  const taken: Spot[] = [...parents];
  for (let i = 0; i < count; i++) {
    const r = rng(`${key}:${i}`);
    const parent = parents[i % parents.length];
    for (let attempt = 0; attempt < 32; attempt++) {
      const a = r() * Math.PI * 2;
      const d = minD + r() * (maxD - minD);
      const x = parent.x + Math.cos(a) * d;
      const z = parent.z + Math.sin(a) * d;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < spacing)) continue;
      if (avoid.some((v) => Math.hypot(v.c.x - x, v.c.z - z) < v.r)) continue;
      const spot: GrowthSpot = { x, z, parent, offset: Math.floor(r() * cycle) };
      out.push(spot);
      taken.push(spot);
      break;
    }
  }
  return out;
}

/**
 * Seed spots around the starter trees and flowers. Pure: the same starter
 * layout always gives the same spots.
 */
export function buildGrowthLayout(
  anchorPeerId: string,
  trees: Spot[],
  flowers: Spot[],
  avoid: { c: Spot; r: number }[] = [],
): GrowthLayout {
  return {
    trees: spread(`growth-tree:${anchorPeerId}`, trees, TREE_SPOTS, 4.5, 9, 3.4, avoid, TREE_CYCLE_MS),
    flowers: spread(`growth-flower:${anchorPeerId}`, flowers, FLOWER_SPOTS, 1.2, 3.6, 1.0, avoid, FLOWER_CYCLE_MS),
  };
}

const layouts = new Map<string, GrowthLayout>();

/** Called by the starter biome seed with where it put things. */
export function registerGrowthLayout(anchorPeerId: string, layout: GrowthLayout): void {
  if (!layouts.has(anchorPeerId)) layouts.set(anchorPeerId, layout);
}

export function getGrowthLayout(anchorPeerId: string): GrowthLayout | undefined {
  return layouts.get(anchorPeerId);
}

export interface CycleState {
  cycle: number;
  /** Shared-clock time the current cycle began (ms). */
  start: number;
  /** ms since the cycle began. */
  age: number;
  alive: boolean;
}

export function cycleAt(now: number, offset: number, cycleMs: number, lifeMs: number): CycleState {
  const cycle = Math.floor((now + offset) / cycleMs);
  const start = cycle * cycleMs - offset;
  const age = now - start;
  return { cycle, start, age, alive: age < lifeMs };
}

// ── Growth readings used by renderers and tools ─────────────────────────

interface GrowthMeta { start: number; life: number; grow: number }

function growthMeta(block: Pick<BuilderBlock, 'meta'>): GrowthMeta | null {
  const g = block.meta?.growth as GrowthMeta | undefined;
  return g && typeof g.start === 'number' ? g : null;
}

/** How grown a tree is: 0 = seed on the ground, 1 = full tree. Starter trees are 1. */
export function treeGrowth(block: Pick<BuilderBlock, 'meta'>, now: number): number {
  const g = growthMeta(block);
  if (!g) return 1;
  const age = now - g.start;
  if (age < TREE_SEED_MS) return 0;
  return Math.min(1, (age - TREE_SEED_MS) / (g.grow - TREE_SEED_MS));
}

/** True when a tree is full grown: it can be chopped, hold a hive and fruit. */
export function isTreeGrown(block: Pick<BuilderBlock, 'meta'>, now: number): boolean {
  return treeGrowth(block, now) >= 1;
}

/** ms until a grown tree dies back; Infinity for starter trees. */
export function treeLifeLeft(block: Pick<BuilderBlock, 'meta'>, now: number): number {
  const g = growthMeta(block);
  return g ? g.start + g.life - now : Infinity;
}

/** 1 for most of its life; falls to 0 as an old tree withers at the end. */
export function treeVigour(block: Pick<BuilderBlock, 'meta'>, now: number): number {
  const g = growthMeta(block);
  if (!g) return 1;
  const left = g.start + g.life - now;
  return Math.max(0, Math.min(1, left / TREE_DIE_MS));
}

/** Flower size through its cycle: buds up, blooms, wilts. Starter flowers are 1. */
export function flowerBloom(block: Pick<BuilderBlock, 'meta'>, now: number): number {
  const g = growthMeta(block);
  if (!g) return 1;
  const age = now - g.start;
  const up = Math.min(1, Math.max(0, age / FLOWER_BUD_MS));
  const down = Math.min(1, Math.max(0, (g.life - age) / FLOWER_WILT_MS));
  return Math.min(up, down);
}

export interface FruitState {
  /** Which crop this is; picking marks this crop taken. */
  crop: number;
  /** 0..1 how far the fruit has swelled. */
  size: number;
  ripe: boolean;
}

/** The fruit on a grown tree right now (same on every peer). */
export function fruitAt(treeBodyId: string, now: number): FruitState {
  const offset = hash32(`fruit:${treeBodyId}`) % FRUIT_PERIOD_MS;
  const crop = Math.floor((now + offset) / FRUIT_PERIOD_MS);
  const age = now + offset - crop * FRUIT_PERIOD_MS;
  return { crop, size: Math.min(1, age / FRUIT_GROW_MS), ripe: age >= FRUIT_GROW_MS };
}

const picked = new Map<string, number>();

/** True if this player already picked the current crop from this tree. */
export function isFruitPicked(treeBodyId: string, crop: number): boolean {
  return picked.get(treeBodyId) === crop;
}

export function markFruitPicked(treeBodyId: string, crop: number): void {
  picked.set(treeBodyId, crop);
}

export interface FruitPick { ok: boolean; count: number; reason?: 'unripe' | 'picked' | 'young' }

/**
 * Pick the fruit off a tree. Returns how many came away; the caller
 * credits the player.
 */
export function pickFruit(tree: Pick<BuilderBlock, 'bodyId' | 'meta'>, now: number): FruitPick {
  if (!isTreeGrown(tree, now)) return { ok: false, count: 0, reason: 'young' };
  const f = fruitAt(tree.bodyId, now);
  if (!f.ripe) return { ok: false, count: 0, reason: 'unripe' };
  if (isFruitPicked(tree.bodyId, f.crop)) return { ok: false, count: 0, reason: 'picked' };
  markFruitPicked(tree.bodyId, f.crop);
  return { ok: true, count: FRUIT_PER_TREE };
}

// ── Keeping the world in step with the clock ────────────────────────────

/** Growth blocks this session has placed. One taken by a player is not put back. */
const placed = new Set<string>();

function place(anchorPeerId: string, kind: 'tree' | 'flower', id: string, spot: GrowthSpot, meta: Record<string, unknown>) {
  const spec = NATURE_CATALOG[kind];
  return getBuilderBlockEngine().placeBlock({
    id,
    kind,
    anchorPeerId,
    rightOffset: spot.x,
    forwardOffset: spot.z,
    mass: spec.mass,
    basin: spec.basin,
    meta: { ...meta, biome: BIOME_TAG, species: kind },
  });
}

/**
 * Bring the growing trees and flowers in line with the clock: plant what
 * should be there now, clear what has died back. Safe to call often.
 */
export function syncNatureGrowth(anchorPeerId: string, now = Date.now()): void {
  const layout = layouts.get(anchorPeerId);
  if (!layout) return;
  const engine = getBuilderBlockEngine();
  const want = new Set<string>();

  layout.trees.forEach((spot, i) => {
    const c = cycleAt(now, spot.offset, TREE_CYCLE_MS, TREE_LIFE_MS);
    if (!c.alive) return;
    const id = `grown-tree-${i}-c${c.cycle}`;
    const bodyId = `tree:${id}`;
    want.add(bodyId);
    if (placed.has(bodyId)) return;
    placed.add(bodyId);
    place(anchorPeerId, 'tree', id, spot, {
      stage: 'growing',
      spot: i,
      growth: { start: c.start, life: TREE_LIFE_MS, grow: TREE_GROW_MS },
      // Parent trunk relative to this spot, for the falling seed.
      parentRight: spot.parent.x - spot.x,
      parentForward: spot.parent.z - spot.z,
    });
  });

  layout.flowers.forEach((spot, i) => {
    const c = cycleAt(now, spot.offset, FLOWER_CYCLE_MS, FLOWER_LIFE_MS);
    if (!c.alive) return;
    const id = `grown-flower-${i}-c${c.cycle}`;
    const bodyId = `flower:${id}`;
    want.add(bodyId);
    if (placed.has(bodyId)) return;
    placed.add(bodyId);
    place(anchorPeerId, 'flower', id, spot, {
      spot: i,
      compound: ['carotenoid', 'anthocyanin', 'chlorophyll'][i % 3],
      growth: { start: c.start, life: FLOWER_LIFE_MS, grow: FLOWER_BUD_MS },
    });
  });

  // Clear growth that has died back (or whose spot has started a new cycle).
  for (const b of engine.listBlocks((x) =>
    x.anchorPeerId === anchorPeerId && typeof x.id === 'string' && x.id.startsWith('grown-'))) {
    if (!want.has(b.bodyId)) engine.removeBlock(b.bodyId);
  }
}

export function _resetNatureGrowthForTest(): void {
  layouts.clear();
  placed.clear();
  picked.clear();
}
