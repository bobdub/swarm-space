import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  earthLocalToWorld,
  endEarthFrame,
  getEarthPose,
  quatRotate,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { isSwimmingAt, SWIM_FEET_DEPTH } from '../../groundHeight';
import { _resetDecksForTest, registerDeckSurface, straightDeck } from '../deckSupport';
import { JETTY_TOP, JETTY_WIDTH, getVillageDockSite } from '../dockSite';
import { fromBoatFrame, toBoatFrame, confineInBoatFrame } from '../boatDeck';
import { HALF_L, hullHalfBeam, railHalfWidthAt, tAt } from '../boatHull';
import { BOAT_RAIL_H } from '../boatSpec';
import { _resetVillageBoatForTest, getVillageBoat } from '../vessel';
import { BOARD_REACH_M, HOLD_SLACK_M, boardingSpot, boatActionFor, deckWorldPos, mountVillageBoat, villageBoatFrame } from '../villageBoat';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;
type P = UqrcPhysics & { tick(): void };

let t = T0;
let physics: P;
let unmount: () => void;

function world(localN: Vec3, feet: number): [number, number, number] {
  const r = BODY_SHELL_RADIUS + feet + FOOT_CUSHION;
  return earthLocalToWorld([localN[0] * r, localN[1] * r, localN[2] * r], getEarthPose());
}

function addWalker(id: string, pos: [number, number, number]) {
  physics.addBody({
    id, kind: id === 'self' ? 'self' : 'avatar', pos: [...pos] as [number, number, number],
    vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' },
  });
}

function step(n: number, each?: (i: number) => void) {
  for (let i = 0; i < n; i++) {
    t += 1 / PHYSICS_HZ;
    setEarthPoseTime(t);
    endEarthFrame(); beginEarthFrame();
    each?.(i);
    physics.tick();
  }
}

function place(id: string) {
  const pose = getEarthPose();
  const b = physics.getBody(id)!;
  const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
  const n = worldPosToLocalNormal(b.pos, pose);
  const { x, z } = toBoatFrame(villageBoatFrame()!, n, EARTH_RADIUS);
  return { x, z, n, feet: r - BODY_SHELL_RADIUS - FOOT_CUSHION };
}

/** Push intent along a boat-frame direction (dx starboard, dz aft). */
function push(id: string, dx: number, dz: number) {
  const frame = villageBoatFrame()!;
  const b = physics.getBody(id)!;
  const pose = getEarthPose();
  const n = worldPosToLocalNormal(b.pos, pose);
  const { x, z } = toBoatFrame(frame, n, EARTH_RADIUS);
  const a = fromBoatFrame(frame, x, z, EARTH_RADIUS);
  const c = fromBoatFrame(frame, x + dx, z + dz, EARTH_RADIUS);
  const dir: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const l = Math.hypot(...dir);
  const fwd = quatRotate(pose.spinQuat, [dir[0] / l, dir[1] / l, dir[2] / l]);
  const up = quatRotate(pose.spinQuat, n);
  const right: Vec3 = [
    fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0],
  ];
  physics.setIntent(id, { fwd: 1, right: 0, yaw: 0, basis: { up, forward: fwd, right } });
}

beforeEach(() => {
  t = T0;
  setEarthPoseTime(t);
  endEarthFrame(); beginEarthFrame();
  _resetVillageBoatForTest();
  physics = new UqrcPhysics() as P;
  unmount = mountVillageBoat(physics);
});

afterEach(() => {
  unmount();
  _resetDecksForTest();
  setEarthPoseTime(null);
});

describe('walls in the boat frame', () => {
  it('keeps a walker inside the rail, but lets them through a gate', () => {
    const z = 1.5;
    const out = confineInBoatFrame(railHalfWidthAt(z) - 0.1, z, 0, 0.35)!;
    expect(out.x).toBeCloseTo(railHalfWidthAt(z) - 0.35, 6);
    expect(confineInBoatFrame(railHalfWidthAt(0) - 0.1, 0, 0, 0.35)).toBeNull();
  });
  it('keeps a jetty walker out except at the gate', () => {
    const z = -1.5;
    const x = -(railHalfWidthAt(z) + 0.2);
    expect(confineInBoatFrame(x, z, 0.1, 0.35)!.x).toBeCloseTo(-(railHalfWidthAt(z) + 0.35), 6);
    expect(confineInBoatFrame(-(railHalfWidthAt(0) + 0.2), 0, 0.1, 0.35)).toBeNull();
  });
  it('shuts the gates to newcomers once the boat is full, but lets people off', () => {
    const outside = confineInBoatFrame(-(railHalfWidthAt(0) + 0.2), 0, 0.1, 0.35, true)!;
    expect(outside.x).toBeCloseTo(-(railHalfWidthAt(0) + 0.35), 6);
    // Aboard, standing in the open gate: free to step off.
    expect(confineInBoatFrame(-(railHalfWidthAt(0) - 0.1), 0, 0, 0.35, true)).toBeNull();
  });
  it('makes the hull solid to a swimmer and lets a jumper clear the rail', () => {
    const z = 1;
    const pushed = confineInBoatFrame(0.5, z, -1.85, 0.35)!;
    expect(pushed.x).toBeCloseTo(hullHalfBeam(tAt(z)) + 0.35, 6);
    expect(confineInBoatFrame(railHalfWidthAt(z) - 0.1, z, BOAT_RAIL_H + 0.05, 0.35)).toBeNull();
  });
});

describe('aboard the village boat', () => {
  it('offers boarding only within three metres of either gate', () => {
    const frame = villageBoatFrame();
    if (!frame) throw new Error('Missing dock boat');
    expect(BOARD_REACH_M).toBe(3.0);
    const gateX = railHalfWidthAt(0);
    for (const side of [-1, 1]) {
      const near = world(fromBoatFrame(frame, side * (gateX + 2.99), 0, EARTH_RADIUS), JETTY_TOP);
      const far = world(fromBoatFrame(frame, side * (gateX + 3.01), 0, EARTH_RADIUS), JETTY_TOP);
      expect(boatActionFor(near)).toMatchObject({ kind: 'board' });
      expect(boatActionFor(far)).toBeNull();
      expect(boatActionFor(far, HOLD_SLACK_M)).toMatchObject({ kind: 'board' });
    }
  });

  it('offers boarding to someone pressed against the hull from the jetty', () => {
    const frame = villageBoatFrame();
    if (!frame) throw new Error('Missing dock boat');
    for (const side of [-1, 1]) {
      const p = world(fromBoatFrame(frame, side * (railHalfWidthAt(0) + 0.35), 0, EARTH_RADIUS), JETTY_TOP);
      expect(boatActionFor(p)).toMatchObject({ kind: 'board' });
    }
  });

  it('never offers boarding to someone at the deck rail or inside the hull', () => {
    const frame = villageBoatFrame();
    if (!frame) throw new Error('Missing dock boat');
    const deckTop = getVillageBoat().deckTopAt(t);
    for (const side of [-1, 1]) {
      // Just outside isOnDeck's rail boundary, but still within body width.
      const rail = world(fromBoatFrame(frame, side * (railHalfWidthAt(0) + 0.2), 0, EARTH_RADIUS), deckTop);
      expect(boatActionFor(rail)).toBeNull();
      expect(boatActionFor(rail, HOLD_SLACK_M)).toBeNull();
    }
    const deck = deckWorldPos(0, 1.2);
    if (!deck) throw new Error('Missing deck position');
    expect(boatActionFor(deck)).toMatchObject({ kind: 'take', role: 'oars' });
  });

  it('holds an idle walker still on the heaving deck for 600 steps', () => {
    addWalker('self', deckWorldPos(0, 1.2)!);
    step(60);
    const start = place('self');
    let maxSlide = 0;
    let maxGap = 0;
    step(600, () => {
      const p = place('self');
      maxSlide = Math.max(maxSlide, Math.hypot(p.x - start.x, p.z - start.z));
      maxGap = Math.max(maxGap, Math.abs(p.feet - getVillageBoat().deckTopAt(t)));
    });
    expect(maxSlide).toBeLessThan(0.05);
    expect(maxGap).toBeLessThan(0.06);
  });

  it('sinks the hull a little under the people aboard', () => {
    addWalker('self', deckWorldPos(0, 1.2)!);
    addWalker('a', deckWorldPos(0, -0.4)!);
    addWalker('b', deckWorldPos(0, 2.2)!);
    step(300);
    expect(getVillageBoat().people).toBe(3);
    expect(getVillageBoat().heave.sink).toBeGreaterThan(0.015);
  });

  it('keeps offering the oars when a completing hold adds slack', () => {
    addWalker('self', deckWorldPos(0, 1.4)!);
    step(30);
    const pos = physics.getBody('self')!.pos;
    expect(boatActionFor(pos)).toMatchObject({ kind: 'take', role: 'oars' });
    expect(boatActionFor(pos, HOLD_SLACK_M)).toMatchObject({ kind: 'take', role: 'oars' });
  });

  it('stops a walker at the rail', () => {
    addWalker('self', deckWorldPos(0, 1.6)!);
    step(30);
    step(180, () => push('self', 1, 0));
    const p = place('self');
    expect(p.x).toBeLessThanOrEqual(railHalfWidthAt(p.z) - 0.3);
    expect(Math.abs(p.feet - getVillageBoat().deckTopAt(t))).toBeLessThan(0.08);
  });

  it('jumps high enough to clear the rail', () => {
    addWalker('self', deckWorldPos(0, 1.2)!);
    step(30);
    const deck = getVillageBoat().deckTopAt(t);
    expect(physics.jump('self')).toBe(true);
    let apex = -Infinity;
    step(120, () => { apex = Math.max(apex, place('self').feet); });
    expect(apex - deck).toBeGreaterThan(BOAT_RAIL_H + 0.1);
    // ...and lands back on the deck.
    step(120);
    expect(physics.isAirborne('self')).toBe(false);
    expect(Math.abs(place('self').feet - getVillageBoat().deckTopAt(t))).toBeLessThan(0.08);
  });

  it('a jump out of the gate lands in the sea, swimming', () => {
    addWalker('self', deckWorldPos(-(railHalfWidthAt(0) - 0.5), 0)!);
    step(30);
    // Run for the port gate (the jetty side) and jump on the way.
    push('self', -1, 0);
    step(6);
    expect(physics.jump('self')).toBe(true);
    step(240, () => push('self', -1, 0));
    physics.setIntent('self', { fwd: 0, right: 0, yaw: 0 });
    step(240);
    const p = place('self');
    expect(Math.abs(p.x)).toBeGreaterThan(railHalfWidthAt(0));
    expect(isSwimmingAt(p.n, p.feet)).toBe(true);
    expect(p.feet).toBeLessThan(-SWIM_FEET_DEPTH + 0.15);
  });

  it('keeps a swimmer out of the hull and offers the ladder', () => {
    const frame = villageBoatFrame()!;
    addWalker('self', world(fromBoatFrame(frame, 2.6, 1.0, EARTH_RADIUS), -SWIM_FEET_DEPTH));
    step(30);
    // Swim straight at the side for a second: the hull holds them off.
    let closest = Infinity;
    step(60, () => {
      push('self', -1, 0);
      const q = place('self');
      closest = Math.min(closest, q.x - hullHalfBeam(tAt(Math.min(HALF_L, q.z))));
    });
    const p = place('self');
    expect(closest).toBeGreaterThanOrEqual(0.3);
    expect(isSwimmingAt(p.n, p.feet)).toBe(true);
    // Swim round to the stern.
    const b = physics.getBody('self')!;
    const at = world(fromBoatFrame(frame, 0, HALF_L + 1.2, EARTH_RADIUS), -SWIM_FEET_DEPTH);
    b.pos = at; b.vel = [0, 0, 0];
    physics.setIntent('self', { fwd: 0, right: 0, yaw: 0 });
    step(30);
    expect(boatActionFor(physics.getBody('self')!.pos)).toMatchObject({ kind: 'climb', from: 'ladder' });
  });

  it('offers a climb anywhere beside the hull, with slack when a hold completes', () => {
    const frame = villageBoatFrame()!;
    // Beside the starboard bow quarter, far from the gate and the ladder.
    const z = -2.4;
    const x = hullHalfBeam(tAt(z)) + 1.1;
    addWalker('self', world(fromBoatFrame(frame, x, z, EARTH_RADIUS), -SWIM_FEET_DEPTH));
    step(30);
    const pos = physics.getBody('self')!.pos;
    expect(boatActionFor(pos)).toMatchObject({ kind: 'climb', from: 'starboard' });
    // A little further out: nothing offered, but a completing hold still reaches.
    const b = physics.getBody('self')!;
    b.pos = world(fromBoatFrame(frame, hullHalfBeam(tAt(z)) + 2.0, z, EARTH_RADIUS), -SWIM_FEET_DEPTH);
    b.vel = [0, 0, 0];
    step(5);
    expect(boatActionFor(b.pos)).toBeNull();
    const late = boatActionFor(b.pos, HOLD_SLACK_M);
    expect(late).toMatchObject({ kind: 'climb', from: 'starboard' });
    // The climb lands them on deck at the starboard gate.
    const spot = boardingSpot(late!)!;
    b.pos = deckWorldPos(spot[0], spot[1])!;
    b.vel = [0, 0, 0];
    step(60);
    const q = place('self');
    expect(Math.hypot(q.x - 0.45, q.z)).toBeLessThan(0.1);
    expect(q.feet).toBeGreaterThan(0.2);
  });

  it('offers boarding on the jetty, and walks through the gate onto the deck', () => {
    const site = getVillageDockSite()!;
    registerDeckSurface(straightDeck({
      id: 'jetty', start: site.jettyStart, dir: site.jettyDir,
      length: site.jettyLength, width: JETTY_WIDTH, top: JETTY_TOP, radius: EARTH_RADIUS,
    }));
    const frame = villageBoatFrame()!;
    // On the jetty, level with the port gate.
    const gateX = railHalfWidthAt(0);
    addWalker('self', world(fromBoatFrame(frame, -(gateX + 1.1), 0, EARTH_RADIUS), JETTY_TOP));
    step(30);
    expect(place('self').feet).toBeGreaterThan(JETTY_TOP - 0.05);
    expect(boatActionFor(physics.getBody('self')!.pos)).toMatchObject({ kind: 'board' });
    // Walk across until midships, then stop.
    let walking = true;
    step(120, () => {
      if (walking && place('self').x > -0.2) {
        walking = false;
        physics.setIntent('self', { fwd: 0, right: 0, yaw: 0 });
      }
      if (walking) push('self', 1, 0);
    });
    const p = place('self');
    expect(Math.abs(p.x)).toBeLessThan(railHalfWidthAt(p.z));
    expect(Math.abs(p.feet - getVillageBoat().deckTopAt(t))).toBeLessThan(0.08);
    // Aboard, the ring offers a station instead of boarding.
    expect(boatActionFor(physics.getBody('self')!.pos)?.kind).toBe('take');
  });

  it('keeps a jetty walker from stepping over the rail away from the gate', () => {
    const site = getVillageDockSite()!;
    registerDeckSurface(straightDeck({
      id: 'jetty', start: site.jettyStart, dir: site.jettyDir,
      length: site.jettyLength, width: JETTY_WIDTH, top: JETTY_TOP, radius: EARTH_RADIUS,
    }));
    const frame = villageBoatFrame()!;
    const z = -1.6;
    addWalker('self', world(fromBoatFrame(frame, -(railHalfWidthAt(z) + 1.1), z, EARTH_RADIUS), JETTY_TOP));
    step(30);
    let deepest = -Infinity;
    step(60, () => { push('self', 1, 0); deepest = Math.max(deepest, place('self').x + railHalfWidthAt(place('self').z)); });
    expect(deepest).toBeLessThan(0.05);
  });
});
