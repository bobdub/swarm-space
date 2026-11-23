/**
 * lavaFlows — where lava goes when the shared volcano overflows, and how
 * far and how hot it is at any shared moment.
 *
 * Paths. Lava leaves the summit pond over its lowest edges and runs down
 * the steepest descent of the RENDERED ground (`sampleTerrainLift`, the
 * same baked triangles the player walks on), with a little inertia so a
 * tongue does not zig-zag across mesh facets. Up to `MAX_TONGUES` tongues
 * leave from the lowest summit saddles, each at least
 * `MIN_TONGUE_SEPARATION_DEG` apart. The terrain is deterministic, so every
 * peer traces the same paths; they are computed once and cached.
 *
 * Advance. A cooling-limited flow stops where its crust can no longer be
 * broken, so its run-out length scales with effusion rate (Walker 1973;
 * Pinkerton & Wilson 1994). Each tongue's front runs out as
 * s(τ) = L·(1 − e^(−τ/τ_adv)) while the vent feeds it, and stops when
 * effusion ends. Later tongues start once the pond has risen to their
 * higher saddle.
 *
 * Cooling. Fresh lava radiates; the channel near the vent stays
 * incandescent while it is fed, the front glows where it breaks crust, and
 * once supply stops the whole flow crusts over and darkens
 * (e-folding `COOL_S`). The cold basalt then weathers into the slope over
 * `WEATHER_S`, before the next eruption.
 */
import { EARTH_RADIUS, type Vec3 } from './earth';
import { sampleTerrainLift } from './terrainMesh';
import { sampleVolcanoElevation, type VolcanoOrgan } from './volcanoOrgan';
import { eruptionCycleAt, eruptionStateAt } from './eruptionCycle';

export const MAX_TONGUES = 3;
export const MIN_TONGUE_SEPARATION_DEG = 80;
/** Path step (m) along the ground. */
export const FLOW_STEP_M = 3;
/** Longest a tongue can run (m). */
export const MAX_FLOW_M = 240;
/** Where tongues start: inside the summit pond (m from the vent). */
const START_R_M = 12;
/** Ring (m from the vent) searched for the lowest saddles. */
const SADDLE_R_M = 24;
/** Seconds for the crust to darken once supply stops. */
export const COOL_S = 90;
/** Seconds for cold basalt to weather back into the slope. */
export const WEATHER_S = 900;
/** Share of each tongue's path it can reach at full intensity. */
const REACH = [1, 0.7, 0.45];
/** Eruption intensity needed before each tongue spills. */
const MIN_INTENSITY = [0, 0.4, 0.52];
/** Seconds after onset each tongue starts (the pond must rise to it). */
const START_DELAY_S = [4, 18, 32];

export interface FlowPath {
  /** Earth-local unit directions of the centreline, every FLOW_STEP_M. */
  dirs: Vec3[];
  /** Ground lift (m above EARTH_RADIUS) under each centreline point. */
  lift: number[];
  /** Distance (m) along the path at each point. */
  s: number[];
  /** Earth-local unit tangent-plane direction "to the left" of travel. */
  left: Vec3[];
  /** Total length (m). */
  length: number;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
/** Move `metres` from unit `d` along tangent unit `dir` (great circle). */
export function stepOnSphere(d: Vec3, dir: Vec3, metres: number): Vec3 {
  const a = metres / EARTH_RADIUS;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return norm([d[0] * c + dir[0] * s, d[1] * c + dir[1] * s, d[2] * c + dir[2] * s]);
}
/** Project `v` onto the tangent plane at `d`, normalised. */
function tangent(d: Vec3, v: Vec3): Vec3 {
  const k = dot(v, d);
  return norm([v[0] - d[0] * k, v[1] - d[1] * k, v[2] - d[2] * k]);
}

/** A fixed tangent basis at the vent (matches no particular renderer). */
export function ventBasis(organ: VolcanoOrgan): { n: Vec3; e1: Vec3; e2: Vec3 } {
  const n = norm(organ.centerNormal);
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(ref, n));
  const e2 = cross(n, e1);
  return { n, e1, e2 };
}

/** Downhill unit tangent at `d` (−∇lift), and the slope magnitude. */
function downhill(d: Vec3, h = 4): { dir: Vec3; slope: number } {
  const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(ref, d));
  const b = cross(d, a);
  const ga = (sampleTerrainLift(stepOnSphere(d, a, h)) - sampleTerrainLift(stepOnSphere(d, a, -h))) / (2 * h);
  const gb = (sampleTerrainLift(stepOnSphere(d, b, h)) - sampleTerrainLift(stepOnSphere(d, b, -h))) / (2 * h);
  const slope = Math.hypot(ga, gb);
  if (slope < 1e-9) return { dir: a, slope: 0 };
  return {
    dir: norm([-(a[0] * ga + b[0] * gb), -(a[1] * ga + b[1] * gb), -(a[2] * ga + b[2] * gb)]),
    slope,
  };
}

/** Azimuths (radians, in `ventBasis`) of the lowest summit saddles. */
export function saddleAzimuths(organ: VolcanoOrgan): number[] {
  const { n, e1, e2 } = ventBasis(organ);
  const samples: { az: number; lift: number }[] = [];
  for (let i = 0; i < 72; i++) {
    const az = (i / 72) * Math.PI * 2;
    const dir: Vec3 = [
      e1[0] * Math.cos(az) + e2[0] * Math.sin(az),
      e1[1] * Math.cos(az) + e2[1] * Math.sin(az),
      e1[2] * Math.cos(az) + e2[2] * Math.sin(az),
    ];
    samples.push({ az, lift: sampleTerrainLift(stepOnSphere(n, dir, SADDLE_R_M)) });
  }
  samples.sort((a, b) => a.lift - b.lift || a.az - b.az);
  const chosen: number[] = [];
  const sep = (MIN_TONGUE_SEPARATION_DEG * Math.PI) / 180;
  for (const s of samples) {
    if (chosen.length >= MAX_TONGUES) break;
    const clear = chosen.every((az) => {
      const d = Math.abs(((s.az - az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d >= sep;
    });
    if (clear) chosen.push(s.az);
  }
  return chosen;
}

function tracePath(organ: VolcanoOrgan, az: number): FlowPath {
  const { n, e1, e2 } = ventBasis(organ);
  const radial: Vec3 = [
    e1[0] * Math.cos(az) + e2[0] * Math.sin(az),
    e1[1] * Math.cos(az) + e2[1] * Math.sin(az),
    e1[2] * Math.cos(az) + e2[2] * Math.sin(az),
  ];
  let d = stepOnSphere(n, radial, START_R_M);
  // Heading: start radially outward, carried along the great circle.
  let heading = tangent(d, radial);
  const dirs: Vec3[] = [];
  const lift: number[] = [];
  const s: number[] = [];
  const left: Vec3[] = [];
  let travelled = 0;
  for (;;) {
    dirs.push(d);
    lift.push(sampleTerrainLift(d));
    s.push(travelled);
    left.push(cross(d, heading));
    if (travelled >= MAX_FLOW_M) break;
    // Off the cone (or into a flat): the flow spreads out and stops.
    if (travelled > SADDLE_R_M && sampleVolcanoElevation(organ, d) < 2) break;
    const g = downhill(d);
    if (travelled > SADDLE_R_M && g.slope < 0.02) break;
    // Inertia: lava keeps some of its heading over a mesh crease.
    const blend = travelled < SADDLE_R_M - START_R_M ? 0.25 : 0.55;
    heading = tangent(d, [
      heading[0] * (1 - blend) + g.dir[0] * blend,
      heading[1] * (1 - blend) + g.dir[1] * blend,
      heading[2] * (1 - blend) + g.dir[2] * blend,
    ]);
    const next = stepOnSphere(d, heading, FLOW_STEP_M);
    // Carry the heading to the new point (parallel transport on a sphere).
    heading = tangent(next, heading);
    d = next;
    travelled += FLOW_STEP_M;
  }
  return { dirs, lift, s, left, length: travelled };
}

const _paths = new WeakMap<VolcanoOrgan, FlowPath[]>();

/** The tongues' paths, traced once per organ. */
export function lavaFlowPaths(organ: VolcanoOrgan): FlowPath[] {
  const cached = _paths.get(organ);
  if (cached) return cached;
  const paths = saddleAzimuths(organ).map((az) => tracePath(organ, az));
  _paths.set(organ, paths);
  return paths;
}

/** Half-width (m) of a tongue at distance `s` along it. */
export function flowHalfWidthAt(s: number): number {
  return 4 * (0.55 + 0.45 * Math.exp(-s / 60));
}

export interface LavaFlowState {
  /** Front distance (m) of each tongue; 0 = not started. */
  fronts: number[];
  /** How bright the front is (0 … 1), from how fast it is advancing. */
  frontGlow: number[];
  /** Feed through the channel (0 … 1): effusion while erupting. */
  feed: number;
  /** Heat left in the crust (1 fresh … 0 cold). */
  heat: number;
  /** Visibility of the flow field (1 … 0 as old basalt weathers). */
  presence: number;
}

/**
 * Tongue fronts and heat at shared time `t`. Shows the latest eruption
 * that has begun: this cycle's once its onset has passed, otherwise the
 * last cycle's cooling, weathering field.
 */
export function lavaFlowStateAt(organ: VolcanoOrgan, t: number): LavaFlowState {
  const paths = lavaFlowPaths(organ);
  const state = eruptionStateAt(t);
  let cycle = state.cycle;
  let sinceOnset = state.sinceOnsetS;
  if (sinceOnset < 0) {
    cycle = eruptionCycleAt(cycle.index - 1);
    sinceOnset = t - (cycle.startS + cycle.onsetS);
  }
  const sinceEnd = sinceOnset - cycle.durationS;
  const advanceS = cycle.durationS / 2.5;
  const fronts: number[] = [];
  const frontGlow: number[] = [];
  for (let i = 0; i < paths.length; i++) {
    const delay = START_DELAY_S[i] ?? 40;
    // Weaker eruptions do not feed enough lava to spill over later saddles.
    const spills = cycle.intensity >= (MIN_INTENSITY[i] ?? 1);
    const L = spills ? paths[i].length * (REACH[i] ?? 0.3) * Math.min(1, 0.35 + 0.75 * cycle.intensity) : 0;
    const fed = Math.max(0, Math.min(sinceOnset, cycle.durationS) - delay);
    fronts.push(L * (1 - Math.exp(-fed / advanceS)));
    const advancing = L > 0 && sinceOnset > delay && sinceEnd < 0;
    frontGlow.push(advancing ? Math.exp(-fed / advanceS) * 0.7 + 0.3 : 0);
  }
  const feed = sinceEnd < 0 ? Math.exp(-sinceOnset / (cycle.durationS * 0.5)) : 0;
  const heat = sinceEnd < 0 ? 1 : Math.exp(-sinceEnd / COOL_S);
  const presence = sinceEnd < 0 ? 1 : Math.max(0, 1 - sinceEnd / WEATHER_S);
  return { fronts, frontGlow, feed, heat, presence };
}
