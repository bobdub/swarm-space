/**
 * ═══════════════════════════════════════════════════════════════════════
 * WEATHER — evaporation → condensation → rain, coupled to the UQRC field
 * ═══════════════════════════════════════════════════════════════════════
 *
 * A 1 Hz state machine. Nothing renders here; `WeatherLayer` reads the
 * snapshot. The loop closes back onto physics in two ways:
 *
 *   1. Rain injects curvature into the 3-D operator field at the storm
 *      cell (`injectAt`), so ||[D_μ,D_ν]|| — and therefore Q_Score — is
 *      no longer artificially flat. Weather IS instability.
 *   2. Rain wets ground cells; wetness raises the effective curvature
 *      load a tool sees, so digging wet soil is measurably harder.
 *
 * Bounds: injection amplitudes are small and the field's own
 * FIELD3D_BOUND clamp keeps u finite — instability stays regular.
 */

import {
  EARTH_RADIUS,
  SUN_POSITION,
  earthLocalToWorld,
  getEarthLocalSiteFrame,
  getEarthPose,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { digCellKeyFor } from '@/lib/world/carvedCellsStore';

export const WEATHER_ANCHOR_ID = 'swarm-shared-village';
export const CLOUD_ALTITUDE_M = 120;
const MAX_CLOUDS = 5;
const TICK_MS = 1000;

export interface WeatherCloud {
  id: string;
  /** Earth-LOCAL unit normal under the cloud. */
  normal: Vec3;
  /** Puff radius (m). */
  radius: number;
  /** Altitude above the visible ground (m). */
  altitude: number;
  /** 0..1+ — precipitates above 1. */
  charge: number;
  raining: boolean;
  /** Tangential drift heading (radians on the local tangent plane). */
  heading: number;
}

export interface WeatherSnapshot {
  humidity: number;
  clouds: WeatherCloud[];
  /** Sun elevation over the village, −1..1. */
  sunDot: number;
  /** Total curvature energy injected by weather this tick. */
  lastInjection: number;
  ticks: number;
}

const wetness = new Map<string, number>();
let state: WeatherSnapshot = {
  humidity: 0.35,
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
  const storm = state.clouds.some((c) => c.raining && angleBetween(c.normal, localNormal) < 0.02);
  return wet * 0.6 + (storm ? 0.25 : 0);
}

export function startWeather(): () => void {
  if (timer) return stopWeather;
  timer = setInterval(() => {
    try { tickWeather(); } catch (err) { console.warn('[weather] tick failed', err); }
  }, TICK_MS);
  return stopWeather;
}

export function stopWeather(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** One 1 Hz step. Exported for tests. */
export function tickWeather(): WeatherSnapshot {
  const frame = getEarthLocalSiteFrame(WEATHER_ANCHOR_ID);
  const pose = getEarthPose();

  // ── Sun elevation over the village (world space) ──────────────────
  const worldN = quatRotate(pose.spinQuat, frame.normal);
  const sx = SUN_POSITION[0] - pose.center[0];
  const sy = SUN_POSITION[1] - pose.center[1];
  const sz = SUN_POSITION[2] - pose.center[2];
  const sLen = Math.hypot(sx, sy, sz) || 1;
  const sunDot = (worldN[0] * sx + worldN[1] * sy + worldN[2] * sz) / sLen;
  const day = Math.max(0, sunDot);

  // ── Evaporate: how much open water is under the sun near the village
  let waterFraction = 0;
  const SAMPLES = 12;
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const arc = 260 / EARTH_RADIUS;
    const n = offsetNormal(frame, Math.cos(a) * arc, Math.sin(a) * arc);
    const cls = sampleSurfaceClass(n);
    if (cls === 'ocean' || cls === 'shore') waterFraction += 1 / SAMPLES;
  }
  const evaporation = 0.02 + waterFraction * day * 0.22;
  let humidity = Math.min(3, state.humidity + evaporation);

  // ── Condense: humidity above one unit spawns a cloud ──────────────
  const clouds = state.clouds.map((c) => ({ ...c }));
  if (humidity >= 1 && clouds.length < MAX_CLOUDS) {
    humidity -= 1;
    const a = Math.random() * Math.PI * 2;
    const arc = (60 + Math.random() * 220) / EARTH_RADIUS;
    clouds.push({
      id: `cloud-${nextCloudId++}`,
      normal: offsetNormal(frame, Math.cos(a) * arc, Math.sin(a) * arc),
      radius: 22 + Math.random() * 26,
      altitude: CLOUD_ALTITUDE_M + Math.random() * 40,
      charge: 0.15,
      raining: false,
      heading: Math.random() * Math.PI * 2,
    });
  }

  // ── Drift, precipitate, dissipate ─────────────────────────────────
  let injection = 0;
  const physics = getBrainPhysics();
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i];
    const driftArc = 6 / EARTH_RADIUS;
    c.normal = offsetNormal(
      { normal: c.normal, right: frame.right, forward: frame.forward },
      Math.cos(c.heading) * driftArc,
      Math.sin(c.heading) * driftArc,
    );
    c.heading += (Math.random() - 0.5) * 0.25;

    if (!c.raining) {
      c.charge += 0.06 + humidity * 0.05;
      if (c.charge >= 1) c.raining = true;
    } else {
      c.charge -= 0.09;
      humidity = Math.max(0, humidity - 0.015);

      // Wet the ground under the storm.
      const key = digCellKeyFor(c.normal);
      wetness.set(key, Math.min(1, (wetness.get(key) ?? 0) + 0.18));

      // Curvature injection — rain is a real perturbation of u.
      const world = earthLocalToWorld(
        [
          c.normal[0] * (EARTH_RADIUS + c.altitude * 0.5),
          c.normal[1] * (EARTH_RADIUS + c.altitude * 0.5),
          c.normal[2] * (EARTH_RADIUS + c.altitude * 0.5),
        ],
        pose,
      );
      const amp = 0.05 + c.charge * 0.06;
      physics.injectAt(world, amp, 1);
      injection += amp;

      if (c.charge <= 0) clouds.splice(i, 1);
    }
  }

  // ── Wetness decay (soil dries out) ────────────────────────────────
  for (const [key, value] of wetness) {
    const next = value * (0.985 - day * 0.01);
    if (next < 0.01) wetness.delete(key);
    else wetness.set(key, next);
  }

  state = {
    humidity,
    clouds,
    sunDot,
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
  state = { humidity: 0.35, clouds: [], sunDot: 0, lastInjection: 0, ticks: 0 };
}

// ────────────────────────────────────────────────────────────────────────
//  Small-angle tangent helpers
// ────────────────────────────────────────────────────────────────────────

function offsetNormal(
  frame: { normal: Vec3; right: Vec3; forward: Vec3 },
  aRight: number,
  aForward: number,
): Vec3 {
  const x = frame.normal[0] + frame.right[0] * aRight + frame.forward[0] * aForward;
  const y = frame.normal[1] + frame.right[1] * aRight + frame.forward[1] * aForward;
  const z = frame.normal[2] + frame.right[2] * aRight + frame.forward[2] * aForward;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function angleBetween(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot);
}
