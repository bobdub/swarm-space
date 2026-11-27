/**
 * villageBoat — the boats as places you can be, for this player.
 *
 * Mounting runs the fleet (`fleet.ts`) on the physics clock: decks and
 * walls for every boat, floating, sailing, dead reckoning, carrying people
 * along and holding the crew at their stations.
 *
 * It also answers "what can I do from here?" for the hold ring: board
 * from the jetty (anywhere along it beside a docked boat, or by a gate
 * elsewhere), climb aboard from the water by the ladder or a gate,
 * take the wheel or the oars, let go of them, or nothing. Boarding is
 * refused once one more person would push the freeboard under 0.2 m.
 */

import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  getEarthPose,
  getEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../earth';
import { PHYSICS_HZ, type UqrcPhysics } from '../uqrcPhysics';
import { HALF_L, hullHalfBeam, railHalfWidthAt, tAt } from './boatHull';
import { toBoatFrame, type BoatFrame } from './boatDeck';
import { BERTH_OFFSET, JETTY_TOP, JETTY_WIDTH, getVillageDockSite } from './dockSite';
import { getCrewBoatKey, getCrewRole, type CrewRole } from './crew';
import { HELM_SPOT, OARS_SPOT, OAR_SPOTS, nearestOarSpot } from './boatLayout';
import {
  deckPointOn,
  frameOf,
  getFleet,
  isOnDeck,
  placeOn,
  type FleetBoat,
} from './fleet';
import { setFocusBoatResolver } from './vessel';
import { ROD_SPOTS } from './fishing';
import { groundElevationAt } from '../groundHeight';
import { schoolNear } from './seaLife';
import { hookableShark, sharkStillHookable } from './sharks';

export { HELM_SPOT, OARS_SPOT, OAR_SPOTS, ROD_SPOTS, isOnDeck };

/** How close to the boat's gate you must stand on the jetty to board (m). */
export const BOARD_REACH_M = 3.0;
/** How close a swimmer must be to the ladder or a gate to climb aboard (m). */
export const CLIMB_REACH_M = 2.2;
/** A swimmer this close to either side of the hull (m) can climb aboard
 *  anywhere along it; the climb lands them at that side's gate. */
export const CLIMB_SIDE_REACH_M = 1.4;
/** Extra reach (m) allowed when a hold completes, so a swimmer drifting
 *  a little while holding still gets aboard. */
export const HOLD_SLACK_M = 1.0;
/** A boat whose centre lies this close to the village berth (m), heading
 *  along the jetty, is docked: the jetty beside her offers Board. */
export const DOCKED_M = 2.0;
/** Along the jetty, Board shows from this far (m) before a docked boat's
 *  stern (or past her bow), so it is up as you walk toward her. */
export const JETTY_BOARD_MARGIN_M = 2.0;
const STATION_REACH_M = 1.0;
/** Rod holders sit by the rail, closer together than the stations. */
const ROD_REACH_M = 0.9;

// "The boat" for this player: crewed, else owned, else the dock boat.
setFocusBoatResolver(() => getFleet().focus()?.vessel ?? null);

/** Where this player's boat is right now (see `Fleet.focus`). */
export function villageBoatFrame(): BoatFrame | null {
  const b = getFleet().focus();
  return b ? frameOf(b) : null;
}

export interface MountOptions {
  /** Wind at an Earth-local normal (tangent vector, m/s). Defaults to calm;
   *  the scene passes the weather field's `windAt`. */
  wind?: (n: Vec3) => Vec3;
  /** Extra roughness from rain and wet sea at a normal (0…~0.85); the
   *  scene passes `weatherCurvatureBoost`. Defaults to none. */
  sea?: (n: Vec3) => number;
}

/** Run the fleet on the physics clock. Returns the cleanup. */
export function mountVillageBoat(physics: UqrcPhysics, opts: MountOptions = {}): () => void {
  const fleet = getFleet();
  if (!fleet.dock()) return () => {};
  fleet.attachAllDecks();
  const wind = opts.wind ?? (() => [0, 0, 0] as Vec3);
  const sea = opts.sea ?? (() => 0);
  const unsub = physics.subscribe(() => fleet.tick(physics, 1 / PHYSICS_HZ, wind, sea));
  return () => {
    unsub();
    fleet.detachAllDecks();
  };
}

export type BoatAction =
  | { kind: 'board'; boatKey: string }
  | { kind: 'climb'; boatKey: string; from: 'ladder' | 'port' | 'starboard' }
  | { kind: 'full'; boatKey: string }
  | { kind: 'take'; boatKey: string; role: CrewRole; spot?: [number, number] }
  | { kind: 'leave'; role: CrewRole }
  | { kind: 'busy' };

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where a body stands relative to the jetty, in the berth's frame (the
 * frame of a boat lying exactly at the berth): `z` along the berth (bow −),
 * or null when it is not standing on the jetty planks beside the berth.
 */
function jettySpot(pos: [number, number, number]): { z: number } | null {
  const site = getVillageDockSite();
  if (!site) return null;
  const pose = getEarthPose();
  const n = worldPosToLocalNormal(pos, pose) as Vec3;
  if (dot3(n, site.boatCenter) < Math.cos((HALF_L + 12) / EARTH_RADIUS)) return null;
  const r = Math.hypot(pos[0] - pose.center[0], pos[1] - pose.center[1], pos[2] - pose.center[2]);
  const feet = r - BODY_SHELL_RADIUS - FOOT_CUSHION;
  // On the planks (or hopping on them), not swimming under them.
  if (feet < JETTY_TOP - 0.4 || feet > JETTY_TOP + 1.2) return null;
  const berth: BoatFrame = { center: site.boatCenter, heading: site.boatHeading };
  const { x, z } = toBoatFrame(berth, n, EARTH_RADIUS);
  // The jetty runs along one side of the berth, BERTH_OFFSET out.
  const jettyX = toBoatFrame(berth, site.jettyStart, EARTH_RADIUS).x < 0 ? -BERTH_OFFSET : BERTH_OFFSET;
  if (Math.abs(x - jettyX) > JETTY_WIDTH / 2 + 0.2) return null;
  return { z };
}

/** True when `boat` lies at the village berth, alongside the jetty. */
function dockedAtJetty(boat: FleetBoat): boolean {
  const site = getVillageDockSite();
  if (!site) return false;
  const { n, heading } = boat.vessel.motion;
  const off = Math.acos(Math.min(1, dot3(n, site.boatCenter))) * EARTH_RADIUS;
  if (off > DOCKED_M) return false;
  // Lying along the jetty, bow either way.
  return Math.abs(dot3(heading, site.boatHeading)) > Math.cos(Math.PI / 9);
}

function actionOn(
  boat: FleetBoat,
  pos: [number, number, number],
  t: number,
  slack = 0,
  jetty: { z: number } | null = null,
): BoatAction | null {
  const p = placeOn(boat, pos, t);
  if (!p) return null;
  const fleet = getFleet();
  if (isOnDeck(p)) {
    const ownable = boat.kind === 'dock' || boat.kind === 'mine';
    // The nearest station in reach wins, so slack that widens both reaches
    // never swaps the oars a body is standing at for the wheel.
    const reach = STATION_REACH_M + slack * 0.5;
    const dHelm = ownable ? Math.hypot(p.x - HELM_SPOT[0], p.z - HELM_SPOT[1]) : Infinity;
    // Any of the oar places: each bench seats a rower either side.
    const oars = nearestOarSpot(p.x, p.z);
    const dOars = oars.d;
    if (Math.min(dHelm, dOars) <= reach) {
      if (boat.kind === 'dock' && fleet.claimBlocked()) return { kind: 'busy' };
      if (dHelm <= dOars) return { kind: 'take', boatKey: boat.key, role: 'helm' };
      return { kind: 'take', boatKey: boat.key, role: 'oars', spot: oars.spot };
    }
    // A rod holder: anyone may fish from any boat.
    for (const spot of ROD_SPOTS) {
      if (Math.hypot(p.x - spot[0], p.z - spot[1]) <= ROD_REACH_M) {
        return { kind: 'take', boatKey: boat.key, role: 'rod', spot: [spot[0], spot[1]] };
      }
    }
    return null;
  }
  const gateX = railHalfWidthAt(0);
  const dPort = Math.hypot(p.x + gateX, p.z);
  const dStar = Math.hypot(p.x - gateX, p.z);
  const dLadder = Math.hypot(p.x, p.z - HALF_L);
  let action: BoatAction | null = null;
  if (p.feet < -0.6) {
    const best = Math.min(dLadder, dPort, dStar);
    // Beside the hull anywhere along its length: climb at that side's gate.
    const along = Math.abs(p.z) <= HALF_L - 0.3;
    const sideGap = along ? Math.abs(p.x) - hullHalfBeam(tAt(p.z)) : Infinity;
    if (best <= CLIMB_REACH_M + slack) {
      action = { kind: 'climb', boatKey: boat.key, from: best === dLadder ? 'ladder' : best === dPort ? 'port' : 'starboard' };
    } else if (sideGap <= CLIMB_SIDE_REACH_M + slack) {
      action = { kind: 'climb', boatKey: boat.key, from: p.x < 0 ? 'port' : 'starboard' };
    }
  } else if (p.feet > -0.1 && Math.min(dPort, dStar) <= BOARD_REACH_M + slack && Math.abs(p.aboveDeck) < 1.2) {
    // Deck heave and the rail's body-width margin must not turn an
    // already-aboard traveller into a new boarding offer.
    const withinHull = Math.abs(p.z) <= HALF_L
      && Math.abs(p.x) <= railHalfWidthAt(p.z) + 0.3;
    if (withinHull) return null;
    action = { kind: 'board', boatKey: boat.key };
  }
  // On the jetty beside a docked boat: Board from anywhere along her,
  // not only by the gate. The jetty never overlaps the deck, so this can't
  // cover the wheel, oars, sail or rod prompts aboard.
  if (!action && jetty && Math.abs(jetty.z) <= HALF_L + JETTY_BOARD_MARGIN_M + slack && dockedAtJetty(boat)) {
    action = { kind: 'board', boatKey: boat.key };
  }
  if (action && !boat.vessel.canBoard()) return { kind: 'full', boatKey: boat.key };
  return action;
}

/**
 * What the hold ring should offer a body at `pos`, or null for nothing.
 * `slack` (m) widens the approach reaches; a completed hold re-checks with
 * `HOLD_SLACK_M` so drifting a little while holding doesn't lose the climb.
 */
export function boatActionFor(pos: [number, number, number], slack = 0): BoatAction | null {
  const role = getCrewRole();
  if (role) return { kind: 'leave', role };
  const t = getEarthPoseTime();
  const jetty = jettySpot(pos);
  let best: BoatAction | null = null;
  for (const b of getFleet().list()) {
    if (!b.visible) continue;
    const a = actionOn(b, pos, t, slack, jetty);
    if (!a) continue;
    // A station or deck action beats an approach action on another boat.
    if (a.kind === 'take' || a.kind === 'busy') return a;
    if (!best) best = a;
  }
  return best;
}

/** World position standing at (x, z) on a boat's deck now (default: this
 *  player's boat). */
export function deckWorldPos(x: number, z: number, boatKey?: string): [number, number, number] | null {
  const fleet = getFleet();
  const b = boatKey ? fleet.get(boatKey) : fleet.focus();
  return b ? deckPointOn(b, x, z) : null;
}

/** Where a completed hold puts you on deck. */
export function boardingSpot(action: BoatAction): [number, number] | null {
  // Onto the open middle of the deck, clear of the gate and the benches,
  // so the next person through the gate isn't blocked.
  if (action.kind === 'board') return [0, -0.2];
  if (action.kind === 'climb') {
    if (action.from === 'ladder') return [0, HALF_L - 0.7];
    return [action.from === 'port' ? -0.7 : 0.7, 0];
  }
  return null;
}

/**
 * The boat this player crews at the wheel or the oars, if it is theirs
 * (only the owner moves a boat; a rower on someone else's boat can back
 * water instead).
 */
function myCrewedBoat(): FleetBoat | null {
  const role = getCrewRole();
  if (role !== 'helm' && role !== 'oars') return null;
  const mine = getFleet().mine();
  return mine && mine.key === getCrewBoatKey() ? mine : null;
}

/** True when the boat this player sails or rows is stuck on the ground. */
export function myBoatAground(): boolean {
  return !!myCrewedBoat()?.vessel.motion.aground;
}

/** Push this player's grounded boat off toward deeper water. */
export function pushOffMyBoat(): 'pushed' | 'stuck' | 'afloat' {
  const b = myCrewedBoat();
  if (!b || !b.vessel.motion.aground) return 'afloat';
  return b.vessel.pushOff() ? 'pushed' : 'stuck';
}

/** True when a school of fish is swimming under this player's boat now. */
export function fishingSchoolNear(): boolean {
  const b = getFleet().focus();
  if (!b) return false;
  return schoolNear(b.vessel.motion.n, getEarthPoseTime());
}

/** A shark close enough to take a bait cast from this player's boat, if any. */
export function fishingShark(): string | null {
  const b = getFleet().focus();
  if (!b) return null;
  return hookableShark(b.vessel.motion.n, fishingDepth(), getEarthPoseTime(), Date.now());
}

/** True when shark `id` could still take this player's bait from where the boat is now. */
export function fishingSharkStillThere(id: string): boolean {
  const b = getFleet().focus();
  if (!b) return false;
  return sharkStillHookable(id, b.vessel.motion.n, fishingDepth(), getEarthPoseTime(), Date.now());
}

/** Water depth (m) under this player's boat, for a cast. */
export function fishingDepth(): number {
  const b = getFleet().focus();
  if (!b) return 0;
  return Math.max(0, -groundElevationAt(b.vessel.motion.n));
}
