/**
 * vessel — how a boat floats.
 *
 * Phase 2 covers the vertical only: buoyancy against weight. The hull
 * sinks until the water it pushes aside weighs as much as the boat and
 * everyone on it (Archimedes). Each extra kilogram sinks it by
 * 1 / (ρ · A_wp) metres, where A_wp is the hull's waterplane area from
 * `boatHull.ts`. The heave is a damped spring on that balance, stepped on
 * the physics clock, so a boat that is loaded settles rather than snaps.
 *
 * The swell on top of it is a shared-clock sine (`swellAt`), identical on
 * every peer, and the same number lifts the drawn deck and the walkable
 * deck, so feet and planks never part.
 *
 * Phase 3 adds the horizontal: where the boat is (an Earth-local unit
 * normal), where its bow points, and its velocity on the sea. The forces
 * are the plan's table, each one read from something the world already
 * has:
 *
 * - Wind: the weather field's own wind (`windAt`, the vector the clouds
 *   ride), passed in by the caller so this module stays pure.
 * - Sail: wind strength × sail raised × a polar curve of the angle between
 *   the bow and where the wind comes from: nothing within 40° of the wind,
 *   full on a beam or broad reach, a little less dead downwind. The field
 *   wind is the cloud-layer drift (≈ 1 m/s typical), so the sail reads its
 *   direction and strength as true wind, with `SAIL_COUPLING` tuned to give
 *   6–9 m/s in a normal wind.
 * - Keel and drag: quadratic plus linear drag, eight times stronger
 *   sideways than ahead, so the boat goes where it points.
 * - Rudder: the wheel sets a turn rate, scaled by speed (no way on, no
 *   steering).
 * - Oars: a push along the heading, and a turn from pulling one oar harder,
 *   which works even at a standstill.
 * - Sea floor: if the keel would touch the ground (`groundElevationAt`
 *   shallower than the draft) the boat stops there; it can always back off
 *   into deeper water, and the oars can still turn her where she lies.
 *   Aground, the crew can push off (`pushOff`): a shove toward the
 *   deepest water close by, with the sail let down so the wind can't drive
 *   her straight back on.
 * - Speed cap: 10 m/s on the tangent plane, like the walk cap.
 */

import { EARTH_RADIUS, type Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { BOAT_BEAM, BOAT_DECK_Y, BOAT_DRAFT, BOAT_LENGTH } from './boatSpec';
import { WATERPLANE_AREA } from './boatHull';
import { getVillageDockSite, starboardOf, travel } from './dockSite';

/** Sea water density (kg/m³). */
export const WATER_DENSITY = 1025;
export const GRAVITY = 9.81;
/** Mass of one person aboard (kg). */
export const PERSON_KG = 80;
/** Lowest freeboard (deck above water, m) at which anyone may still board. */
export const MIN_FREEBOARD = 0.2;
/** Empty boat displacement at its design draft (kg): the water its hull
 *  pushes aside at 0.6 m draft, with a block coefficient for a round
 *  bilge open boat. */
export const BOAT_EMPTY_KG = WATER_DENSITY * WATERPLANE_AREA * BOAT_DRAFT * 0.42;

/** Extra sinkage (m) for `loadKg` on board, at rest. */
export function restSinkFor(loadKg: number): number {
  return Math.max(0, loadKg) / (WATER_DENSITY * WATERPLANE_AREA);
}

/** Freeboard (m) at rest with `people` aboard. */
export function freeboardFor(people: number): number {
  return BOAT_DECK_Y - restSinkFor(people * PERSON_KG);
}

/** How many people the hull floats before freeboard drops under the limit
 *  (48: buoyancy alone would allow a crowd). */
export const BUOYANT_CAPACITY = Math.floor(
  ((BOAT_DECK_Y - MIN_FREEBOARD) * WATER_DENSITY * WATERPLANE_AREA) / PERSON_KG,
);

/** A boat's party: the most people aboard at once, crew included. A 7 m
 *  open boat is crowded well before it is low in the water. */
export const PARTY_SIZE = 10;

/** People the boat takes: the party, or fewer if buoyancy says so. */
export const BOAT_CAPACITY = Math.min(PARTY_SIZE, BUOYANT_CAPACITY);

/** True when one more person could board a boat already carrying `people`. */
export function canBoard(people: number): boolean {
  return people + 1 <= BOAT_CAPACITY && freeboardFor(people + 1) >= MIN_FREEBOARD;
}

/** Calmest sea (1) and the roughest the weather can make it. */
export const SEA_CALM = 1;
export const SEA_MAX = 3.5;
/** Seconds for the sea to build or lie down toward the weather's target. */
export const SEA_TAU_S = 8;

/**
 * Sea state (swell multiplier) from the weather at a point: wind raises
 * waves, and rain or a soaked patch (`weatherCurvatureBoost`, 0…0.85)
 * raises them more. 1 in a calm, about 1.5 in an ordinary 1 m/s breeze,
 * up to 3.5 in a squall.
 */
export function seaStateFor(windSpeed: number, weatherBoost = 0): number {
  const s = SEA_CALM + 0.5 * Math.max(0, windSpeed) + 1.5 * Math.max(0, weatherBoost);
  return Math.min(SEA_MAX, s);
}

/** Shared-clock swell (m) at time `t` (s), with a per-boat phase, scaled
 *  by the sea state `amp` (1 = calm). */
export function swellAt(t: number, phase = 0, amp = 1): number {
  return amp * (0.07 * Math.sin(t * 0.9 + phase) + 0.03 * Math.sin(t * 2.3 + 1.1 + phase * 1.7));
}

/** Small roll/pitch (rad) for the drawn hull; the deck stays level. */
export function swellTiltAt(t: number, phase = 0, amp = 1): { roll: number; pitch: number } {
  return {
    roll: amp * 0.025 * Math.sin(t * 0.7 + 0.4 + phase),
    pitch: amp * 0.012 * Math.sin(t * 1.1 + 2.0 + phase),
  };
}

// ── Horizontal motion ───────────────────────────────────────────────

/** Sail drive (m/s² per m/s of wind, full sail, best point of sail). */
export const SAIL_COUPLING = 3.4;
/** Oar drive for one rower at full stroke (m/s²): ≈ 2 m/s in a calm. */
export const ROW_ACCEL = 0.46;
/** Oar turn rate at full pull on one side (rad/s). */
export const ROW_TURN_RATE = (15 * Math.PI) / 180;
/** Rudder turn rate at full wheel and steerage way (rad/s). */
export const RUDDER_RATE = (28 * Math.PI) / 180;
/** Speed (m/s) at which the rudder reaches full effect. */
export const RUDDER_FULL_SPEED = 3;
/** Forward drag: a = −DRAG_QUAD·u|u| − DRAG_LIN·u. */
export const DRAG_QUAD = 0.04;
export const DRAG_LIN = 0.15;
/** Lateral resistance relative to forward (the keel). */
export const KEEL_RATIO = 8;
/** Tangential speed cap (m/s). */
export const BOAT_MAX_SPEED = 10;
/** No drive within this angle of the wind (rad). */
export const NO_GO_ANGLE = (40 * Math.PI) / 180;

/**
 * How the sail looks for wind on the bow (`from`, rad, as `windOnBow`) at
 * `speed` m/s: `fill` 0…1 is how full the canvas bellies (the polar's
 * drive, saturating at 0.5 m/s of wind), and `luff` 0…1 how hard it
 * flaps when pointed into the no-go zone. Drawing only; drive comes from
 * `sailForce`.
 */
export function sailFill(from: number, speed: number): { fill: number; luff: number } {
  if (speed < 0.02) return { fill: 0, luff: 0 };
  const beta = Math.abs(from);
  const strength = Math.min(1, speed / 0.5);
  const luff = beta < NO_GO_ANGLE ? (1 - beta / NO_GO_ANGLE) * 0.6 + 0.4 : 0;
  return { fill: sailPolar(beta) * strength, luff: luff * Math.min(1, speed / 0.2) };
}

/**
 * Sail polar: drive fraction for `beta`, the angle (rad, 0..π) between
 * the bow and the direction the wind blows FROM. 0 head to wind.
 */
export function sailPolar(beta: number): number {
  const b = Math.abs(beta);
  if (b < NO_GO_ANGLE) return 0;
  const reach = Math.PI / 2;
  if (b < reach) {
    const u = (b - NO_GO_ANGLE) / (reach - NO_GO_ANGLE);
    return u * u * (3 - 2 * u);
  }
  const broad = (135 * Math.PI) / 180;
  if (b <= broad) return 1;
  const u = (b - broad) / (Math.PI - broad);
  return 1 - 0.3 * u;
}

export interface HelmCommand {
  /** Wheel position −1 (port) … 1 (starboard). */
  wheel: number;
  /** Sail raised 0 … 1. */
  sail: number;
  /** Oar stroke −1 (back water) … 1 (row ahead). */
  row: number;
  /** Oar turn −1 (to port) … 1 (to starboard). */
  rowTurn: number;
}

export interface MotionState {
  /** Earth-local unit normal under the boat's centre. */
  n: Vec3;
  /** Earth-local unit tangent the bow points along. */
  heading: Vec3;
  /** Velocity on the tangent plane (m/s, Earth-local vector). */
  vel: Vec3;
  /** Turn rate (rad/s, + = to starboard, clockwise seen from above). */
  yawRate: number;
  aground: boolean;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Project a vector onto the tangent plane at n. */
function tangent(v: Vec3, n: Vec3): Vec3 {
  const d = dot3(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}

/** Rotate tangent t about normal n by angle a (+ = toward starboard). */
function yawTangent(t: Vec3, n: Vec3, a: number): Vec3 {
  const s = starboardOf(n, t);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return norm3([t[0] * c + s[0] * sn, t[1] * c + s[1] * sn, t[2] * c + s[2] * sn]);
}

/** How far (m) a grounded keel may scrape into the sand while pivoting. */
const PIVOT_SCRAPE_M = 0.2;

/** Water under the keel (m, + = clear) at the bow, centre and stern. */
export function keelClearance(n: Vec3, heading: Vec3, sink = 0): number {
  const draft = BOAT_DRAFT + sink;
  let worst = Infinity;
  for (const along of [-BOAT_LENGTH / 2 + 0.4, 0, BOAT_LENGTH / 2 - 0.4]) {
    const p = along === 0 ? n : travel(n, heading, along);
    worst = Math.min(worst, -groundElevationAt(p) - draft);
  }
  return worst;
}

/** Drive from wind and sail on the tangent plane (m/s²). */
export function sailForce(heading: Vec3, n: Vec3, wind: Vec3, sail: number): Vec3 {
  const w = tangent(wind, n);
  const speed = Math.hypot(w[0], w[1], w[2]);
  if (speed < 1e-9 || sail <= 0) return [0, 0, 0];
  // The wind blows toward w; it comes FROM −w.
  const from: Vec3 = [-w[0] / speed, -w[1] / speed, -w[2] / speed];
  const beta = Math.acos(Math.max(-1, Math.min(1, dot3(heading, from))));
  const drive = SAIL_COUPLING * speed * Math.min(1, Math.max(0, sail)) * sailPolar(beta);
  return [heading[0] * drive, heading[1] * drive, heading[2] * drive];
}

/**
 * One motion step. Pure: wind and commands are inputs; the sea floor is
 * read through `groundElevationAt`.
 */
export function stepMotion(
  m: MotionState,
  cmd: HelmCommand,
  wind: Vec3,
  dt: number,
  sink = 0,
): MotionState {
  const { n } = m;
  const h = m.heading;
  const s = starboardOf(n, h);
  let vel = tangent(m.vel, n);

  // Forces along the heading: sail + oars.
  const sail = sailForce(h, n, wind, cmd.sail);
  // Several rowers add up (each pulls one stroke's worth); cap at four.
  const row = ROW_ACCEL * Math.max(-4, Math.min(4, cmd.row));
  let u = dot3(vel, h);
  let v = dot3(vel, s);
  const aSail = dot3(sail, h);
  // Drag: forward, and the keel's much larger sideways resistance.
  const du = aSail + row - (DRAG_QUAD * u * Math.abs(u) + DRAG_LIN * u);
  u += du * dt;
  // Sideways the keel resists eight times harder; integrated implicitly so
  // the stiff term stays stable at the 60 Hz step.
  v = v / (1 + KEEL_RATIO * (DRAG_LIN + DRAG_QUAD * Math.abs(v)) * dt);
  vel = [h[0] * u + s[0] * v, h[1] * u + s[1] * v, h[2] * u + s[2] * v];
  const sp = Math.hypot(vel[0], vel[1], vel[2]);
  if (sp > BOAT_MAX_SPEED) {
    const k = BOAT_MAX_SPEED / sp;
    vel = [vel[0] * k, vel[1] * k, vel[2] * k];
    u *= k;
  }

  // Turning: rudder needs way on; oars turn even at rest.
  const way = Math.min(1, Math.abs(u) / RUDDER_FULL_SPEED) * Math.sign(u);
  const target =
    RUDDER_RATE * Math.max(-1, Math.min(1, cmd.wheel)) * way +
    ROW_TURN_RATE * Math.max(-2, Math.min(2, cmd.rowTurn));
  const yawRate = m.yawRate + (target - m.yawRate) * Math.min(1, dt / 0.5);

  // Move along the sphere.
  const dist = Math.hypot(vel[0], vel[1], vel[2]) * dt;
  let n2 = n;
  let h2 = h;
  let vel2 = vel;
  if (dist > 1e-9) {
    const dir = norm3(vel);
    n2 = travel(n, dir, dist);
    // Parallel-transport heading and velocity to the new tangent plane.
    h2 = norm3(tangent(h, n2));
    vel2 = tangent(vel, n2);
  }
  h2 = yawTangent(h2, n2, yawRate * dt);

  // Sea floor: refuse a step that drives the keel further into the ground.
  const before = keelClearance(n, h, sink);
  const after = keelClearance(n2, h2, sink);
  if (after < 0 && after < before) {
    // Stuck: no way on. Still let her pivot where she lies (the oars turn
    // her even at rest): the keel may scrape a little deeper on the sand
    // (to PIVOT_SCRAPE_M), never further.
    if (Math.abs(yawRate) > 1e-6) {
      const hTurn = yawTangent(h, n, yawRate * dt);
      const turned = keelClearance(n, hTurn, sink);
      if (turned >= -PIVOT_SCRAPE_M || turned >= before) return { n, heading: hTurn, vel: [0, 0, 0], yawRate, aground: true };
    }
    return { n, heading: h, vel: [0, 0, 0], yawRate: 0, aground: true };
  }
  return { n: n2, heading: h2, vel: vel2, yawRate, aground: after < 0 };
}

// ── Pushing off ────

/** Speed (m/s) a push off gives the boat. */
export const PUSH_OFF_SPEED = 1.6;
/** How far ahead (m) a push off looks for deeper water. */
const PUSH_OFF_LOOK_M = 4;

/**
 * Which way to push a grounded boat: the direction (Earth-local tangent)
 * whose water `PUSH_OFF_LOOK_M` away is deepest under the keel. Astern
 * and ahead are tried first since the keel slides that way easiest; a
 * sideways shove only wins when it is clearly better. Null when nothing
 * close by is any deeper.
 */
export function pushOffDirection(n: Vec3, heading: Vec3, sink = 0): Vec3 | null {
  const s = starboardOf(n, heading);
  const here = keelClearance(n, heading, sink);
  let best: Vec3 | null = null;
  let bestScore = here + 0.02;
  // Angles from astern (π) round both ways, with a small penalty for
  // sideways pushes that the keel fights.
  for (const a of [Math.PI, 0, (3 * Math.PI) / 4, -(3 * Math.PI) / 4, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const dir = norm3([
      heading[0] * Math.cos(a) + s[0] * Math.sin(a),
      heading[1] * Math.cos(a) + s[1] * Math.sin(a),
      heading[2] * Math.cos(a) + s[2] * Math.sin(a),
    ]);
    const n2 = travel(n, dir, PUSH_OFF_LOOK_M);
    const h2 = norm3(tangent(heading, n2));
    const score = keelClearance(n2, h2, sink) - 0.15 * Math.abs(Math.sin(a));
    if (score > bestScore) { bestScore = score; best = dir; }
  }
  return best;
}

/**
 * Push a grounded boat off toward deeper water. Lets the sail down too,
 * so the wind doesn't put her straight back on. Returns false when she
 * isn't aground or no deeper water is within reach.
 */
export function pushOff(m: MotionState, cmd: HelmCommand, sink = 0): MotionState | null {
  if (!m.aground) return null;
  const dir = pushOffDirection(m.n, m.heading, sink);
  if (!dir) return null;
  cmd.sail = 0;
  return {
    ...m,
    vel: [dir[0] * PUSH_OFF_SPEED, dir[1] * PUSH_OFF_SPEED, dir[2] * PUSH_OFF_SPEED],
    yawRate: 0,
    aground: false,
  };
}

// ── Hull contact ────────────────────────────────────────────────────

/** A hull or a jetty as a capsule on the sea: centre line from `a` to `b`
 *  (Earth-local unit normals) with `radius` metres either side. */
export interface Capsule {
  a: Vec3;
  b: Vec3;
  radius: number;
}

const BOAT_BEAM_HALF = BOAT_BEAM / 2;

/** The capsule a boat at (n, heading) occupies. */
export function hullCapsule(n: Vec3, heading: Vec3): Capsule {
  const half = BOAT_LENGTH / 2 - BOAT_BEAM_HALF;
  return { a: travel(n, heading, half), b: travel(n, heading, -half), radius: BOAT_BEAM_HALF };
}


/** Closest points between segments p1p2 and q1q2 in a local 2-D plane. */
function segSegDist(
  p1: [number, number], p2: [number, number], q1: [number, number], q2: [number, number],
): { d: number; dx: number; dy: number } {
  const d1: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]];
  const d2: [number, number] = [q2[0] - q1[0], q2[1] - q1[1]];
  const r: [number, number] = [p1[0] - q1[0], p1[1] - q1[1]];
  const a = d1[0] * d1[0] + d1[1] * d1[1];
  const e = d2[0] * d2[0] + d2[1] * d2[1];
  const f = d2[0] * r[0] + d2[1] * r[1];
  let sP = 0;
  let tQ = 0;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (a <= 1e-12 && e <= 1e-12) { sP = 0; tQ = 0; }
  else if (a <= 1e-12) { sP = 0; tQ = clamp(f / e); }
  else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e <= 1e-12) { tQ = 0; sP = clamp(-c / a); }
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1];
      const denom = a * e - b * b;
      sP = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      tQ = (b * sP + f) / e;
      if (tQ < 0) { tQ = 0; sP = clamp(-c / a); }
      else if (tQ > 1) { tQ = 1; sP = clamp((b - c) / a); }
    }
  }
  const cx = p1[0] + d1[0] * sP - (q1[0] + d2[0] * tQ);
  const cy = p1[1] + d1[1] * sP - (q1[1] + d2[1] * tQ);
  return { d: Math.hypot(cx, cy), dx: cx, dy: cy };
}

/**
 * Push a boat out of a capsule it overlaps (another hull, the jetty). The
 * contact works in the tangent plane at the boat's centre. Returns the
 * corrected motion; the velocity component into the obstacle is removed,
 * so boats bump and stop rather than pass through.
 */
export function resolveHullContact(m: MotionState, other: Capsule): MotionState {
  const n = m.n;
  const ex = starboardOf(n, m.heading);
  const ez = m.heading;
  const to2 = (p: Vec3): [number, number] => {
    const d: Vec3 = [p[0] - n[0], p[1] - n[1], p[2] - n[2]];
    return [dot3(d, ex) * EARTH_RADIUS, dot3(d, ez) * EARTH_RADIUS];
  };
  const mine = hullCapsule(m.n, m.heading);
  const hit = segSegDist(to2(mine.a), to2(mine.b), to2(other.a), to2(other.b));
  const minD = mine.radius + other.radius;
  if (hit.d >= minD) return m;
  let nx = hit.dx;
  let ny = hit.dy;
  let len = hit.d;
  if (len < 1e-6) { nx = 1; ny = 0; len = 1; }
  nx /= len; ny /= len;
  const push = minD - hit.d;
  const dir: Vec3 = norm3([ex[0] * nx + ez[0] * ny, ex[1] * nx + ez[1] * ny, ex[2] * nx + ez[2] * ny]);
  const n2 = travel(n, dir, push);
  const heading = norm3(tangent(m.heading, n2));
  let vel = tangent(m.vel, n2);
  const vIn = dot3(vel, dir);
  if (vIn < 0) vel = [vel[0] - dir[0] * vIn, vel[1] - dir[1] * vIn, vel[2] - dir[2] * vIn];
  return { ...m, n: n2, heading, vel };
}


export interface HeaveState {
  /** Sinkage below the design waterline from load (m, + = deeper). */
  sink: number;
  /** Rate of change of sink (m/s). */
  rate: number;
}

/**
 * One heave step. Restoring force ρ·g·A_wp·(sinkRest − sink) against the
 * boat-plus-load mass, critically damped so it settles in a couple of
 * seconds without bouncing.
 */
export function stepHeave(state: HeaveState, loadKg: number, dt: number): HeaveState {
  const mass = BOAT_EMPTY_KG + Math.max(0, loadKg);
  const k = WATER_DENSITY * GRAVITY * WATERPLANE_AREA;
  const omega = Math.sqrt(k / mass);
  const target = restSinkFor(loadKg);
  const acc = omega * omega * (target - state.sink) - 2 * omega * state.rate;
  // Semi-implicit Euler: stable at the 60 Hz physics step for ω ≈ 4 rad/s.
  const rate = state.rate + acc * dt;
  const sink = state.sink + rate * dt;
  return { sink, rate };
}

/**
 * A boat's floating state. One instance per boat; the moored village boat
 * is `getVillageBoat()`.
 */
export class Vessel {
  readonly id: string;
  readonly phase: number;
  heave: HeaveState = { sink: 0, rate: 0 };
  people = 0;
  motion: MotionState;
  /** Live controls, eased toward the helm and oar inputs. */
  cmd: HelmCommand = { wheel: 0, sail: 0, row: 0, rowTurn: 0 };
  /** Last wind the boat felt (Earth-local tangent, m/s). */
  wind: Vec3 = [0, 0, 0];
  /** Sea state here (swell multiplier, 1 = calm), eased toward `seaTarget`. */
  sea = SEA_CALM;
  seaTarget = SEA_CALM;

  constructor(id: string, phase = 0, at?: { n: Vec3; heading: Vec3 }) {
    this.id = id;
    this.phase = phase;
    const n = at?.n ?? [0, 1, 0];
    const heading = at?.heading ?? [0, 0, -1];
    this.motion = { n, heading, vel: [0, 0, 0], yawRate: 0, aground: false };
  }

  /** Advance the boat across the sea under `wind` (Earth-local tangent, m/s). */
  stepMotion(dt: number, wind: Vec3): void {
    this.wind = wind;
    this.motion = stepMotion(this.motion, this.cmd, wind, dt, this.heave.sink);
  }

  /** Push off when aground (see `pushOff`). True if she moved. */
  pushOff(): boolean {
    const next = pushOff(this.motion, this.cmd, this.heave.sink);
    if (!next) return false;
    this.motion = next;
    return true;
  }

  /**
   * Wind relative to the bow: `from` is the angle (rad, −π..π) the wind
   * blows from, 0 dead ahead, + from starboard; `speed` in m/s.
   */
  windOnBow(): { from: number; speed: number } {
    const { n, heading: h } = this.motion;
    const w = tangent(this.wind, n);
    const speed = Math.hypot(w[0], w[1], w[2]);
    if (speed < 1e-9) return { from: 0, speed: 0 };
    const s = starboardOf(n, h);
    return { from: Math.atan2(-dot3(w, s), -dot3(w, h)), speed };
  }

  /** Forward speed (m/s, + = ahead). */
  speed(): number {
    return dot3(this.motion.vel, this.motion.heading);
  }

  setPeople(n: number): void {
    this.people = Math.max(0, Math.floor(n));
  }

  step(dt: number): void {
    this.heave = stepHeave(this.heave, this.people * PERSON_KG, dt);
    this.stepSea(dt);
  }

  /** The sea builds and lies down slowly, so the deck never lurches. */
  stepSea(dt: number): void {
    this.sea += (this.seaTarget - this.sea) * (1 - Math.exp(-dt / SEA_TAU_S));
  }

  /** Waterline offset of the boat frame at time t (m): swell − load sink. */
  waterlineAt(t: number): number {
    return swellAt(t, this.phase, this.sea) - this.heave.sink;
  }

  /** Drawn roll and pitch now (rad). */
  tiltAt(t: number): { roll: number; pitch: number } {
    return swellTiltAt(t, this.phase, this.sea);
  }

  /** Walkable deck elevation above sea level at time t (m). */
  deckTopAt(t: number): number {
    return BOAT_DECK_Y + this.waterlineAt(t);
  }

  freeboard(): number {
    return BOAT_DECK_Y - this.heave.sink;
  }

  canBoard(): boolean {
    return canBoard(this.people);
  }
}

let village: Vessel | null = null;
let focusResolver: (() => Vessel | null) | null = null;

/**
 * Let the fleet decide which boat "the boat" means for this player: the
 * one they crew, else the one they own, else the dock boat.
 */
export function setFocusBoatResolver(fn: (() => Vessel | null) | null): void {
  focusResolver = fn;
}

/** The boat this player is concerned with (see `setFocusBoatResolver`). */
export function getVillageBoat(): Vessel {
  const focused = focusResolver?.();
  if (focused) return focused;
  return getDockVessel();
}

/** A fresh boat moored at the village berth. */
export function newDockVessel(id: string): Vessel {
  const site = getVillageDockSite();
  return new Vessel(id, 0, site ? { n: site.boatCenter, heading: site.boatHeading } : undefined);
}

function getDockVessel(): Vessel {
  if (!village) village = newDockVessel('village-boat');
  return village;
}

const resetHooks: (() => void)[] = [];

/** Modules holding boats (the fleet) reset with the village boat in tests. */
export function onVesselReset(fn: () => void): void {
  resetHooks.push(fn);
}

export function _resetVillageBoatForTest(): void {
  village = null;
  for (const fn of resetHooks) fn();
}
