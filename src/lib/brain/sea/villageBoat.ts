/**
 * villageBoat — the boats as places you can be, for this player.
 *
 * Mounting runs the fleet (`fleet.ts`) on the physics clock: decks and
 * walls for every boat, floating, sailing, dead reckoning, carrying people
 * along and holding the crew at their stations.
 *
 * It also answers "what can I do from here?" for the hold ring: board
 * from the jetty, climb aboard from the water by the ladder or a gate,
 * take the wheel or the oars, let go of them, or nothing. Boarding is
 * refused once one more person would push the freeboard under 0.2 m.
 */

import { getEarthPoseTime, type Vec3 } from '../earth';
import { PHYSICS_HZ, type UqrcPhysics } from '../uqrcPhysics';
import { HALF_L, railHalfWidthAt } from './boatHull';
import type { BoatFrame } from './boatDeck';
import { getCrewRole, type CrewRole } from './crew';
import {
  HELM_SPOT,
  OARS_SPOT,
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

export { HELM_SPOT, OARS_SPOT, ROD_SPOTS, isOnDeck };

/** How close to the boat's gate you must stand on the jetty to board (m). */
export const BOARD_REACH_M = 4.5;
/** How close a swimmer must be to the ladder or a gate to climb aboard (m). */
export const CLIMB_REACH_M = 2.2;
const STATION_REACH_M = 1.3;
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

function actionOn(boat: FleetBoat, pos: [number, number, number], t: number): BoatAction | null {
  const p = placeOn(boat, pos, t);
  if (!p) return null;
  const fleet = getFleet();
  if (isOnDeck(p)) {
    const ownable = boat.kind === 'dock' || boat.kind === 'mine';
    if (ownable && Math.hypot(p.x - HELM_SPOT[0], p.z - HELM_SPOT[1]) <= STATION_REACH_M) {
      if (boat.kind === 'dock' && fleet.claimBlocked()) return { kind: 'busy' };
      return { kind: 'take', boatKey: boat.key, role: 'helm' };
    }
    if (Math.hypot(p.x - OARS_SPOT[0], p.z - OARS_SPOT[1]) <= STATION_REACH_M) {
      if (boat.kind === 'dock' && fleet.claimBlocked()) return { kind: 'busy' };
      return { kind: 'take', boatKey: boat.key, role: 'oars' };
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
    if (best <= CLIMB_REACH_M) {
      action = { kind: 'climb', boatKey: boat.key, from: best === dLadder ? 'ladder' : best === dPort ? 'port' : 'starboard' };
    }
  } else if (p.feet > -0.1 && Math.min(dPort, dStar) <= BOARD_REACH_M && Math.abs(p.aboveDeck) < 1.2) {
    action = { kind: 'board', boatKey: boat.key };
  }
  if (action && !boat.vessel.canBoard()) return { kind: 'full', boatKey: boat.key };
  return action;
}

/** What the hold ring should offer a body at `pos`, or null for nothing. */
export function boatActionFor(pos: [number, number, number]): BoatAction | null {
  const role = getCrewRole();
  if (role) return { kind: 'leave', role };
  const t = getEarthPoseTime();
  let best: BoatAction | null = null;
  for (const b of getFleet().list()) {
    if (!b.visible) continue;
    const a = actionOn(b, pos, t);
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
  if (action.kind === 'board') return [0, 0.2];
  if (action.kind === 'climb') {
    if (action.from === 'ladder') return [0, HALF_L - 0.7];
    return [action.from === 'port' ? -0.45 : 0.45, 0];
  }
  return null;
}

/** Water depth (m) under this player's boat, for a cast. */
export function fishingDepth(): number {
  const b = getFleet().focus();
  if (!b) return 0;
  return Math.max(0, -groundElevationAt(b.vessel.motion.n));
}
