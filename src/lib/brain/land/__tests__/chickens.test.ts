import { describe, it, expect, beforeEach } from 'vitest';
import { groundElevationAt } from '../../groundHeight';
import { SHARED_VILLAGE_ISLAND_ANCHOR, getEarthLocalSiteFrame } from '../../earth';
import { arcMetres } from '../../sea/seaLife';
import {
  HEN_EVENT_ANCHOR,
  HEN_MIN_GROUND,
  CHICK_GROW_MS,
  LAY_EVERY_MS,
  broodChickPoseAt,
  broodChicks,
  flockOf,
  nestEggs,
  nearestNestEgg,
  EGG_HATCH_MS,
  EGG_LAY_MS,
  HEN_RESPAWN_MS,
  _resetChickensForTest,
  henLifeAt,
  roosterOf,
  getHens,
  henPoseAt,
  isHenAway,
  nearestCatchableHen,
} from '../chickens';
import {
  HEN_EVENT_TTL_MS,
  _resetNatureEventsForTest,
  acceptPeerNatureEvent,
  eventId,
  listNatureEvents,
  mergeNatureEvents,
  recordNatureEvent,
} from '@/lib/world/natureEventsStore';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;

beforeEach(() => {
  _resetNatureEventsForTest();
  _resetChickensForTest();
});

describe('free-range chickens', () => {
  it('puts flocks on the land, including round the village', () => {
    const t0 = performance.now();
    const hens = getHens();
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(hens.length).toBeGreaterThan(60);
    const village = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    const nearVillage = hens.filter((h) => arcMetres(village, h.home) < 170);
    expect(nearVillage.length).toBeGreaterThanOrEqual(10);
  });

  it('is the same on every peer', () => {
    const a = getHens().map((h) => ({ ...h }));
    _resetChickensForTest();
    const b = getHens();
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 7) {
      expect(b[i].id).toBe(a[i].id);
      expect(henPoseAt(b[i], T0 + 42.5).n).toEqual(henPoseAt(a[i], T0 + 42.5).n);
    }
  });

  it('keeps every hen on dry land as she walks, and she pauses to peck', () => {
    const hens = getHens();
    let pecks = 0;
    let walks = 0;
    for (let i = 0; i < hens.length; i += 5) {
      for (let s = 0; s < 600; s += 37) {
        const p = henPoseAt(hens[i], T0 + s);
        expect(groundElevationAt(p.n)).toBeGreaterThanOrEqual(HEN_MIN_GROUND - 0.3);
        if (p.pecking) pecks++; else walks++;
      }
    }
    expect(pecks).toBeGreaterThan(0);
    expect(walks).toBeGreaterThan(0);
  });

  it('walks at a chicken pace', () => {
    const h = getHens()[0];
    let maxStep = 0;
    for (let s = 0; s < 120; s += 0.5) {
      const d = arcMetres(henPoseAt(h, T0 + s).n, henPoseAt(h, T0 + s + 0.5).n) / 0.5;
      if (d > maxStep) maxStep = d;
    }
    expect(maxStep).toBeGreaterThan(0.1);
    expect(maxStep).toBeLessThan(1.5);
  });

  it('a catch hides the hen on every peer until she respawns', () => {
    const h = getHens()[0];
    const at = Date.UTC(2026, 10, 20, 12);
    // Another peer caught her.
    const e = { id: eventId('hen-caught', h.id, at), kind: 'hen-caught', blockId: h.id, anchorPeerId: HEN_EVENT_ANCHOR, at, x: 0, z: 0 };
    expect(acceptPeerNatureEvent(e, at)).toBe(true);
    expect(isHenAway(h.id, at - 1)).toBe(false);
    expect(isHenAway(h.id, at + 1000)).toBe(true);
    expect(isHenAway(h.id, at + HEN_RESPAWN_MS - 1)).toBe(true);
    expect(isHenAway(h.id, at + HEN_RESPAWN_MS)).toBe(false);
  });

  it('only offers hens that are within reach and not caught', () => {
    const h = getHens()[0];
    const t = T0 + 10;
    const now = Date.UTC(2026, 10, 20, 12);
    const at = henPoseAt(h, t).n;
    expect(nearestCatchableHen(at, t, now)?.hen.id).toBeDefined();
    const caught = nearestCatchableHen(at, t, now)!.hen.id;
    recordNatureEvent('hen-caught', caught, HEN_EVENT_ANCHOR, 0, 0, now);
    const next = nearestCatchableHen(at, t, now + 10);
    expect(next?.hen.id).not.toBe(caught);
  });

  it('old catches are forgotten so the event list stays small', () => {
    const now = Date.now();
    const old = now - HEN_EVENT_TTL_MS - 1000;
    const stale = { id: eventId('hen-caught', 'hen:v0-0', old), kind: 'hen-caught', blockId: 'hen:v0-0', anchorPeerId: HEN_EVENT_ANCHOR, at: old, x: 0, z: 0 };
    expect(mergeNatureEvents([stale], now)).toBe(0);
    recordNatureEvent('hen-caught', 'hen:v0-1', HEN_EVENT_ANCHOR, 0, 0, now);
    expect(listNatureEvents(HEN_EVENT_ANCHOR).length).toBe(1);
    // Hen events never show up among a biome's tree events.
    expect(listNatureEvents('swarm-shared-village').length).toBe(0);
  });

  it('every flock has exactly one rooster', () => {
    const flocks = new Map<string, number>();
    for (const h of getHens()) if (h.rooster) flocks.set(h.flock, (flocks.get(h.flock) ?? 0) + 1);
    const all = new Set(getHens().map((h) => h.flock));
    expect(flocks.size).toBe(all.size);
    for (const n of flocks.values()) expect(n).toBe(1);
    for (const f of all) expect(roosterOf(f)?.rooster).toBe(true);
  });

  it('a caught hen comes back as an egg, then a chick, then a hen', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const at = Date.UTC(2026, 10, 21, 12);
    recordNatureEvent('hen-caught', hen.id, HEN_EVENT_ANCHOR, 0, 0, at);
    expect(henLifeAt(hen, at + 1000).stage).toBe('gone');
    expect(henLifeAt(hen, at + EGG_LAY_MS + 1000).stage).toBe('egg');
    expect(henLifeAt(hen, at + EGG_LAY_MS + EGG_HATCH_MS + 1000).stage).toBe('chick');
    expect(henLifeAt(hen, at + HEN_RESPAWN_MS + 1000).stage).toBe('adult');
    // Not catchable as an egg or a chick.
    expect(isHenAway(hen.id, at + EGG_LAY_MS + EGG_HATCH_MS + CHICK_GROW_MS - 1)).toBe(true);
  });

  it('with the rooster gone, hens wait for a new one before laying', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const rooster = roosterOf(hen.flock)!;
    const at = Date.UTC(2026, 10, 21, 12);
    recordNatureEvent('hen-caught', rooster.id, HEN_EVENT_ANCHOR, 0, 0, at);
    recordNatureEvent('hen-caught', hen.id, HEN_EVENT_ANCHOR, 0, 0, at + 1000);
    // The rooster's own egg needs no rooster.
    expect(henLifeAt(rooster, at + EGG_LAY_MS + 1).stage).toBe('egg');
    // Hers waits until he is grown.
    expect(henLifeAt(hen, at + EGG_LAY_MS + 2000).stage).toBe('gone');
    const life = henLifeAt(hen, at + HEN_RESPAWN_MS + 1);
    expect(life.stage).toBe('egg');
    expect(life.layAt).toBe(at + HEN_RESPAWN_MS);
  });

  it('hens lay eggs in the nest on their own, so nests are rarely empty', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const flock = flockOf(hen);
    const start = Date.UTC(2026, 10, 21, 12);
    let withEggs = 0;
    let withChicks = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const now = start + i * 37_000;
      if (nestEggs(flock, now).length > 0) withEggs++;
      if (broodChicks(flock, now).length > 0) withChicks++;
    }
    expect(withEggs).toBeGreaterThan(N * 0.5);
    expect(withChicks).toBeGreaterThan(N * 0.3);
    // Every hen of the flock lays once per cycle.
    const hens = flock.filter((h) => !h.rooster).length;
    const laid = new Set<string>();
    for (let i = 0; i < 40; i++) for (const e of nestEggs(flock, start + i * 15_000)) laid.add(e.id);
    expect(laid.size).toBeGreaterThanOrEqual(hens);
    expect(laid.size).toBeLessThanOrEqual(hens * Math.ceil((40 * 15_000 + 3 * LAY_EVERY_MS) / LAY_EVERY_MS));
  });

  it('a taken egg is gone from the nest for everyone and never hatches', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const flock = flockOf(hen);
    let now = Date.UTC(2026, 10, 21, 12);
    // Find a moment with a fertile egg in the nest.
    let egg = nestEggs(flock, now).find((e) => e.fertile);
    for (let i = 0; !egg && i < 200; i++) { now += 10_000; egg = nestEggs(flock, now).find((e) => e.fertile); }
    expect(egg).toBeDefined();
    const at = nearestNestEgg(hen.nest, now);
    expect(at?.distM).toBeLessThan(0.01);
    recordNatureEvent('egg-taken', egg!.id, HEN_EVENT_ANCHOR, 0, 0, now);
    expect(nestEggs(flock, now + 1).some((e) => e.id === egg!.id)).toBe(false);
    const hatch = egg!.layAt + EGG_HATCH_MS + 1000;
    expect(broodChicks(flock, hatch).some((c) => c.egg.id === egg!.id)).toBe(false);
  });

  it('eggs laid with the rooster away are not fertile', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const flock = flockOf(hen);
    const rooster = roosterOf(hen.flock)!;
    const at = Date.UTC(2026, 10, 21, 12);
    recordNatureEvent('hen-caught', rooster.id, HEN_EVENT_ANCHOR, 0, 0, at);
    const laidWhileAway = nestEggs(flock, at + LAY_EVERY_MS + 1000).filter((e) => e.layAt > at && e.layAt < at + HEN_RESPAWN_MS);
    expect(laidWhileAway.length).toBeGreaterThan(0);
    for (const e of laidWhileAway) expect(e.fertile).toBe(false);
  });

  it('a brood chick follows its mother, then wanders off', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    const flock = flockOf(hen);
    let now = Date.UTC(2026, 10, 21, 12);
    let c = broodChicks(flock, now)[0];
    for (let i = 0; !c && i < 200; i++) { now += 10_000; c = broodChicks(flock, now)[0]; }
    expect(c).toBeDefined();
    const t = T0 + 50;
    const mid = broodChickPoseAt({ ...c, progress: 0.5 }, t);
    expect(arcMetres(mid.n, henPoseAt(c.egg.mother, t).n)).toBeLessThan(1.2);
    const gone = broodChickPoseAt({ ...c, progress: 0.999 }, t);
    expect(arcMetres(gone.n, c.egg.mother.nest)).toBeGreaterThan(5);
  });
});
