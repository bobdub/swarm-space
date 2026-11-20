import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { _resetDecksForTest } from '../deckSupport';
import { toBoatFrame } from '../boatDeck';
import { _resetVillageBoatForTest } from '../vessel';
import { frameOf, getFleet } from '../fleet';
import { _resetCrewForTest, getCrewRole, takeRole } from '../crew';
import {
  BITE_WAIT_DEEP_S,
  BITE_WAIT_SHALLOW_S,
  BITE_WINDOW_S,
  ROD_SPOTS,
  _resetFishingForTest,
  cast,
  getFishing,
  meanBiteWait,
  reel,
  setFishingRandom,
  setFishingReward,
  updateFishing,
} from '../fishing';
import { boatActionFor, deckWorldPos, mountVillageBoat } from '../villageBoat';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;
type P = UqrcPhysics & { tick(): void };

beforeEach(() => {
  setEarthPoseTime(T0); endEarthFrame(); beginEarthFrame();
  _resetVillageBoatForTest();
  _resetCrewForTest();
  _resetFishingForTest();
});
afterEach(() => {
  _resetDecksForTest();
  _resetCrewForTest();
  _resetFishingForTest();
  setEarthPoseTime(null);
});

/** Run the line from `t0` until something happens or `limit` s pass. */
function waitFor(t0: number, speed: number, limit: number): number {
  for (let t = t0; t < t0 + limit; t += 0.1) {
    updateFishing(t, speed);
    if (getFishing().phase !== 'waiting') return t;
  }
  return Infinity;
}

describe('a line over the rail', () => {
  it('bites sooner in deep water than in the shallows', () => {
    expect(meanBiteWait(1)).toBe(BITE_WAIT_SHALLOW_S);
    expect(meanBiteWait(40)).toBe(BITE_WAIT_DEEP_S);
    expect(meanBiteWait(9)).toBeGreaterThan(BITE_WAIT_DEEP_S);
    expect(meanBiteWait(9)).toBeLessThan(BITE_WAIT_SHALLOW_S);
  });

  it('lands a fish reeled while it is on, for one Food', () => {
    let food = 0;
    setFishingReward(() => { food++; });
    setFishingRandom(() => 0.5);
    cast(0, 20);
    const bite = waitFor(0, 0.2, 60);
    expect(getFishing().phase).toBe('bite');
    // ln 2 × 12 s + 1.5 s ≈ 9.8 s
    expect(bite).toBeGreaterThan(9);
    expect(bite).toBeLessThan(11);
    expect(reel(bite + 1)).toBe(true);
    expect(food).toBe(1);
    expect(getFishing().phase).toBe('caught');
    updateFishing(bite + 5, 0);
    expect(getFishing().phase).toBe('idle');
  });

  it('loses a fish not reeled in time, and gives nothing for an early pull', () => {
    let food = 0;
    setFishingReward(() => { food++; });
    setFishingRandom(() => 0.5);
    cast(0, 20);
    expect(reel(2)).toBe(false); // nothing on yet: just winds in
    expect(getFishing().phase).toBe('idle');
    cast(3, 20);
    const bite = waitFor(3, 0, 60);
    updateFishing(bite + BITE_WINDOW_S + 0.1, 0);
    expect(getFishing().phase).toBe('missed');
    expect(reel(bite + BITE_WINDOW_S + 0.2)).toBe(false);
    expect(food).toBe(0);
  });

  it('gets no bite while the boat runs too fast', () => {
    setFishingRandom(() => 0.1);
    cast(0, 20);
    expect(waitFor(0, 3, 60)).toBe(Infinity);
    expect(getFishing().tooFast).toBe(true);
    // Slow down and it bites.
    expect(waitFor(60, 0.5, 30)).toBeLessThan(65);
  });
});

describe('rods on the boat', () => {
  it('a rod holder offers a rod, fishing does not claim the dock boat, and the angler stays put', () => {
    const physics = new UqrcPhysics() as P;
    const unmount = mountVillageBoat(physics);
    const fleet = getFleet();
    const dock = fleet.dock()!;
    const [x, z] = ROD_SPOTS[1];
    physics.addBody({ id: 'self', kind: 'self', pos: deckWorldPos(x - 0.2, z + 0.3)!, vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
    let t = T0;
    const step = (n: number) => { for (let i = 0; i < n; i++) { t += 1 / PHYSICS_HZ; setEarthPoseTime(t); endEarthFrame(); beginEarthFrame(); physics.tick(); } };
    step(20);
    const a = boatActionFor(physics.getBody('self')!.pos);
    expect(a).toMatchObject({ kind: 'take', role: 'rod', spot: [x, z] });
    if (a?.kind !== 'take') throw new Error('no rod');
    takeRole(a.role, 'self', a.boatKey, a.spot);
    step(60);
    expect(getCrewRole()).toBe('rod');
    expect(dock.kind).toBe('dock');
    expect(fleet.mine()).toBeUndefined();
    const pose = getEarthPose();
    const b = physics.getBody('self')!;
    const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
    const at = toBoatFrame(frameOf(dock), worldPosToLocalNormal(b.pos, pose), EARTH_RADIUS);
    expect(Math.hypot(at.x - x, at.z - z)).toBeLessThan(0.05);
    expect(Math.abs(r - BODY_SHELL_RADIUS - FOOT_CUSHION - dock.vessel.deckTopAt(t))).toBeLessThan(0.05);
    expect(boatActionFor(b.pos)).toEqual({ kind: 'leave', role: 'rod' });
    unmount();
  });
});
