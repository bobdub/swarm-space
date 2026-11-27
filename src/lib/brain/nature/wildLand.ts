/**
 * wildLand — trees, grass, flowers and boulders across the open land.
 *
 * The starter biome (`natureSeed.ts`) only dresses the meadow round the
 * village, so the rest of every continent was bare grass with chicken
 * flocks on it. Here the whole planet is cut into wild patches on a
 * Fibonacci lattice (about 50 m apart). What grows in a patch is a pure
 * function of the patch index and the baked terrain every peer shares, so
 * every peer sees the same forests, meadows and rocky ground and nothing is
 * sent to agree on it. Each patch has a character (forest, grove, meadow
 * or rocky), so walking across a continent passes through different kinds
 * of country.
 *
 * Only the patches round the viewer are real: `syncWildLand` places their
 * pieces as ordinary biome blocks (so axes, picks and buckets work on them
 * exactly as on the village's) and removes them again once the viewer has
 * walked on, which keeps the physics and the scene small however far
 * anyone explores.
 *
 * What players take:
 *   - A felled wild tree is a shared `fell` nature event (anchor
 *     `wild:<patch>`), so it is down for everyone; it grows back an hour
 *     later, when the event expires (natureEventsStore).
 *   - Gathered grass and flowers and broken boulders are this player's own
 *     harvest: they stay gone on this device and grow back after a while
 *     (`WILD_REGROW_MS`).
 *
 * Nothing grows on the beach (beach.ts), in the water, on steep slopes,
 * on the volcano, on polar ice or in the village, which has its own meadow.
 */
import { EARTH_RADIUS, SHARED_VILLAGE_ISLAND_ANCHOR, getEarthLocalSiteFrame, registerLocalSiteFrame, type Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { BEACH_TOP_M } from '../beach';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';
import { getBuilderBlockEngine } from '../builderBlockEngine';
import { NATURE_CATALOG } from './natureCatalog';
import { HEN_EVENT_TTL_MS, WILD_ANCHOR_PREFIX, listNatureEvents } from '@/lib/world/natureEventsStore';
import { STUMP_FADE_MS, TOPPLE_MS, clearTreeChop, isTreeFelled, markTreeFelled } from '@/lib/world/treeChopStore';

export { WILD_ANCHOR_PREFIX };

/** Patches on the planet's lattice (about 51 m apart on a 1700 m Earth). */
export const WILD_PATCH_COUNT = 14000;
/** Pieces in a patch stand within this far (m) of its centre. */
export const WILD_PATCH_RADIUS_M = 27;
/** Patches whose centre is this close (m) to the viewer are placed... */
export const WILD_LOAD_M = 95;
/** ...and taken down again once the viewer is this far away (m). */
export const WILD_UNLOAD_M = 140;
/** No wild growth this close (m) to the village centre: it has its own meadow. */
export const WILD_VILLAGE_CLEAR_M = 75;
/** Wild growth keeps this far (m) clear of the volcano's foot. */
const VOLCANO_CLEAR_M = 20;
/** Lowest and highest ground (m above sea level) anything grows on. */
const MIN_GROUND_M = BEACH_TOP_M + 0.3;
const MAX_GROUND_M = 60;
/** Steepest ground (m of rise across 3 m) anything grows on. */
const MAX_RISE_M = 1.2;
/** A felled wild tree grows back after this long (the event's lifetime). */
export const WILD_TREE_REGROW_MS = HEN_EVENT_TTL_MS;
/** Gathered grass and flowers, and broken boulders, grow back after this long. */
export const WILD_REGROW_MS: Record<'grass' | 'flower' | 'stone', number> = {
  grass: 15 * 60_000,
  flower: 20 * 60_000,
  stone: 45 * 60_000,
};

export type WildKind = 'tree' | 'grass' | 'flower' | 'stone';
export type WildCharacter = 'forest' | 'grove' | 'meadow' | 'rocky';

export interface WildPiece {
  /** Bare block id: `wild-<patch>-<kind>-<n>`. */
  id: string;
  kind: WildKind;
  /** Right / forward offset (m) from the patch centre, in its site frame. */
  x: number;
  z: number;
  meta: Record<string, unknown>;
}

export interface WildPatch {
  index: number;
  /** Site-frame anchor id: `wild:<index>`. */
  anchorId: string;
  normal: Vec3;
  forward: Vec3;
  right: Vec3;
  character: WildCharacter;
  pieces: WildPiece[];
}

/** How many of each kind a patch of each character tries to grow: [min, max]. */
const RECIPE: Record<WildCharacter, Record<WildKind, [number, number]>> = {
  forest: { tree: [5, 8], grass: [3, 5], flower: [1, 2], stone: [0, 1] },
  grove: { tree: [3, 4], grass: [5, 7], flower: [2, 3], stone: [1, 2] },
  meadow: { tree: [0, 2], grass: [7, 10], flower: [4, 7], stone: [0, 1] },
  rocky: { tree: [1, 2], grass: [3, 4], flower: [1, 2], stone: [3, 5] },
};
/** Closest two pieces of these kinds may stand (m). */
const SPACING: Record<WildKind, number> = { tree: 3.6, stone: 2.2, flower: 1.0, grass: 0.8 };
const FLOWER_COMPOUNDS = ['carotenoid', 'anthocyanin', 'chlorophyll'];

/** Small deterministic PRNG (mulberry32). */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Arc distance (m) between two unit normals on the Earth. */
function arcM(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * EARTH_RADIUS;
}

let lattice: Float64Array | null = null;
function getLattice(): Float64Array {
  if (lattice) return lattice;
  const out = new Float64Array(WILD_PATCH_COUNT * 3);
  for (let i = 0; i < WILD_PATCH_COUNT; i++) {
    const y = 1 - (2 * (i + 0.5)) / WILD_PATCH_COUNT;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963229728653;
    out[i * 3] = r * Math.cos(th);
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = r * Math.sin(th);
  }
  lattice = out;
  return out;
}

/** Centre (Earth-local unit normal) of patch `i`. */
export function wildPatchCentre(i: number): Vec3 {
  const l = getLattice();
  return [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]];
}

/** Indices of the patches whose centre lies within `radiusM` of `n`. */
export function wildPatchesNear(n: Vec3, radiusM: number): number[] {
  const l = getLattice();
  const minDot = Math.cos(radiusM / EARTH_RADIUS);
  const out: number[] = [];
  for (let i = 0; i < WILD_PATCH_COUNT; i++) {
    if (l[i * 3] * n[0] + l[i * 3 + 1] * n[1] + l[i * 3 + 2] * n[2] >= minDot) out.push(i);
  }
  return out;
}

/** Site frame of a patch: a tangent basis at its centre. */
function patchFrame(normal: Vec3, angle: number): { forward: Vec3; right: Vec3 } {
  const ref: Vec3 = Math.abs(normal[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const a = normalize([
    ref[1] * normal[2] - ref[2] * normal[1],
    ref[2] * normal[0] - ref[0] * normal[2],
    ref[0] * normal[1] - ref[1] * normal[0],
  ]);
  const b: Vec3 = [
    normal[1] * a[2] - normal[2] * a[1],
    normal[2] * a[0] - normal[0] * a[2],
    normal[0] * a[1] - normal[1] * a[0],
  ];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const right = normalize([a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s]);
  const forward: Vec3 = [
    normal[1] * right[2] - normal[2] * right[1],
    normal[2] * right[0] - normal[0] * right[2],
    normal[0] * right[1] - normal[1] * right[0],
  ];
  return { forward, right };
}

/** Earth-local unit normal at offset (x right, z forward) from a patch centre. */
function pointAt(normal: Vec3, forward: Vec3, right: Vec3, x: number, z: number): Vec3 {
  // The same planar offset the block engine uses to place a block.
  return normalize([
    normal[0] * EARTH_RADIUS + forward[0] * z + right[0] * x,
    normal[1] * EARTH_RADIUS + forward[1] * z + right[1] * x,
    normal[2] * EARTH_RADIUS + forward[2] * z + right[2] * x,
  ]);
}

let guards: { village: Vec3; volcano: Vec3; volcanoClearM: number } | null = null;
function getGuards() {
  if (!guards) {
    const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
    guards = {
      village: getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal,
      volcano: organ.centerNormal,
      volcanoClearM: organ.baseRadius + VOLCANO_CLEAR_M,
    };
  }
  return guards;
}

/** True when something can grow on the ground at `p`. */
function groundOk(p: Vec3): boolean {
  if (Math.abs(p[1]) >= 0.9) return false; // polar ice
  const g = getGuards();
  if (arcM(p, g.village) < WILD_VILLAGE_CLEAR_M) return false;
  if (arcM(p, g.volcano) < g.volcanoClearM) return false;
  const e = groundElevationAt(p);
  if (!(e >= MIN_GROUND_M && e <= MAX_GROUND_M)) return false;
  return true;
}

function slopeOk(p: Vec3, forward: Vec3, right: Vec3): boolean {
  const e = groundElevationAt(p);
  const step = 1.5;
  for (const [x, z] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
    const q = pointAt(p, forward, right, x, z);
    if (Math.abs(groundElevationAt(q) - e) > MAX_RISE_M) return false;
  }
  return true;
}

const patchCache = new Map<number, WildPatch | null>();

/**
 * What grows in patch `i`, or null when nothing can (sea, ice, volcano,
 * village). Deterministic and cached: every peer gets the same answer.
 */
export function wildPatch(i: number): WildPatch | null {
  if (patchCache.has(i)) return patchCache.get(i)!;
  const patch = buildPatch(i);
  patchCache.set(i, patch);
  return patch;
}

function buildPatch(i: number): WildPatch | null {
  const normal = wildPatchCentre(i);
  // Cheap early-out: a patch whose centre and four edge points are all
  // under water or ice grows nothing.
  const r = rand(0x5eed1 + i * 2654435761);
  const { forward, right } = patchFrame(normal, r() * Math.PI * 2);
  const probe = [[0, 0], [WILD_PATCH_RADIUS_M, 0], [-WILD_PATCH_RADIUS_M, 0], [0, WILD_PATCH_RADIUS_M], [0, -WILD_PATCH_RADIUS_M]];
  if (!probe.some(([x, z]) => groundOk(pointAt(normal, forward, right, x, z)))) return null;

  const roll = r();
  const character: WildCharacter = roll < 0.3 ? 'forest' : roll < 0.45 ? 'grove' : roll < 0.8 ? 'meadow' : 'rocky';
  const recipe = RECIPE[character];
  const pieces: WildPiece[] = [];
  const kinds: WildKind[] = ['tree', 'stone', 'flower', 'grass'];
  for (const kind of kinds) {
    const [lo, hi] = recipe[kind];
    const want = lo + Math.floor(r() * (hi - lo + 1));
    let made = 0;
    for (let attempt = 0; made < want && attempt < want * 6; attempt++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * WILD_PATCH_RADIUS_M;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // Draw the per-piece extras up front so a rejected spot never shifts
      // the rest of the patch differently on different peers.
      const extraA = r();
      const extraB = r();
      const p = pointAt(normal, forward, right, x, z);
      if (!groundOk(p) || !slopeOk(p, forward, right)) continue;
      const tooClose = pieces.some((o) => Math.hypot(o.x - x, o.z - z) < Math.max(SPACING[o.kind], SPACING[kind]));
      if (tooClose) continue;
      const meta: Record<string, unknown> = {};
      if (kind === 'tree') meta.stage = 'mature';
      if (kind === 'flower') meta.compound = FLOWER_COMPOUNDS[Math.floor(extraA * 3) % 3];
      if (kind === 'stone') {
        meta.size = 0.5 + extraA * 0.55;
        meta.shapeSeed = Math.floor(extraB * 0x7fffffff);
      }
      pieces.push({ id: `wild-${i}-${kind}-${made}`, kind, x, z, meta });
      made++;
    }
  }
  if (pieces.length === 0) return null;
  return { index: i, anchorId: `${WILD_ANCHOR_PREFIX}${i}`, normal, forward, right, character, pieces };
}

// ── Streaming the patches round the viewer into the block engine ─────

const BIOME_TAG = 'nature.biome.v1';
const TAKEN_KEY = 'brain.wildTaken.v1';
const TAKEN_CAP = 4000;

/** Patches currently placed, by index → body ids placed for it. */
const loaded = new Map<number, Set<string>>();
/** Body id → when this player took it (gathered or broke it). */
let taken: Map<string, number> | null = null;
/** True while this module itself removes a block (not a harvest). */
let selfRemoving = false;
let unsubEngine: (() => void) | null = null;

function loadTaken(): Map<string, number> {
  if (taken) return taken;
  taken = new Map();
  try {
    const raw = globalThis.localStorage?.getItem(TAKEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && Number.isFinite(v)) taken.set(k, v);
    }
  } catch { /* storage unavailable */ }
  return taken;
}

function saveTaken(now: number): void {
  const t = loadTaken();
  for (const [k, at] of t) {
    if (now - at > WILD_REGROW_MS.stone || at > now + 60_000) t.delete(k);
  }
  if (t.size > TAKEN_CAP) {
    const oldest = [...t.entries()].sort((a, b) => a[1] - b[1]).slice(0, t.size - TAKEN_CAP);
    for (const [k] of oldest) t.delete(k);
  }
  try {
    globalThis.localStorage?.setItem(TAKEN_KEY, JSON.stringify(Object.fromEntries(t)));
  } catch { /* storage unavailable */ }
}

/** True while a piece this player gathered or broke has not grown back. */
export function isWildPieceTaken(bodyId: string, kind: WildKind, now = Date.now()): boolean {
  if (kind === 'tree') return false;
  const at = loadTaken().get(bodyId);
  return at !== undefined && now - at < WILD_REGROW_MS[kind];
}

/** Record that this player took a wild piece (gathered or broke it). */
export function markWildPieceTaken(bodyId: string, at = Date.now()): void {
  loadTaken().set(bodyId, at);
  saveTaken(at);
}

function watchHarvests(): void {
  if (unsubEngine) return;
  unsubEngine = getBuilderBlockEngine().subscribe((evt) => {
    if (evt.type !== 'remove' || selfRemoving) return;
    if (!evt.block.anchorPeerId.startsWith(WILD_ANCHOR_PREFIX)) return;
    if (evt.block.kind === 'tree') return; // felling is a shared event
    markWildPieceTaken(evt.block.bodyId);
    for (const ids of loaded.values()) ids.delete(evt.block.bodyId);
  });
}

/** Latest felling of each wild tree still standing out its regrow time. */
function wildFells(now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of listNatureEvents()) {
    if (e.kind !== 'fell' || !e.anchorPeerId.startsWith(WILD_ANCHOR_PREFIX)) continue;
    if (now - e.at >= WILD_TREE_REGROW_MS || e.at > now + 60_000) continue;
    const prev = out.get(e.blockId);
    if (prev === undefined || e.at > prev) out.set(e.blockId, e.at);
  }
  return out;
}

function removeQuietly(bodyId: string): void {
  selfRemoving = true;
  try { getBuilderBlockEngine().removeBlock(bodyId); } finally { selfRemoving = false; }
}

/** What the engine should hold for one piece right now. */
type PieceState = 'show' | 'falling' | 'gone';

function pieceState(bodyId: string, kind: WildKind, fells: Map<string, number>, now: number): PieceState {
  if (kind === 'tree') {
    const f = fells.get(bodyId);
    if (f === undefined) return 'show';
    return now < f + TOPPLE_MS + STUMP_FADE_MS ? 'falling' : 'gone';
  }
  return isWildPieceTaken(bodyId, kind, now) ? 'gone' : 'show';
}

/**
 * Bring the wild patches round `viewer` (Earth-local unit normal) into the
 * block engine and take down the ones left behind. Cheap enough to call
 * every second or two.
 */
export function syncWildLand(viewer: Vec3, now = Date.now()): void {
  watchHarvests();
  const engine = getBuilderBlockEngine();
  const fells = wildFells(now);

  // Leave behind patches the viewer has walked away from.
  const unloadDot = Math.cos(WILD_UNLOAD_M / EARTH_RADIUS);
  for (const [i, ids] of loaded) {
    if (dot(wildPatchCentre(i), viewer) >= unloadDot) continue;
    for (const bodyId of ids) {
      removeQuietly(bodyId);
      if (bodyId.startsWith('tree:')) clearTreeChop(bodyId);
    }
    loaded.delete(i);
  }

  for (const i of wildPatchesNear(viewer, WILD_LOAD_M)) {
    const patch = wildPatch(i);
    if (!patch) continue;
    registerLocalSiteFrame(patch.anchorId, patch.normal, patch.forward, patch.right);
    let ids = loaded.get(i);
    if (!ids) { ids = new Set(); loaded.set(i, ids); }
    for (const piece of patch.pieces) {
      const bodyId = `${piece.kind}:${piece.id}`;
      const state = pieceState(bodyId, piece.kind, fells, now);
      const present = engine.getBlock(bodyId) !== undefined;
      if (state === 'gone') {
        if (present) {
          removeQuietly(bodyId);
          if (piece.kind === 'tree') clearTreeChop(bodyId);
        }
        ids.delete(bodyId);
        continue;
      }
      if (piece.kind === 'tree' && state === 'falling') {
        // Felled by someone: show it coming down here too, if it is in view.
        if (present) markTreeFelled(bodyId, fells.get(bodyId)!);
        continue;
      }
      // Standing again: a felling this device saw start (say the tab slept
      // through the stump fading and the regrow) must not keep it down.
      if (piece.kind === 'tree' && isTreeFelled(bodyId)) clearTreeChop(bodyId);
      if (!present) {
        const spec = NATURE_CATALOG[piece.kind];
        engine.placeBlock({
          id: piece.id,
          kind: piece.kind,
          anchorPeerId: patch.anchorId,
          rightOffset: piece.x,
          forwardOffset: piece.z,
          mass: spec.mass,
          basin: spec.basin,
          meta: { ...piece.meta, biome: BIOME_TAG, species: piece.kind, wild: true },
        });
      }
      ids.add(bodyId);
    }
  }
}

/** Take every wild piece out of the engine (the scene is closing). */
export function clearWildLand(): void {
  for (const ids of loaded.values()) {
    for (const bodyId of ids) {
      removeQuietly(bodyId);
      if (bodyId.startsWith('tree:')) clearTreeChop(bodyId);
    }
  }
  loaded.clear();
}

/** How many wild patches are placed right now (for tests and diagnostics). */
export function loadedWildPatchCount(): number {
  return loaded.size;
}

export function _resetWildLandForTest(): void {
  clearWildLand();
  patchCache.clear();
  taken = null;
  guards = null;
  unsubEngine?.();
  unsubEngine = null;
}
