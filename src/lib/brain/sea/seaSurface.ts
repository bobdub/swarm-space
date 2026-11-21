/**
 * seaSurface — where the sea's surface is, on the shared Earth clock.
 *
 * Two motions, both read from `getEarthPoseAt(t)` so every peer sees the
 * same sea at the same instant and nothing is sent:
 *
 * 1. Tide (`tideAt`): the equilibrium tide of the Moon and the Sun. The
 *    tidal potential of a body is a quadrupole, so the sea rises by
 *    A · P₂(n̂ · d̂) with P₂(c) = (3c² − 1) / 2: one bulge under the body,
 *    one on the far side, low water on the ring between. The Moon's term
 *    (`TIDE_LUNAR_M`) and the Sun's (`TIDE_SOLAR_M`, ≈ 0.46 of it, as on
 *    Earth) add, so as the Moon goes round the Sun's tide alternately
 *    builds and cancels the Moon's: spring and neap tides. Earth spins far faster than the Moon goes round, and the
 *    real sea is dragged ahead of the sub-lunar point; `TIDE_LAG_RAD`
 *    turns the lunar bulge that far ahead about the spin axis. One in-game
 *    day (≈ 3.4 real hours) brings two high waters. The tide is a few tens
 *    of centimetres, so it moves the waterline up and down beaches without
 *    ever uncovering the sea floor rules (`seaDepthFromContinents`).
 *
 *    The tide is physical: swimmers float on it (`supportElevationAt`)
 *    and boats ride it (`Vessel.waterlineAt`), and the drawn sea surface
 *    lifts by the same number (`SEA_TIDE_GLSL`, fed `tideFrameAt`), so
 *    heads, hulls and water never part.
 *
 * 2. Swell (`SEA_SWELL_GLSL`): purely visual surface slope, drawn as a
 *    normal perturbation on the sea sphere, because the sphere's vertices
 *    are ~40 m apart and a 10 cm wave cannot move them usefully. Deep
 *    water waves obey ω² = g·k, and the trains use the same frequencies
 *    as a boat's heave (`swellAt`, 0.9 and 2.3 rad/s) plus a short chop,
 *    so the water and the hulls rock to one rhythm. The trains run along
 *    the planet's spin: westward in the trade-wind band (|lat| < 30°)
 *    and eastward in the westerlies, the way the spin's Coriolis force
 *    turns the winds that raise them. Their phase counts whole waves
 *    round each latitude circle, so there is no seam.
 */

import { EARTH_RADIUS, getEarthPoseAt, getEarthPoseTime, quatRotate, type Vec3 } from '../earth';

/** Lunar equilibrium tide amplitude (m): high water is +A, low water −A/2. */
export const TIDE_LUNAR_M = 0.2;
/** Solar tide amplitude (m): 0.46 of the lunar, as on Earth. */
export const TIDE_SOLAR_M = 0.092;
/** How far the lunar bulge leads the Moon about the spin axis (rad, ≈ 3°). */
export const TIDE_LAG_RAD = (3 * Math.PI) / 180;
/** Highest and lowest the tide can reach (m). */
export const TIDE_MAX_M = TIDE_LUNAR_M + TIDE_SOLAR_M;
export const TIDE_MIN_M = -(TIDE_LUNAR_M + TIDE_SOLAR_M) / 2;

export interface TideFrame {
  /** Shared-clock time the frame was taken at (s). */
  t: number;
  /** Earth-local unit direction of the lunar tidal bulge (Moon + lag). */
  moon: Vec3;
  /** Earth-local unit direction toward the Sun. */
  sun: Vec3;
}

function unit(a: Vec3, b: Vec3): Vec3 {
  const x = b[0] - a[0];
  const y = b[1] - a[1];
  const z = b[2] - a[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

let cached: TideFrame | null = null;

/** Tidal bulge directions in the Earth-local frame at shared time `t`. */
export function tideFrameAt(t: number): TideFrame {
  if (cached && cached.t === t) return cached;
  const pose = getEarthPoseAt(t);
  const m = quatRotate(pose.invSpinQuat, unit(pose.center, pose.moon));
  const s = quatRotate(pose.invSpinQuat, unit(pose.center, pose.sun));
  // Lead the Moon about the spin axis (+Y, the spin's own sense).
  const c = Math.cos(TIDE_LAG_RAD);
  const sn = Math.sin(TIDE_LAG_RAD);
  const moon: Vec3 = [m[0] * c + m[2] * sn, m[1], -m[0] * sn + m[2] * c];
  cached = { t, moon, sun: s };
  return cached;
}

function p2(c: number): number {
  return 0.5 * (3 * c * c - 1);
}

/** Tide height (m above mean sea level) at an Earth-local unit normal. */
export function tideAt(localN: Vec3, t: number = getEarthPoseTime()): number {
  const f = tideFrameAt(t);
  const l = Math.hypot(localN[0], localN[1], localN[2]) || 1;
  const cm = (localN[0] * f.moon[0] + localN[1] * f.moon[1] + localN[2] * f.moon[2]) / l;
  const cs = (localN[0] * f.sun[0] + localN[1] * f.sun[1] + localN[2] * f.sun[2]) / l;
  return TIDE_LUNAR_M * p2(cm) + TIDE_SOLAR_M * p2(cs);
}

/** Sea surface elevation (m above mean sea level) used by physics: the tide. */
export function seaLevelAt(localN: Vec3, t?: number): number {
  return tideAt(localN, t);
}

// ── Swell (visual) ──────────────────────────────────────────────────

const G = 9.81;

export interface SwellTrain {
  /** Angular frequency (rad/s). */
  omega: number;
  /** Amplitude (m) in a calm sea; scaled by the sea state. */
  amp: number;
  /** Heading off due west/east (rad): + turns toward the pole. */
  skew: number;
}

/** The wave trains, longest first. Frequencies match `swellAt`. */
export const SWELL_TRAINS: readonly SwellTrain[] = [
  { omega: 0.9, amp: 0.07, skew: 0 },
  { omega: 2.3, amp: 0.03, skew: 0.5 },
  { omega: 3.6, amp: 0.012, skew: -0.6 },
];

/** Deep-water wavenumber (rad/m) for a frequency: ω² = g·k. */
export function deepWaterK(omega: number): number {
  return (omega * omega) / G;
}

/** Wavelength (m) of a train. */
export function swellWavelength(train: SwellTrain): number {
  return (2 * Math.PI) / deepWaterK(train.omega);
}

/**
 * Whole waves round the equator (east-west) and per radian of latitude
 * (north-south) for a train, so its crests close on themselves.
 */
export function swellWaveCounts(train: SwellTrain): { n: number; m: number } {
  const kR = deepWaterK(train.omega) * EARTH_RADIUS;
  return { n: Math.max(1, Math.round(kR * Math.cos(train.skew))), m: kR * Math.sin(train.skew) };
}

/** ω·t wrapped to [0, 2π) per train, in double precision for the shader. */
export function swellPhases(t: number, out: number[] = []): number[] {
  for (let i = 0; i < SWELL_TRAINS.length; i++) {
    const p = (SWELL_TRAINS[i].omega * t) % (2 * Math.PI);
    out[i] = p < 0 ? p + 2 * Math.PI : p;
  }
  return out;
}

const glslFloat = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * GLSL for the tide: `float seaTide(vec3 n)` using `uTideMoon`, `uTideSun`
 * (Earth-local unit vectors from `tideFrameAt`). Same formula as `tideAt`.
 */
export const SEA_TIDE_GLSL = /* glsl */ `
  uniform vec3 uTideMoon;
  uniform vec3 uTideSun;
  float seaP2(float c) { return 0.5 * (3.0 * c * c - 1.0); }
  float seaTide(vec3 n) {
    return ${glslFloat(TIDE_LUNAR_M)} * seaP2(dot(n, uTideMoon))
         + ${glslFloat(TIDE_SOLAR_M)} * seaP2(dot(n, uTideSun));
  }
`;

/**
 * GLSL for the swell slope: `vec3 seaSwellSlope(vec3 n, float dist)` returns
 * the tangent gradient of the surface height (m/m) at Earth-local unit
 * normal `n`, faded out with camera distance `dist` before a train's
 * crests would alias. Uses `uSwellPhase` (from `swellPhases`) and `uSea`
 * (sea state, 1 = calm).
 */
export const SEA_SWELL_GLSL = (() => {
  const terms = SWELL_TRAINS.map((train, i) => {
    const { n, m } = swellWaveCounts(train);
    const lambda = swellWavelength(train);
    const comp = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
    return `
    {
      float fade = 1.0 - smoothstep(${glslFloat(lambda * 8)}, ${glslFloat(lambda * 40)}, dist);
      // Trade band runs west, westerlies run east (sign of the east count).
      float a = ${glslFloat(train.amp)} * uSea * fade;
      float psiW = -${glslFloat(n)} * lon + ${glslFloat(m)} * hemi * lat - uSwellPhase.${comp};
      float psiE =  ${glslFloat(n)} * lon + ${glslFloat(m)} * hemi * lat - uSwellPhase.${comp};
      vec3 gW = (-${glslFloat(n)} * invRc) * east + (${glslFloat(m)} * hemi / R) * north;
      vec3 gE = ( ${glslFloat(n)} * invRc) * east + (${glslFloat(m)} * hemi / R) * north;
      g += a * (trade * cos(psiW) * gW + (1.0 - trade) * cos(psiE) * gE);
    }`;
  }).join('');
  return /* glsl */ `
  uniform vec3 uSwellPhase;
  uniform float uSea;
  vec3 seaSwellSlope(vec3 n, float dist) {
    const float R = ${glslFloat(EARTH_RADIUS)};
    float rc = length(n.xz);
    // Fade out toward the poles (sea ice) where latitude circles shrink.
    float polar = 1.0 - smoothstep(0.35, 0.6, abs(n.y) - 0.2);
    if (rc < 0.2 || polar <= 0.0) return vec3(0.0);
    float lon = atan(n.x, n.z);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float hemi = n.y >= 0.0 ? 1.0 : -1.0;
    vec3 east = normalize(vec3(n.z, 0.0, -n.x));
    vec3 north = normalize(cross(east, n));
    float invRc = 1.0 / (R * rc);
    float trade = 1.0 - smoothstep(0.42, 0.58, abs(n.y));
    vec3 g = vec3(0.0);
    ${terms}
    return g * polar;
  }
`;
})();
