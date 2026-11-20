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
 *   into deeper water.
 * - Speed cap: 10 m/s on the tangent plane, like the walk cap.
 */

import type { Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { BOAT_DECK_Y, BOAT_DRAFT, BOAT_LENGTH } from './boatSpec';
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

/** How many people the boat carries before freeboard drops under the limit. */
export const BOAT_CAPACITY = Math.floor(
  ((BOAT_DECK_Y - MIN_FREEBOARD) * WATER_DENSITY * WATERPLANE_AREA) / PERSON_KG,
);

/** True when one more person could board a boat already carrying `people`. */
export function canBoard(people: number): boolean {
  return freeboardFor(people + 1) >= MIN_FREEBOARD;
}

/** Shared-clock swell (m) at time `t` (s), with a per-boat phase. */
export function swellAt(t: number, phase = 0): number {
  return 0.07 * Math.sin(t * 0.9 + phase) + 0.03 * Math.sin(t * 2.3 + 1.1 + phase * 1.7);
}

/** Small roll/pitch (rad) for the drawn hull; the deck stays level. */
export function swellTiltAt(t: number, phase = 0): { roll: number; pitch: number } {
  return {
    roll: 0.025 * Math.sin(t * 0.7 + 0.4 + phase),
    pitch: 0.012 * Math.sin(t * 1.1 + 2.0 + phase),
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
  const row = ROW_ACCEL * Math.max(-1, Math.min(1, cmd.row));
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
    ROW_TURN_RATE * Math.max(-1, Math.min(1, cmd.rowTurn));
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
    return { n, heading: h, vel: [0, 0, 0], yawRate: 0, aground: true };
  }
  return { n: n2, heading: h2, vel: vel2, yawRate, aground: after < 0 };
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
  }

  /** Waterline offset of the boat frame at time t (m): swell − load sink. */
  waterlineAt(t: number): number {
    return swellAt(t, this.phase) - this.heave.sink;
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

export function getVillageBoat(): Vessel {
  if (!village) {
    const site = getVillageDockSite();
    village = new Vessel(
      'village-boat',
      0,
      site ? { n: site.boatCenter, heading: site.boatHeading } : undefined,
    );
  }
  return village;
}

export function _resetVillageBoatForTest(): void {
  village = null;
}
