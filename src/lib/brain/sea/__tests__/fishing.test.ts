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
  FIGHT_HITS,
  FIGHT_MISSES,
  FIGHT_ROUND_S,
  ROD_SPOTS,
  markerAt,
  markerInZone,
  strike,
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
  it('keeps food fishing relaxed through every round, including a delayed reaction', () => {
    setFishingRandom(() => 0.25);
    let food = 0;
    setFishingReward((amount) => { food += amount; });
    cast(0, 20);
    reel(waitFor(0, 0, 60));
    const widths = [0.4, 0.36, 0.32];
    for (let i = 0; i < 3; i++) {
      const f = getFishing().fight;
      if (!f) throw new Error('Expected a fish fight');
      expect(f.need).toBe(3);
      expect(f.zoneW).toBe(widths[i]);
      expect(f.sweep).toBeCloseTo(4.8 * 0.95 ** i, 8);
      // Even the final zone remains open for at least 690 ms per crossing.
      expect(f.zoneW * f.sweep / 2).toBeGreaterThanOrEqual(0.69);
      const entry = f.roundAt + (f.zoneC - f.zoneW / 2) * f.sweep / 2;
      expect(strike(entry + 0.5)).toBe(i === 2 ? 'landed' : 'hit');
    }
    expect(getFishing().phase).toBe('caught');
    expect(food).toBe(1);
  });

  it('allows twelve seconds to watch each round before counting an idle miss', () => {
    setFishingRandom(() => 0.25);
    cast(0, 20);
    // An integer hook time keeps this exact boundary independent of float rounding.
    const bite = Math.ceil(waitFor(0, 0, 60));
    reel(bite);
    expect(FIGHT_ROUND_S).toBe(12);
    updateFishing(bite + 12, 0);
    expect(getFishing().fight?.misses).toBe(0);
    updateFishing(bite + 12.01, 0);
    expect(getFishing().fight?.misses).toBe(1);
  });

  it('bites sooner in deep water than in the shallows', () => {
    expect(meanBiteWait(1)).toBe(BITE_WAIT_SHALLOW_S);
    expect(meanBiteWait(40)).toBe(BITE_WAIT_DEEP_S);
    expect(meanBiteWait(9)).toBeGreaterThan(BITE_WAIT_DEEP_S);
    expect(meanBiteWait(9)).toBeLessThan(BITE_WAIT_SHALLOW_S);
  });

  it('hooks a fish while it is on, then lands it after a fight, for one Food', () => {
    let food = 0;
    setFishingReward(() => { food++; });
    setFishingRandom(() => 0.5);
    cast(0, 20);
    const bite = waitFor(0, 0.2, 60);
    expect(getFishing().phase).toBe('bite');
    // ln 2 × 12 s + 1.5 s ≈ 9.8 s
    expect(bite).toBeGreaterThan(9);
    expect(bite).toBeLessThan(11);
    // Hooking starts the fight; nothing is landed yet.
    expect(reel(bite + 4)).toBe(false);
    expect(getFishing().phase).toBe('fight');
    expect(food).toBe(0);
    // Strike each round when the marker is in the zone.
    let t = bite + 4;
    for (let i = 0; i < FIGHT_HITS; i++) {
      const f = getFishing().fight!;
      const sweep = f.sweep;
      let at = t + 0.01;
      while (!markerInZone(at)) at += 0.005;
      expect(at - t).toBeLessThan(sweep);
      t = at;
      const r = strike(t);
      expect(r).toBe(i === FIGHT_HITS - 1 ? 'landed' : 'hit');
      if (r === 'hit') expect(getFishing().fight!.sweep).toBeLessThan(sweep);
    }
    expect(food).toBe(1);
    expect(getFishing().phase).toBe('caught');
    updateFishing(t + 5, 0);
    expect(getFishing().phase).toBe('idle');
  });

  it('the zone narrows and the marker sweeps the whole bar', () => {
    setFishingRandom(() => 0.5);
    cast(0, 20);
    const bite = waitFor(0, 0, 60);
    reel(bite);
    const f = getFishing().fight!;
    const w0 = f.zoneW;
    let lo = 1, hi = 0;
    for (let t = bite; t < bite + f.sweep; t += 0.01) { const m = markerAt(t); lo = Math.min(lo, m); hi = Math.max(hi, m); }
    expect(lo).toBeLessThan(0.02);
    expect(hi).toBeGreaterThan(0.98);
    let at = bite;
    while (!markerInZone(at)) at += 0.005;
    strike(at);
    expect(getFishing().fight!.zoneW).toBeLessThan(w0);
  });

  it('two bad strikes, or rounds left too long, lose the fish', () => {
    let food = 0;
    setFishingReward(() => { food++; });
    setFishingRandom(() => 0.5);
    cast(0, 20);
    let bite = waitFor(0, 0, 60);
    reel(bite);
    let t = bite;
    for (let i = 0; i < FIGHT_MISSES; i++) {
      while (markerInZone(t)) t += 0.005;
      expect(strike(t)).toBe(i === FIGHT_MISSES - 1 ? 'lost' : 'miss');
    }
    expect(getFishing().phase).toBe('missed');
    // Do nothing at all: each idle round counts as a bad one.
    updateFishing(t + 10, 0);
    cast(t + 10, 20);
    bite = waitFor(t + 10, 0, 60);
    reel(bite);
    updateFishing(bite + FIGHT_ROUND_S + 0.1, 0);
    expect(getFishing().phase).toBe('fight');
    updateFishing(bite + 2 * FIGHT_ROUND_S + 0.2, 0);
    expect(getFishing().phase).toBe('missed');
    expect(food).toBe(0);
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
