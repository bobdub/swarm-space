/**
 * surfaceProfile — single source of truth for "is this Earth point land
 * or water, and how high does the land sit above sea level?"
 *
 * The Earth shader draws three continents surrounded by ocean. Until now
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
 *  classification. Feet no longer drop by this over water: the ocean is
 *  drawn as solid ground, so physics keeps feet on it (see groundHeight). */
export const WATER_WADE_DEPTH = 0.9;
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
 * Three continents separated by open ocean.
 *
 * The old field was multi-octave value noise thresholded at ~0.5, which
 * produced ~18% land shattered into dozens of islands: walking anywhere
 * meant wading through water. Land is now three deterministic spherical
 * caps whose coastlines are wobbled by low-frequency noise. Every
 * continent's interior is solid land and every pair is separated by a
 * guaranteed strip of ocean (see `MIN_OCEAN_GAP_RAD`), so sea level sits
 * cleanly below land everywhere.
 *
 * Shader and physics read the same numbers: `CONTINENTS_GLSL` is
 * generated from the constants below and injected into EarthBody.
 */
export interface ContinentSeed {
  name: string;
  /** Latitude of the continent's heart, degrees. */
  latDeg: number;
  /** Longitude of the continent's heart, degrees. */
  lonDeg: number;
  /** Angular radius of the coastline before wobble, radians. */
  radius: number;
}

export const CONTINENTS: readonly ContinentSeed[] = [
  { name: 'Aurora', latDeg: 16, lonDeg: 10, radius: 0.7 },
  { name: 'Meridia', latDeg: -16, lonDeg: 128, radius: 0.66 },
  { name: 'Solace', latDeg: 4, lonDeg: 250, radius: 0.68 },
];

/** Max coastline wobble, radians either way (~10° ≈ 300 m on Earth):
 *  enough for bays and peninsulas without breaking a continent apart. */
export const COAST_WARP = 0.18;
/** Field units per radian of distance inside the coast. The landMask
 *  smoothstep(0.48, 0.55) band is therefore ~0.07 rad (~120 m) wide. */
const FIELD_SLOPE = 1.0;
/** Smallest ocean strip any two continents are allowed to leave between
 *  their wobbled coasts, radians (~0.25 rad ≈ 425 m of open water). */
export const MIN_OCEAN_GAP_RAD = 0.25;

/** Earth-local unit normal at a continent's heart. */
export function continentCenter(c: ContinentSeed): Vec3 {
  const lat = (c.latDeg * Math.PI) / 180;
  const lon = (c.lonDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

const CENTERS: Vec3[] = CONTINENTS.map(continentCenter);

/** Coast wobble in radians, -COAST_WARP..+COAST_WARP. Same for every
 *  continent (it is a function of position only). */
function coastWarp(n: Vec3): number {
  const w =
    noise3(n[0] * 3.0, n[1] * 3.0, n[2] * 3.0) * 0.55 +
    noise3(n[0] * 6.0, n[1] * 6.0, n[2] * 6.0) * 0.3 +
    noise3(n[0] * 13.0, n[1] * 13.0, n[2] * 13.0) * 0.15;
  // Summed value noise clusters near 0.5, so stretch it ×2.5 and clamp —
  // coasts reach most of the ±COAST_WARP range (bays and peninsulas)
  // while the clamp keeps the separation guarantee exact.
  return Math.max(-1, Math.min(1, (w - 0.5) * 2.5)) * COAST_WARP;
}

function angleBetween(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/** Signed angular distance inside continent `i`'s wobbled coast, radians
 *  (positive = inland, negative = offshore). */
function insideCoast(n: Vec3, i: number, warp: number): number {
  return CONTINENTS[i].radius + warp - angleBetween(n, CENTERS[i]);
}

/**
 * Continent field, 0..1. 0.5 is the coastline; values above are inland,
 * below are ocean. Kept in the old 0..1 range so the shader's shore
 * colour band (0.42..0.58) keeps working unchanged.
 */
export function continentField(n: Vec3): number {
  const warp = coastWarp(n);
  let best = -Infinity;
  for (let i = 0; i < CONTINENTS.length; i++) {
    const v = insideCoast(n, i, warp);
    if (v > best) best = v;
  }
  return Math.max(0, Math.min(1, 0.5 + best * FIELD_SLOPE));
}

/** Index of the continent this point belongs to (or is nearest to). */
export function nearestContinent(n: Vec3): number {
  const warp = coastWarp(n);
  let best = -Infinity;
  let idx = 0;
  for (let i = 0; i < CONTINENTS.length; i++) {
    const v = insideCoast(n, i, warp);
    if (v > best) { best = v; idx = i; }
  }
  return idx;
}

/** Continent field at an Earth-local unit normal (float64). */
export function sampleContinents(localNormal: Vec3): number {
  return continentField(localNormal);
}

/** Land mask from a continents value — the single coastline threshold. */
export function landMaskFromContinents(c: number): number {
  return smoothstep(0.48, 0.55, c);
}

/** 0 = ocean, 1 = inland. Matches the shader's landMask. */
export function sampleLandMask(localNormal: Vec3): number {
  return landMaskFromContinents(continentField(localNormal));
}

function glslFloat(v: number): string {
  const s = v.toFixed(6);
  return s.includes('.') ? s : `${s}.0`;
}

/**
 * GLSL twin of `continentField` / `sampleLandMask`. Self-contained (own
 * hash/noise names) so it can be dropped into any shader. Provides:
 *   float continentField(vec3 n);
 *   float continentLandMask(vec3 n);
 */
export const CONTINENTS_GLSL = /* glsl */ `
  float cHash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float cNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cHash(i+vec3(0,0,0)), cHash(i+vec3(1,0,0)), u.x),
          mix(cHash(i+vec3(0,1,0)), cHash(i+vec3(1,1,0)), u.x), u.y),
      mix(mix(cHash(i+vec3(0,0,1)), cHash(i+vec3(1,0,1)), u.x),
          mix(cHash(i+vec3(0,1,1)), cHash(i+vec3(1,1,1)), u.x), u.y),
      u.z);
  }
  float continentField(vec3 n) {
    float warp = clamp((cNoise(n * 3.0) * 0.55 + cNoise(n * 6.0) * 0.3 + cNoise(n * 13.0) * 0.15 - 0.5) * 2.5, -1.0, 1.0) * ${glslFloat(COAST_WARP)};
    float best = -1000.0;
${CONTINENTS.map((c, i) => {
  const [x, y, z] = CENTERS[i];
  return `    best = max(best, ${glslFloat(c.radius)} + warp - acos(clamp(dot(n, vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)})), -1.0, 1.0)));`;
}).join('\n')}
    return clamp(0.5 + best * ${glslFloat(FIELD_SLOPE)}, 0.0, 1.0);
  }
  float continentLandMask(vec3 n) {
    return smoothstep(0.48, 0.55, continentField(n));
  }
`;

/**
 * Walk from `seed` along the great circle toward the heart of the
 * nearest continent until the land mask reaches `threshold`. Always
 * succeeds because every continent's heart is solid land.
 */
export function walkToNearestContinent(seed: Vec3, threshold = 0.6): Vec3 {
  if (sampleLandMask(seed) >= threshold) return seed;
  const target = CENTERS[nearestContinent(seed)];
  const total = angleBetween(seed, target);
  if (total < 1e-9) return target;
  const sinT = Math.sin(total);
  const STEPS = 128;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    let a: number, b: number;
    if (sinT < 1e-6) { a = 1 - t; b = t; } else {
      a = Math.sin((1 - t) * total) / sinT;
      b = Math.sin(t * total) / sinT;
    }
    const x = seed[0] * a + target[0] * b;
    const y = seed[1] * a + target[1] * b;
    const z = seed[2] * a + target[2] * b;
    const len = Math.hypot(x, y, z) || 1;
    const cand: Vec3 = [x / len, y / len, z / len];
    if (sampleLandMask(cand) >= threshold) return cand;
  }
  return target;
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
 * - `fallback`: what to return if the spiral finds no land in budget.
 *   'continent' (default) walks to the nearest continent so callers
 *   never end up in the ocean; 'seed' returns the seed unchanged (used
 *   by the volcano, which must stay within eyesight of its village).
 */
export function snapToLand(
  seed: Vec3,
  opts: {
    maxArcMeters: number;
    threshold?: number;
    radius: number;
    basis?: TangentBasis;
    steps?: number;
    fallback?: 'continent' | 'seed';
  },
): Vec3 {
  const threshold = opts.threshold ?? 0.6;
  if (sampleLandMask(seed) >= threshold) return seed;
  const { right, forward } = tangentBasis(seed, opts.basis);
  const STEPS = opts.steps ?? 96;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const arc = opts.maxArcMeters * t;
    const theta = t * Math.PI * 6;
    const aR = (Math.cos(theta) * arc) / opts.radius;
    const aF = (Math.sin(theta) * arc) / opts.radius;
    let nx = seed[0] + right[0] * aR + forward[0] * aF;
    let ny = seed[1] + right[1] * aR + forward[1] * aF;
    let nz = seed[2] + right[2] * aR + forward[2] * aF;
    const nn = Math.hypot(nx, ny, nz) || 1;
    const cand: Vec3 = [nx / nn, ny / nn, nz / nn];
    if (sampleLandMask(cand) >= threshold) return cand;
  }
  return opts.fallback === 'seed' ? seed : walkToNearestContinent(seed, threshold);
}
