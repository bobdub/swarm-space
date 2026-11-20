/**
 * villageBoat — the moored village boat as a place you can be.
 *
 * Mounting it registers the boat's deck (outline from `boatHull.ts`,
 * height from the `Vessel` float state) and steps its float on the
 * physics clock, counting who stands on the deck so the hull settles
 * under their weight.
 *
 * It also answers "what can I do from here?" for the hold buttons:
 * board from the jetty, climb aboard from the water by the ladder or a
 * gate, or nothing. Boarding is refused once one more person would push
 * the freeboard under `MIN_FREEBOARD`.
 */

import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  earthLocalToWorld,
  getEarthPose,
  getEarthPoseTime,
  quatRotate,
  type Vec3,
} from '../earth';
import { PHYSICS_HZ, type UqrcPhysics } from '../uqrcPhysics';
import { HALF_L, railHalfWidthAt } from './boatHull';
import { boatDeck, fromBoatFrame, toBoatFrame, type BoatFrame } from './boatDeck';
import { registerDeckSurface } from './deckSupport';
import { getVillageDockSite } from './dockSite';
import { getVillageBoat, type Vessel } from './vessel';
import {
  canRow,
  chargeRowing,
  getCrewInput,
  getCrewRole,
  getCrewSelfId,
  leaveRole,
  type CrewRole,
} from './crew';

export const VILLAGE_BOAT_DECK_ID = 'village-boat-deck';

/** How close to the boat's gate you must stand on the jetty to board (m). */
export const BOARD_REACH_M = 4.5;
/** How close a swimmer must be to the ladder or a gate to climb aboard (m). */
export const CLIMB_REACH_M = 2.2;

/** Where the village boat is right now (it starts at the dock berth). */
export function villageBoatFrame(): BoatFrame | null {
  if (!getVillageDockSite()) return null;
  const m = getVillageBoat().motion;
  return { center: m.n, heading: m.heading };
}

/** Helm station: just aft of the wheel, facing the bow. */
export const HELM_SPOT: [number, number] = [0, 3.0];
/** Oar station: on the rowing bench. */
export const OARS_SPOT: [number, number] = [0, 1.2];
const STATION_REACH_M = 1.3;
/** How often the wind is re-read from the field (physics ticks). */
const WIND_EVERY_TICKS = 15;
/** Wheel and sail rates (per second). */
const WHEEL_RATE = 2;
const SAIL_RATE = 0.4;

interface BodyPlace {
  x: number;
  z: number;
  feet: number;
  /** Feet minus the deck top right now. */
  aboveDeck: number;
}

function placeOf(frame: BoatFrame, vessel: Vessel, pos: [number, number, number], t: number): BodyPlace | null {
  const pose = getEarthPose();
  const rx = pos[0] - pose.center[0];
  const ry = pos[1] - pose.center[1];
  const rz = pos[2] - pose.center[2];
  const r = Math.hypot(rx, ry, rz);
  if (!(r > 1e-6)) return null;
  const n = quatRotate(pose.invSpinQuat, [rx / r, ry / r, rz / r]);
  const { x, z } = toBoatFrame(frame, n, EARTH_RADIUS);
  const feet = r - BODY_SHELL_RADIUS - FOOT_CUSHION;
  return { x, z, feet, aboveDeck: feet - vessel.deckTopAt(t) };
}

/** True when a body at this place is standing on the boat's deck. */
export function isOnDeck(p: BodyPlace): boolean {
  if (p.z < -HALF_L || p.z > HALF_L) return false;
  if (Math.abs(p.x) > railHalfWidthAt(p.z)) return false;
  return p.aboveDeck > -0.45 && p.aboveDeck < 1.6;
}

/** Number of walkers standing on the village boat's deck now. */
export function countAboard(physics: UqrcPhysics, frame: BoatFrame, vessel: Vessel, t: number): number {
  let n = 0;
  for (const b of physics.getBodies()) {
    if (b.kind !== 'self' && b.kind !== 'avatar') continue;
    if (b.meta?.attachedTo !== 'earth-surface') continue;
    const p = placeOf(frame, vessel, b.pos, t);
    if (p && isOnDeck(p)) n++;
  }
  return n;
}

export interface MountOptions {
  /** Wind at an Earth-local normal (tangent vector, m/s). Defaults to calm;
   *  the scene passes the weather field's `windAt`. */
  wind?: (n: Vec3) => Vec3;
}

function approach(value: number, target: number, rate: number, dt: number): number {
  const d = target - value;
  const max = rate * dt;
  return value + Math.max(-max, Math.min(max, d));
}

/**
 * Register the deck, then on every physics tick: float the boat, read the
 * crew's controls, move the boat under wind, sail and oars, carry everyone
 * on deck along with it, and hold a crew member at their station.
 * Returns the cleanup.
 */
export function mountVillageBoat(physics: UqrcPhysics, opts: MountOptions = {}): () => void {
  if (!villageBoatFrame()) return () => {};
  const vessel = getVillageBoat();
  const off = registerDeckSurface(
    boatDeck({
      id: VILLAGE_BOAT_DECK_ID,
      frame: () => villageBoatFrame()!,
      radius: EARTH_RADIUS,
      top: () => vessel.deckTopAt(getEarthPoseTime()),
    }),
  );
  const windFn = opts.wind ?? (() => [0, 0, 0] as Vec3);
  let wind: Vec3 = [0, 0, 0];
  let tick = 0;
  const dt = 1 / PHYSICS_HZ;
  const unsub = physics.subscribe(() => {
    const t = getEarthPoseTime();
    const before = villageBoatFrame()!;

    // Who is aboard (in the frame the physics just stepped against).
    const aboard: { id: string; x: number; z: number }[] = [];
    for (const b of physics.getBodies()) {
      if (b.kind !== 'self' && b.kind !== 'avatar') continue;
      if (b.meta?.attachedTo !== 'earth-surface') continue;
      const p = placeOf(before, vessel, b.pos, t);
      if (p && isOnDeck(p)) aboard.push({ id: b.id, x: p.x, z: p.z });
    }
    vessel.setPeople(aboard.length);
    vessel.step(dt);

    // Controls: the helm's wheel and sail, the oars' stroke.
    const role = getCrewRole();
    const input = getCrewInput();
    const cmd = vessel.cmd;
    const atHelm = role === 'helm';
    cmd.wheel = approach(cmd.wheel, atHelm ? input.wheel : 0, WHEEL_RATE, dt);
    if (atHelm && input.sail !== 0) {
      cmd.sail = approach(cmd.sail, input.sail > 0 ? 1 : 0, SAIL_RATE, dt);
    }
    const pulling = role === 'oars' && (Math.abs(input.row) > 0.05 || Math.abs(input.rowTurn) > 0.05);
    const rowing = pulling && canRow();
    cmd.row = rowing ? input.row : 0;
    cmd.rowTurn = rowing ? input.rowTurn : 0;

    if (tick++ % WIND_EVERY_TICKS === 0) {
      try { wind = windFn(vessel.motion.n); } catch { wind = [0, 0, 0]; }
    }
    const n0 = vessel.motion.n;
    vessel.stepMotion(dt, wind);
    const after = villageBoatFrame()!;
    if (rowing) {
      const c = n0[0] * after.center[0] + n0[1] * after.center[1] + n0[2] * after.center[2];
      chargeRowing(Math.acos(Math.min(1, c)) * EARTH_RADIUS);
    }

    // Carry everyone on deck with the boat, and pin the crew at stations.
    const pose = getEarthPose();
    const selfId = getCrewSelfId();
    for (const a of aboard) {
      const b = physics.getBody(a.id);
      if (!b) continue;
      let x = a.x;
      let z = a.z;
      const pinned = role && a.id === selfId;
      if (pinned) [x, z] = role === 'helm' ? HELM_SPOT : OARS_SPOT;
      if (!pinned && before.center === after.center && before.heading === after.heading) continue;
      const rx = b.pos[0] - pose.center[0];
      const ry = b.pos[1] - pose.center[1];
      const rz = b.pos[2] - pose.center[2];
      let r = Math.hypot(rx, ry, rz);
      if (pinned) r = BODY_SHELL_RADIUS + vessel.deckTopAt(t) + FOOT_CUSHION;
      const n = fromBoatFrame(after, x, z, EARTH_RADIUS);
      const local: Vec3 = [n[0] * r, n[1] * r, n[2] * r];
      const w = earthLocalToWorld(local, pose);
      b.pos[0] = w[0]; b.pos[1] = w[1]; b.pos[2] = w[2];
      if (pinned) { b.vel[0] = 0; b.vel[1] = 0; b.vel[2] = 0; }
      if (b.local) { b.local[0] = local[0]; b.local[1] = local[1]; b.local[2] = local[2]; }
    }
    // A crew member who left the deck (jumped, fell) gives up the station.
    if (role && selfId && !aboard.some((a) => a.id === selfId)) leaveRole();
  });
  return () => {
    unsub();
    off();
  };
}

export type BoatAction =
  | { kind: 'board' }
  | { kind: 'climb'; from: 'ladder' | 'port' | 'starboard' }
  | { kind: 'full' }
  | { kind: 'take'; role: CrewRole }
  | { kind: 'leave'; role: CrewRole };

/** What the hold button should offer a body at `pos`, or null for nothing. */
export function boatActionFor(pos: [number, number, number]): BoatAction | null {
  const frame = villageBoatFrame();
  if (!frame) return null;
  const vessel = getVillageBoat();
  const t = getEarthPoseTime();
  const p = placeOf(frame, vessel, pos, t);
  if (!p) return null;
  const role = getCrewRole();
  if (role) return { kind: 'leave', role };
  if (isOnDeck(p)) {
    if (Math.hypot(p.x - HELM_SPOT[0], p.z - HELM_SPOT[1]) <= STATION_REACH_M) return { kind: 'take', role: 'helm' };
    if (Math.hypot(p.x - OARS_SPOT[0], p.z - OARS_SPOT[1]) <= STATION_REACH_M) return { kind: 'take', role: 'oars' };
    return null;
  }
  const gateX = railHalfWidthAt(0);
  const dPort = Math.hypot(p.x + gateX, p.z);
  const dStar = Math.hypot(p.x - gateX, p.z);
  const dLadder = Math.hypot(p.x, p.z - HALF_L);
  const swimming = p.feet < -0.6;
  let action: BoatAction | null = null;
  if (swimming) {
    const best = Math.min(dLadder, dPort, dStar);
    if (best <= CLIMB_REACH_M) {
      action = { kind: 'climb', from: best === dLadder ? 'ladder' : best === dPort ? 'port' : 'starboard' };
    }
  } else if (p.feet > -0.1 && Math.min(dPort, dStar) <= BOARD_REACH_M && Math.abs(p.aboveDeck) < 1.2) {
    action = { kind: 'board' };
  }
  if (action && !vessel.canBoard()) return { kind: 'full' };
  return action;
}

/** World position for standing at boat-frame (x, z) on the deck now. */
export function deckWorldPos(x: number, z: number): [number, number, number] | null {
  const frame = villageBoatFrame();
  if (!frame) return null;
  const top = getVillageBoat().deckTopAt(getEarthPoseTime());
  const n: Vec3 = fromBoatFrame(frame, x, z, EARTH_RADIUS);
  const r = BODY_SHELL_RADIUS + top + FOOT_CUSHION + 0.02;
  return earthLocalToWorld([n[0] * r, n[1] * r, n[2] * r], getEarthPose());
}

/** Where a completed hold puts you on deck. */
export function boardingSpot(action: BoatAction): [number, number] | null {
  if (action.kind === 'board') return [0, 0.2];
  if (action.kind === 'climb') {
    if (action.from === 'ladder') return [0, HALF_L - 0.7];
    return [action.from === 'port' ? -0.45 : 0.45, 0];
  }
  return null;
}
