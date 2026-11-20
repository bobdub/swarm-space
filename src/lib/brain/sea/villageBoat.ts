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

export const VILLAGE_BOAT_DECK_ID = 'village-boat-deck';

/** How close to the boat's gate you must stand on the jetty to board (m). */
export const BOARD_REACH_M = 4.5;
/** How close a swimmer must be to the ladder or a gate to climb aboard (m). */
export const CLIMB_REACH_M = 2.2;

export function villageBoatFrame(): BoatFrame | null {
  const site = getVillageDockSite();
  if (!site) return null;
  return { center: site.boatCenter, heading: site.boatHeading };
}

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

/**
 * Register the deck and float the boat on the physics clock. Returns the
 * cleanup.
 */
export function mountVillageBoat(physics: UqrcPhysics): () => void {
  const frame = villageBoatFrame();
  if (!frame) return () => {};
  const vessel = getVillageBoat();
  const off = registerDeckSurface(
    boatDeck({
      id: VILLAGE_BOAT_DECK_ID,
      frame,
      radius: EARTH_RADIUS,
      top: () => vessel.deckTopAt(getEarthPoseTime()),
    }),
  );
  const unsub = physics.subscribe(() => {
    vessel.setPeople(countAboard(physics, frame, vessel, getEarthPoseTime()));
    vessel.step(1 / PHYSICS_HZ);
  });
  return () => {
    unsub();
    off();
  };
}

export type BoatAction =
  | { kind: 'board' }
  | { kind: 'climb'; from: 'ladder' | 'port' | 'starboard' }
  | { kind: 'full' };

/** What the hold button should offer a body at `pos`, or null for nothing. */
export function boatActionFor(pos: [number, number, number]): BoatAction | null {
  const frame = villageBoatFrame();
  if (!frame) return null;
  const vessel = getVillageBoat();
  const t = getEarthPoseTime();
  const p = placeOf(frame, vessel, pos, t);
  if (!p || isOnDeck(p)) return null;
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
