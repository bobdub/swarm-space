import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetNatureEventsForTest, acceptPeerNatureEvent, eventId } from '@/lib/world/natureEventsStore';
import { travel, starboardOf } from '../dockSite';
import {
  FISH_FOOD,
  SHARK_FIGHT_HITS,
  SHARK_FOOD,
  _resetFishingForTest,
  cast,
  getFishing,
  markerInZone,
  reel,
  setFishingRandom,
  setFishingReward,
  strike,
  updateFishing,
} from '../fishing';
import { _resetSeaLifeForTest, arcMetres, getSeaLife, seaLifeNear, seaPoseAt } from '../seaLife';
import {
  KNIFE_REACH_M,
  SHARK_BACKOFF_S,
  SHARK_BITE_M,
  SHARK_FLEE_S,
  SHARK_GONE_MS,
  SHARK_SHOVE_M,
  _resetSharksForTest,
  hookableShark,
  knifeShark,
  recordSharkCaught,
  sharkBlockId,
  sharkDiveAt,
  sharkGone,
  sharkKeepingAway,
  threateningShark,
  trySharkBite,
} from '../sharks';

const T = 1e7;
const NOW = Date.UTC(2026, 10, 21);

function aShark() {
  return getSeaLife().find((c) => c.kind === 'shark')!;
}

beforeEach(() => { _resetSeaLifeForTest(); _resetSharksForTest(); _resetNatureEventsForTest(); _resetFishingForTest(); });
afterEach(() => { _resetSharksForTest(); _resetNatureEventsForTest(); _resetFishingForTest(); });

describe('a shark meets a swimmer', () => {
  it('bites once when close, shoves the swimmer away, then backs off', () => {
    const c = aShark();
    const p = seaPoseAt(c, T);
    const swimmer = travel(p.n, starboardOf(p.n, p.heading), 1.5);
    const bite = trySharkBite(swimmer, T, NOW);
    expect(bite?.sharkId).toBe(c.id);
    // Shoved about SHARK_SHOVE_M, away from the shark.
    expect(arcMetres(swimmer, bite!.shoveTo)).toBeCloseTo(SHARK_SHOVE_M, 1);
    expect(arcMetres(bite!.shoveTo, p.n)).toBeGreaterThan(arcMetres(swimmer, p.n));
    // It backs off: no second bite, it dives, and it comes back later.
    expect(trySharkBite(swimmer, T + 1, NOW)).toBeNull();
    expect(sharkKeepingAway(c.id, T + SHARK_BACKOFF_S - 1)).toBe(true);
    expect(sharkDiveAt(c.id, T + 5)).toBeGreaterThan(2);
    expect(sharkKeepingAway(c.id, T + SHARK_BACKOFF_S + 1)).toBe(false);
    expect(sharkDiveAt(c.id, T + SHARK_BACKOFF_S + 1)).toBe(0);
  });

  it('does not bite a swimmer out of reach', () => {
    const c = aShark();
    const p = seaPoseAt(c, T);
    const swimmer = travel(p.n, starboardOf(p.n, p.heading), SHARK_BITE_M + 2);
    expect(trySharkBite(swimmer, T, NOW)).toBeNull();
    expect(threateningShark(swimmer, T, NOW, 12)?.c.id).toBe(c.id);
  });

  it('a knife in reach of its body drives it off for a minute', () => {
    const c = aShark();
    const p = seaPoseAt(c, T);
    // Beside its tail, farther from its centre than the knife reaches.
    const tail = travel(p.n, p.heading, -1.2);
    const swimmer = travel(tail, starboardOf(p.n, p.heading), KNIFE_REACH_M - 0.3);
    expect(arcMetres(swimmer, p.n)).toBeGreaterThan(KNIFE_REACH_M);
    expect(knifeShark(swimmer, T, NOW)).toBe(c.id);
    expect(trySharkBite(travel(p.n, starboardOf(p.n, p.heading), 1), T + 10, NOW)).toBeNull();
    expect(sharkKeepingAway(c.id, T + SHARK_FLEE_S - 1)).toBe(true);
    // Too far: nothing happens.
    _resetSharksForTest();
    const far = travel(p.n, starboardOf(p.n, p.heading), 4);
    expect(knifeShark(far, T, NOW)).toBeNull();
  });
});

describe('catching a shark', () => {
  it('can only be hooked in deep water with a shark about', () => {
    const c = aShark();
    const p = seaPoseAt(c, T);
    expect(hookableShark(p.n, 30, T, NOW)).toBe(c.id);
    expect(hookableShark(p.n, 8, T, NOW)).toBeNull();
    // A lattice spot with no shark near it.
    const lonely = getSeaLife().find((x) => x.kind === 'school' && seaLifeNear(x.home, 130, 'shark').length === 0)!;
    expect(hookableShark(lonely.home, 30, T, NOW)).toBeNull();
  });

  it('about one bite in ten is the shark, and it takes a harder fight for +5 Food', () => {
    const c = aShark();
    // rng: bite time 0.5, then shark roll 0.05 (< 0.1).
    const rolls = [0.5, 0.05];
    let k = 0;
    setFishingRandom(() => rolls[Math.min(k++, rolls.length - 1)] ?? 0.5);
    let got = { food: 0, kind: '', shark: null as string | null };
    setFishingReward((food, kind, sharkId) => { got = { food, kind, shark: sharkId }; });
    cast(0, 30, false, c.id);
    let t = 0;
    while (getFishing().phase === 'waiting' && t < 60) { t += 0.1; updateFishing(t, 0); }
    expect(getFishing().phase).toBe('bite');
    expect(getFishing().on).toBe('shark');
    setFishingRandom(() => 0.5);
    reel(t);
    expect(getFishing().fight!.need).toBe(SHARK_FIGHT_HITS);
    expect(getFishing().fight!.zoneW).toBeLessThan(0.25);
    for (let i = 0; i < SHARK_FIGHT_HITS; i++) {
      while (!markerInZone(t)) t += 0.002;
      strike(t);
    }
    expect(getFishing().phase).toBe('caught');
    expect(got).toEqual({ food: SHARK_FOOD, kind: 'shark', shark: c.id });
    expect(SHARK_FOOD).toBeGreaterThan(FISH_FOOD);
  });

  it('a bite with no shark about is always a fish', () => {
    setFishingRandom(() => 0.01);
    cast(0, 30, false, null);
    let t = 0;
    while (getFishing().phase === 'waiting' && t < 60) { t += 0.1; updateFishing(t, 0); }
    expect(getFishing().on).toBe('fish');
  });

  it('a caught shark is gone for everyone for ten minutes', () => {
    const c = aShark();
    const p = seaPoseAt(c, T);
    recordSharkCaught(c.id, NOW);
    expect(sharkGone(c.id, NOW + 1000)).toBe(true);
    expect(hookableShark(p.n, 30, T, NOW + 1000)).not.toBe(c.id);
    expect(trySharkBite(p.n, T, NOW + 1000)).toBeNull();
    expect(sharkGone(c.id, NOW + SHARK_GONE_MS + 1)).toBe(false);
    // Another peer learns of it through the shared nature events.
    _resetNatureEventsForTest();
    expect(sharkGone(c.id, NOW + 1000)).toBe(false);
    const at = NOW;
    expect(acceptPeerNatureEvent({
      id: eventId('shark-caught', sharkBlockId(c.id), at), kind: 'shark-caught', blockId: sharkBlockId(c.id), anchorPeerId: 'sea', at, x: 0, z: 0,
    }, NOW + 1000)).toBe(true);
    expect(sharkGone(c.id, NOW + 1000)).toBe(true);
  });
});

describe('the saved shark is checked again', () => {
  it('no shark bite if it was caught or left reach while waiting, and none landed if caught mid-fight', async () => {
    const { setSharkCheck } = await import('../fishing');
    const c = aShark();
    let there = false;
    setSharkCheck(() => there);
    setFishingRandom(() => 0.05);
    cast(0, 30, false, c.id);
    let t = 0;
    while (getFishing().phase === 'waiting' && t < 60) { t += 0.1; updateFishing(t, 0); }
    expect(getFishing().on).toBe('fish');
    // Hooked while there, then caught by someone else before we land it.
    reel(t);
    updateFishing(t + 5, 0); updateFishing(t + 20, 0);
    there = true;
    cast(100, 30, false, c.id);
    t = 100;
    while (getFishing().phase === 'waiting' && t < 200) { t += 0.1; updateFishing(t, 0); }
    expect(getFishing().on).toBe('shark');
    setFishingRandom(() => 0.5);
    let food = 0;
    setFishingReward((f) => { food += f; });
    reel(t);
    there = false;
    let r: string | null = null;
    for (let i = 0; i < SHARK_FIGHT_HITS; i++) {
      while (!markerInZone(t)) t += 0.002;
      r = strike(t);
    }
    expect(r).toBe('lost');
    expect(food).toBe(0);
  });

  it('sharkStillHookable checks depth, reach and the shared catch', async () => {
    const { sharkStillHookable } = await import('../sharks');
    const c = aShark();
    const p = seaPoseAt(c, T);
    expect(sharkStillHookable(c.id, p.n, 30, T, NOW)).toBe(true);
    expect(sharkStillHookable(c.id, p.n, 5, T, NOW)).toBe(false);
    expect(sharkStillHookable(c.id, travel(p.n, p.heading, 400), 30, T, NOW)).toBe(false);
    recordSharkCaught(c.id, NOW);
    expect(sharkStillHookable(c.id, p.n, 30, T, NOW + 1000)).toBe(false);
  });
});
