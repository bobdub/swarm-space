/**
 * surfaceProfile — single source of truth for "is this Earth point land
 * or water, and how high does the land sit above sea level?"
 *
 * The Earth shader draws a continents/ocean noise pattern. Until now
 * physics didn't know about it: avatars walked on a perfectly spherical
 * shell, so they could stride across oceans without ever touching the
 * water. This module reproduces the SAME noise field used by the shader
 * (in JS so we can sample it from physics & block placement) and exposes
 * two derived quantities:
 *
 *   - sampleLandMask(localNormal)      : 0..1 (0 = open ocean, 1 = inland)
 *   - sampleSurfaceLift(localNormal)   : metres above EARTH_RADIUS that
 *                                         the visible ground sits at the
 *                                         given Earth-local unit normal.
 *
 * Land sits LAND_LIFT metres above the spherical baseline; water sits AT
 * the baseline. The smooth coast band between them creates a real
 * shoreline both the shader and physics agree on.
 *
 * Pure data — no side-effects. Safe to import from shaders' JS feeders,
 * physics tick, or builder block placement.
 */
import type { Vec3 } from './earth';

/** Height of dry land above the ocean baseline, metres. Small enough that
 *  the planet still reads as a sphere from orbit, large enough that a
 *  walking avatar visibly steps UP onto a beach. */
export const LAND_LIFT = 6.0;
/** Terrain lift (m) above which ground counts as dry for surface
 *  classification. */
export const WATER_WADE_DEPTH = 0.9;
// ── Sea floor (bathymetry) ───────────────────────────────────────────
//
// Like Earth's coasts: a beach shelves gently into wadeable shallows, the
// continental shelf carries on a little deeper, then the continental slope
// drops to the deep ocean floor. Depth follows the continents value below
// the coastline (0.48), so it works for any continents field. The floor is
// solid everywhere, so nothing can fall into the planet.

/** Continents value where the beach meets the sea (landMask starts here). */
export const COAST_VALUE = 0.48;
/** Continents value at the outer edge of the shelf. */
export const SHELF_EDGE_VALUE = 0.42;
/** Continents value where the slope reaches the deep ocean floor. */
export const OCEAN_FLOOR_VALUE = 0.3;
/** Depth (m) at the outer edge of the shelf — well past wading depth. */
export const SHELF_DEPTH_M = 4;
/** Deep ocean floor depth below sea level (m). */
export const OCEAN_FLOOR_DEPTH_M = 30;
/** Walk speed multiplier when wading. Drag is real. */
export const WATER_WALK_SCALE = 0.45;

function fract(n: number): number { return n - Math.floor(n); }
function smoothstep(min: number, max: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  return t * t * (3 - 2 * t);
}
function mix(a: number, b: number, t: number): number { return a * (1 - t) + b * t; }

/** Mirrors the GLSL `hash` in EarthBody.tsx exactly. */
function hash3(x: number, y: number, z: number): number {
  let px = fract(x * 443.8975);
  let py = fract(y * 397.2973);
  let pz = fract(z * 491.1871);
  const d = px * (py + 19.19) + py * (pz + 19.19) + pz * (px + 19.19);
  px = fract(px + d); py = fract(py + d); pz = fract(pz + d);
  return fract((px + py) * pz);
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fract(x), fy = fract(y), fz = fract(z);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);
  return mix(
    mix(mix(n000, n100, ux), mix(n010, n110, ux), uy),
    mix(mix(n001, n101, ux), mix(n011, n111, ux), uy),
    uz,
  );
}

/**
 * Continents noise — same coefficients as the Earth shader so painted
 * green pixels and physical land sit at exactly the same locations.
 */
function continents(n: Vec3): number {
  return (
    noise3(n[0] * 3.5, n[1] * 3.5, n[2] * 3.5) * 0.6 +
    noise3(n[0] * 8.0, n[1] * 8.0, n[2] * 8.0) * 0.3 +
    noise3(n[0] * 16.0, n[1] * 16.0, n[2] * 16.0) * 0.1
  );
}

// ── Islands ───────────────────────────────────────────────────────────
//
// The scattered noise land is the planet's natural geography. On top of
// it sit a few named islands: a raised dome in the continents field whose
// value falls through the coastline (0.48) at `radiusM` and carries on
// down through the shelf and slope, so each island has a beach, wadeable
// shallows and a real drop to the ocean floor, exactly like the noise
// coasts. The outline wobbles with low-frequency noise so it reads as a
// natural island rather than a disc.
//
// Islands are registered through a lazy provider (earth.ts registers the
// shared village) because earth.ts imports this module. Land-snapping
// (`snapToLand`) reads the BASE land mask, so registering an island never
// moves the village frame, the volcano or any other snapped site.

export interface Island {
  /** Earth-local unit normal at the island's centre. */
  center: Vec3;
  /** Distance (m of arc) from the centre to the waterline. */
  radiusM: number;
}

/** Continents value at an island's summit (inland: landMask = 1). */
export const ISLAND_PEAK_VALUE = 0.62;
/** ± fraction the island radius wobbles around its outline. */
const ISLAND_RADIUS_WOBBLE = 0.18;

let _islandProvider: (() => Island[]) | null = null;
let _islands: Island[] | null = null;
let _resolvingIslands = false;
let _islandRadius = 0;

/** Register the island list provider (called once by earth.ts) and the
 *  planet radius that island distances are measured on. */
export function setIslandProvider(provider: (() => Island[]) | null, planetRadius = 0): void {
  _islandProvider = provider;
  _islandRadius = planetRadius;
  _islands = null;
}

/** Resolved islands (empty while the provider is itself resolving). */
export function getIslands(): Island[] {
  if (_islands) return _islands;
  if (!_islandProvider || _resolvingIslands) return [];
  _resolvingIslands = true;
  try {
    _islands = _islandProvider();
  } finally {
    _resolvingIslands = false;
  }
  return _islands;
}

/** Island contribution to the continents field at `n` (−∞ when far). */
function islandField(n: Vec3, radius: number): number {
  const islands = getIslands();
  if (islands.length === 0) return -Infinity;
  // Callers sometimes pass a direction that is not unit length (e.g.
  // localPos / EARTH_RADIUS for a point off the tangent plane); the arc
  // distance must use the true direction or offsets read as the summit.
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const ux = n[0] / len, uy = n[1] / len, uz = n[2] / len;
  let best = -Infinity;
  for (const isl of islands) {
    const c = isl.center;
    const dot = Math.max(-1, Math.min(1, ux * c[0] + uy * c[1] + uz * c[2]));
    const arc = Math.acos(dot) * radius;
    const r = isl.radiusM;
    if (arc > r * 2.5) continue;
    // Natural outline: wobble the radius with the coarse continents noise.
    const wobble = 1 + ISLAND_RADIUS_WOBBLE * (noise3(ux * 12, uy * 12, uz * 12) * 2 - 1);
    const t = arc / (r * wobble);
    // Linear fall from the summit through the coast (t = 1) and on down
    // the shelf and slope to the ocean floor.
    const v = ISLAND_PEAK_VALUE - (ISLAND_PEAK_VALUE - COAST_VALUE) * t;
    if (v > best) best = v;
  }
  return best;
}

/** Continents value of the natural noise land only (no islands). */
export function sampleBaseContinents(localNormal: Vec3): number {
  return continents(localNormal);
}

/** Continents value at an Earth-local unit normal (float64): the noise
 *  land plus any registered islands. Drives land, sea floor and colour. */
export function sampleContinents(localNormal: Vec3): number {
  const base = continents(localNormal);
  if (!_islandProvider || _islandRadius <= 0) return base;
  return Math.max(base, islandField(localNormal, _islandRadius));
}

/** Sea-floor depth below sea level (m) for a continents value: beach shelf
 *  → continental shelf → slope → deep ocean floor. 0 on land. */
export function seaDepthFromContinents(c: number): number {
  return (
    SHELF_DEPTH_M * smoothstep(COAST_VALUE, SHELF_EDGE_VALUE, c) +
    (OCEAN_FLOOR_DEPTH_M - SHELF_DEPTH_M) * smoothstep(SHELF_EDGE_VALUE, OCEAN_FLOOR_VALUE, c)
  );
}

/** Land mask from a continents value — the single coastline threshold. */
export function landMaskFromContinents(c: number): number {
  return smoothstep(0.48, 0.55, c);
}

/** 0 = ocean, 1 = inland. Matches the shader's landMask. */
export function sampleLandMask(localNormal: Vec3): number {
  return landMaskFromContinents(sampleContinents(localNormal));
}

/** Land mask of the natural noise land only — used for site snapping so
 *  adding an island never moves anything already placed. */
export function sampleBaseLandMask(localNormal: Vec3): number {
  return landMaskFromContinents(continents(localNormal));
}

/** Metres of vertical lift above EARTH_RADIUS at this point. Land lifts
 *  to LAND_LIFT, ocean stays at 0. */
export function sampleSurfaceLift(localNormal: Vec3): number {
  return sampleLandMask(localNormal) * LAND_LIFT;
}

/**
 * Tangent basis around a unit normal — used by all land-snap spirals so
 * three modules don't each build their own. If `prefer` is supplied the
 * tangent axes are aligned to that frame (right/forward), otherwise we
 * pick a stable reference axis.
 */
export interface TangentBasis {
  right: Vec3;
  forward: Vec3;
}

function tangentBasis(seed: Vec3, prefer?: TangentBasis): TangentBasis {
  if (prefer) return prefer;
  const ref: Vec3 = Math.abs(seed[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let tx = ref[1] * seed[2] - ref[2] * seed[1];
  let ty = ref[2] * seed[0] - ref[0] * seed[2];
  let tz = ref[0] * seed[1] - ref[1] * seed[0];
  const tn = Math.hypot(tx, ty, tz) || 1;
  tx /= tn; ty /= tn; tz /= tn;
  const bx = seed[1] * tz - seed[2] * ty;
  const by = seed[2] * tx - seed[0] * tz;
  const bz = seed[0] * ty - seed[1] * tx;
  return { right: [tx, ty, tz], forward: [bx, by, bz] };
}

/**
 * Single source of truth for "find the nearest land normal". Replaces
 * three near-identical spirals (earth.ts, volcanoOrgan.ts, scene spawn).
 *
 * - `seed`: starting unit normal.
 * - `maxArcMeters`: spiral radius budget on the surface (arc length).
 * - `threshold`: landMask cutoff treated as "dry".
 * - `radius`: sphere radius the arc length is measured against.
 * - `basis`: optional tangent frame to keep the spiral aligned to a
 *   site (e.g. village right/forward) so the snap stays in eyesight.
 *
 * Returns the seed unchanged if no land cell is found in budget.
 */
export function snapToLand(
  seed: Vec3,
  opts: { maxArcMeters: number; threshold?: number; radius: number; basis?: TangentBasis; steps?: number },
): Vec3 {
  const threshold = opts.threshold ?? 0.6;
  if (sampleBaseLandMask(seed) >= threshold) return seed;
  const { right, forward } = tangentBasis(seed, opts.basis);
  const STEPS = opts.steps ?? 96;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const arc = opts.maxArcMeters * t;
    const theta = t * Math.PI * 6;
    const aR = (Math.cos(theta) * arc) / opts.radius;
    const aF = (Math.sin(theta) * arc) / opts.radius;
    const nx = seed[0] + right[0] * aR + forward[0] * aF;
    const ny = seed[1] + right[1] * aR + forward[1] * aF;
    const nz = seed[2] + right[2] * aR + forward[2] * aF;
    const nn = Math.hypot(nx, ny, nz) || 1;
    const cand: Vec3 = [nx / nn, ny / nn, nz / nn];
    if (sampleBaseLandMask(cand) >= threshold) return cand;
  }
  return seed;
}
