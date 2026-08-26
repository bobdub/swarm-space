/**
 * ═══════════════════════════════════════════════════════════════════════
 * WEATHER — a field observable, not a simulation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * There are no anchors, no seeded storms and no `Math.random()` here.
 * Every quantity below is READ OUT of the 3-D operator field `u`:
 *
 *   • Evaporation  — sun-lit ocean/shore cells `inject3D` moisture onto
 *     the reward axis (μ = 2). The atmosphere has no private counter; the
 *     moisture *is* `u₂`.
 *   • Condensation — a cloud nucleates at the sampled site where `u₂`
 *     exceeds its neighbourhood AND the local curvature ‖∇∇S(u)‖ marks a
 *     well: `score = u₂ − w · curvature`, the same minimum-curvature
 *     selection the language engine uses.
 *   • Drift        — `Σ_μ 𝒟_μ u₂` projected onto the local tangent plane.
 *     No heading jitter.
 *   • Rain         — the back-reaction: negative injection on μ=2 (the
 *     moisture leaves the air) and a positive perturbation on μ=0, so
 *     ‖[D_μ,D_ν]‖ — and therefore Q_Score — moves with the storm.
 *
 * Bounds: every write goes through `inject3D`, which the field's own
 * FIELD3D_BOUND clamp keeps finite. Nothing writes `field.axes` directly.
 */

import {
  EARTH_RADIUS,
  SUN_POSITION,
  earthLocalToWorld,
  getEarthPose,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getBrainPhysics, worldToLattice } from '@/lib/brain/uqrcPhysics';
import { curvatureAt, gradient3D, sample3D } from '@/lib/uqrc/field3D';
import { digCellKeyFor } from '@/lib/world/carvedCellsStore';

/** Field axis carrying atmospheric moisture. */
const MOISTURE_AXIS = 2;
/** Altitude of the condensation layer above the visible ground (m). */
export const CLOUD_ALTITUDE_M = 120;
const MAX_CLOUDS = 6;
const TICK_MS = 1000;
/** Deterministic sample directions over the sphere (Fibonacci lattice). */
const SAMPLES = 96;
/** Curvature penalty in the condensation score. */
const W_CURVE = 0.6;
/** Score a site must reach before the field supports a cloud. */
const NUCLEATION_SCORE = 0.06;
/** Minimum angular separation between two clouds (rad). */
const MIN_SEPARATION = 0.05;

export interface WeatherCloud {
  id: string;
  /** Earth-LOCAL unit normal under the cloud. */
  normal: Vec3;
  /** Puff radius (m) — scales with the depth of the field well. */
  radius: number;
  /** Altitude above the visible ground (m). */
  altitude: number;
  /** Integrated moisture; precipitates above 1. */
  charge: number;
  raining: boolean;
  /** Last sampled condensation score at this site. */
  score: number;
}

export interface WeatherSnapshot {
  /** Mean sampled moisture over the lit hemisphere — derived, not stored. */
  humidity: number;
  clouds: WeatherCloud[];
  /** Sun elevation at the strongest evaporation site, −1..1. */
  sunDot: number;
  /** Total curvature energy injected by weather this tick. */
  lastInjection: number;
  ticks: number;
}

const wetness = new Map<string, number>();
let state: WeatherSnapshot = {
  humidity: 0,
  clouds: [],
  sunDot: 0,
  lastInjection: 0,
  ticks: 0,
};

const listeners = new Set<(s: WeatherSnapshot) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let nextCloudId = 1;

export function getWeather(): WeatherSnapshot { return state; }

export function subscribeWeather(fn: (s: WeatherSnapshot) => void): () => void {
  listeners.add(fn);
  try { fn(state); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

/** Wetness (0..1) at an Earth-local normal. Raises dig resistance. */
export function getWetnessAt(localNormal: Vec3): number {
  return wetness.get(digCellKeyFor(localNormal)) ?? 0;
}

/** Extra curvature load a swing feels from live weather at a point. */
export function weatherCurvatureBoost(localNormal: Vec3): number {
  const wet = getWetnessAt(localNormal);
  const storm = state.clouds.some(
    (c) => c.raining && angleBetween(c.normal, localNormal) < 0.05,
  );
  return wet * 0.6 + (storm ? 0.25 : 0);
}

export function startWeather(): () => void {
  if (timer) return stopWeather;
  // One immediate read so the sky reflects the field the moment the
  // scene mounts — the state comes from u, nothing is seeded.
  try { tickWeather(); } catch (err) { console.warn('[weather] first tick failed', err); }
  timer = setInterval(() => {
    try { tickWeather(); } catch (err) { console.warn('[weather] tick failed', err); }
  }, TICK_MS);
  return stopWeather;
}

export function stopWeather(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

// ────────────────────────────────────────────────────────────────────────
//  One 1 Hz read/write step against the field.
// ────────────────────────────────────────────────────────────────────────

interface SiteSample {
  normal: Vec3;
  world: Vec3;
  lit: number;
  moisture: number;
  curvature: number;
  score: number;
}

/** One 1 Hz step. Exported for tests. */
export function tickWeather(): WeatherSnapshot {
  const pose = getEarthPose();
  const physics = getBrainPhysics();
  const field = physics.getField();

  const sx = SUN_POSITION[0] - pose.center[0];
  const sy = SUN_POSITION[1] - pose.center[1];
  const sz = SUN_POSITION[2] - pose.center[2];
  const sLen = Math.hypot(sx, sy, sz) || 1;
  const sun: Vec3 = [sx / sLen, sy / sLen, sz / sLen];

  // ── Evaporation: lit water writes moisture into u₂ ─────────────────
  const sites: SiteSample[] = [];
  let bestSunDot = -1;
  let moistureSum = 0;
  let litCount = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const normal = fibonacciNormal(i, SAMPLES);
    const worldN = quatRotate(pose.spinQuat, normal);
    const lit = Math.max(0, worldN[0] * sun[0] + worldN[1] * sun[1] + worldN[2] * sun[2]);
    if (lit <= 0.02) continue;

    const surfaceWorld = earthLocalToWorld(
      [normal[0] * EARTH_RADIUS, normal[1] * EARTH_RADIUS, normal[2] * EARTH_RADIUS],
      pose,
    );
    const cls = sampleSurfaceClass(normal);
    if (cls === 'ocean' || cls === 'shore') {
      // The source term. Amplitude is the physical driver: how much sun
      // reaches this water. Nothing else scales it.
      physics.injectAt(surfaceWorld, 0.05 + lit * 0.22, MOISTURE_AXIS);
    }

    const cloudWorld = earthLocalToWorld(
      [
        normal[0] * (EARTH_RADIUS + CLOUD_ALTITUDE_M),
        normal[1] * (EARTH_RADIUS + CLOUD_ALTITUDE_M),
        normal[2] * (EARTH_RADIUS + CLOUD_ALTITUDE_M),
      ],
      pose,
    );
    const { moisture, curvature } = sampleField(field, cloudWorld);
    const score = moisture - W_CURVE * curvature;

    moistureSum += moisture;
    litCount++;
    if (lit > bestSunDot) bestSunDot = lit;
    sites.push({ normal, world: cloudWorld, lit, moisture, curvature, score });
  }

  const humidity = litCount > 0 ? moistureSum / litCount : 0;

  // ── Condensation: nucleate at the best field well ─────────────────
  const clouds = state.clouds.map((c) => ({ ...c }));
  if (clouds.length < MAX_CLOUDS && sites.length > 0) {
    let best: SiteSample | null = null;
    for (const s of sites) {
      if (s.score < NUCLEATION_SCORE) continue;
      if (clouds.some((c) => angleBetween(c.normal, s.normal) < MIN_SEPARATION)) continue;
      if (!best || s.score > best.score) best = s;
    }
    if (best) {
      clouds.push({
        id: `cloud-${nextCloudId++}`,
        normal: best.normal,
        // Well depth sets the size — a strong basin is a big storm.
        radius: 34 + Math.min(1.6, best.score) * 78,
        altitude: CLOUD_ALTITUDE_M,
        charge: Math.min(0.9, best.score),
        raining: false,
        score: best.score,
      });
    }
  }

  // ── Drift, precipitate, dissipate — all from u ─────────────────────
  let injection = 0;
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i];
    const world = earthLocalToWorld(
      [
        c.normal[0] * (EARTH_RADIUS + c.altitude),
        c.normal[1] * (EARTH_RADIUS + c.altitude),
        c.normal[2] * (EARTH_RADIUS + c.altitude),
      ],
      pose,
    );
    const { moisture, curvature, gradient } = sampleField(field, world);
    c.score = moisture - W_CURVE * curvature;

    // Σ_μ 𝒟_μ u₂ in world space → Earth-local → tangent plane.
    const localGrad = quatRotate(pose.invSpinQuat, gradient);
    const radial =
      localGrad[0] * c.normal[0] + localGrad[1] * c.normal[1] + localGrad[2] * c.normal[2];
    const tanX = localGrad[0] - c.normal[0] * radial;
    const tanY = localGrad[1] - c.normal[1] * radial;
    const tanZ = localGrad[2] - c.normal[2] * radial;
    const DRIFT = 900; // lattice-gradient → arc-metres, ℓ_min bookkeeping only
    c.normal = normalise([
      c.normal[0] + (tanX * DRIFT) / EARTH_RADIUS,
      c.normal[1] + (tanY * DRIFT) / EARTH_RADIUS,
      c.normal[2] + (tanZ * DRIFT) / EARTH_RADIUS,
    ]);

    if (!c.raining) {
      c.charge += Math.max(0, c.score);
      c.radius = 34 + Math.min(1.6, Math.max(0, c.score)) * 78;
      if (c.charge >= 1) c.raining = true;
      // A well that flattens out never becomes a storm — it evaporates.
      if (c.score <= 0 && c.charge <= 0.02) clouds.splice(i, 1);
      else c.charge = Math.max(0, c.charge - (c.score <= 0 ? 0.12 : 0));
    } else {
      c.charge -= 0.09;

      // Back-reaction: the moisture leaves the air …
      physics.injectAt(world, -(0.06 + c.charge * 0.05), MOISTURE_AXIS);
      // … and the storm perturbs the drift potential itself.
      const amp = 0.05 + Math.max(0, c.charge) * 0.06;
      physics.injectAt(world, amp, 0);
      injection += amp;

      // Ground under the storm gets wet.
      wetness.set(
        digCellKeyFor(c.normal),
        Math.min(1, (wetness.get(digCellKeyFor(c.normal)) ?? 0) + 0.18),
      );

      if (c.charge <= 0) clouds.splice(i, 1);
    }
  }

  // ── Wetness decay ─────────────────────────────────────────────────
  const day = Math.max(0, bestSunDot);
  for (const [key, value] of wetness) {
    const next = value * (0.985 - day * 0.01);
    if (next < 0.01) wetness.delete(key);
    else wetness.set(key, next);
  }

  state = {
    humidity,
    clouds,
    sunDot: bestSunDot < 0 ? 0 : bestSunDot,
    lastInjection: injection,
    ticks: state.ticks + 1,
  };
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.warn('[weather] listener', err); }
  }
  return state;
}

export function _resetWeatherForTest(): void {
  stopWeather();
  wetness.clear();
  nextCloudId = 1;
  state = { humidity: 0, clouds: [], sunDot: 0, lastInjection: 0, ticks: 0 };
}

// ────────────────────────────────────────────────────────────────────────
//  Field sampling + small geometry helpers
// ────────────────────────────────────────────────────────────────────────

function sampleField(
  field: { N: number } & Parameters<typeof curvatureAt>[0],
  world: Vec3,
): { moisture: number; curvature: number; gradient: Vec3 } {
  const N = field.N;
  const lx = worldToLattice(world[0], N);
  const ly = worldToLattice(world[1], N);
  const lz = worldToLattice(world[2], N);
  const moisture = sample3D(field, MOISTURE_AXIS, lx, ly, lz);
  const curvature = curvatureAt(field, lx, ly, lz);
  const g = gradient3D(field, MOISTURE_AXIS, lx, ly, lz);
  return { moisture, curvature, gradient: [g[0], g[1], g[2]] };
}

/** Deterministic near-uniform direction i of n over the sphere. */
function fibonacciNormal(i: number, n: number): Vec3 {
  const y = 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * 2.399963229728653; // golden angle
  return [Math.cos(phi) * r, y, Math.sin(phi) * r];
}

function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function angleBetween(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot);
}
