import { describe, expect, it, beforeEach } from 'vitest';
import {
  BOAT_MOOR_DEPTH,
  JETTY_TOP,
  MAX_JETTY_M,
  _resetDockSiteForTest,
  getVillageDockSite,
  travel,
} from '../dockSite';
import {
  EARTH_RADIUS,
  SHARED_VILLAGE_ISLAND_ANCHOR,
  VILLAGE_ISLAND_RADIUS_M,
  getEarthLocalSiteFrame,
} from '../../earth';
import { groundElevationAt, isSwimmingAt, supportElevationAt } from '../../groundHeight';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../../volcanoOrgan';
import { _resetDecksForTest, registerDeckSurface, straightDeck } from '../deckSupport';

const arcM = (a: number[], b: number[]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * EARTH_RADIUS;

describe('village dock site', () => {
  beforeEach(() => _resetDockSiteForTest());

  it('finds a berth deep enough for the boat', () => {
    const site = getVillageDockSite();
    expect(site).not.toBeNull();
    for (const d of site!.boatDepths) expect(d).toBeGreaterThanOrEqual(BOAT_MOOR_DEPTH);
    expect(-groundElevationAt(site!.boatCenter)).toBeGreaterThanOrEqual(BOAT_MOOR_DEPTH);
  });

  it('starts the jetty on the village island shore and keeps it short', () => {
    const site = getVillageDockSite()!;
    const center = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    const fromCenter = arcM(site.jettyStart, center);
    // The island waterline wobbles ±18 % around 200 m.
    expect(fromCenter).toBeGreaterThan(VILLAGE_ISLAND_RADIUS_M * 0.6);
    expect(fromCenter).toBeLessThan(VILLAGE_ISLAND_RADIUS_M * 1.5);
    expect(groundElevationAt(site.jettyStart)).toBeGreaterThanOrEqual(JETTY_TOP);
    expect(site.jettyLength).toBeLessThanOrEqual(MAX_JETTY_M);
  });

  it('sits well away from the volcano', () => {
    const site = getVillageDockSite()!;
    const volcano = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID).centerNormal;
    expect(arcM(site.boatCenter, volcano)).toBeGreaterThan(250);
  });

  it('is the same on every run', () => {
    const a = getVillageDockSite()!;
    _resetDockSiteForTest();
    const b = getVillageDockSite()!;
    expect(b.boatCenter).toEqual(a.boatCenter);
    expect(b.jettyStart).toEqual(a.jettyStart);
    expect(b.jettyLength).toBe(a.jettyLength);
  });

  it('heads the boat out to sea, tangent to the surface', () => {
    const site = getVillageDockSite()!;
    const h = site.boatHeading;
    const n = site.boatCenter;
    expect(Math.abs(h[0] * n[0] + h[1] * n[1] + h[2] * n[2])).toBeLessThan(1e-9);
    expect(Math.hypot(...h)).toBeCloseTo(1, 9);
    const center = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    const ahead = travel(n, h, 5);
    expect(arcM(ahead, center)).toBeGreaterThan(arcM(n, center));
  });
});

describe('jetty deck surface', () => {
  beforeEach(() => _resetDecksForTest());

  it('holds a walker on the planks over deep water, and nowhere else', () => {
    const site = getVillageDockSite()!;
    const off = registerDeckSurface(
      straightDeck({
        id: 'jetty-test',
        start: site.jettyStart,
        dir: site.jettyDir,
        length: site.jettyLength,
        width: 2.2,
        top: JETTY_TOP,
        radius: EARTH_RADIUS,
      }),
    );
    const onEnd = travel(site.jettyStart, site.jettyDir, site.jettyLength - 1);
    expect(groundElevationAt(onEnd)).toBeLessThan(0);
    expect(supportElevationAt(onEnd)).toBe(JETTY_TOP);
    expect(isSwimmingAt(onEnd)).toBe(false);
    // Beyond the end and beside the boat: back to water.
    expect(supportElevationAt(site.boatCenter)).toBeLessThan(0);
    expect(isSwimmingAt(site.boatCenter)).toBe(true);
    off();
    expect(supportElevationAt(onEnd)).toBeLessThan(JETTY_TOP);
  });
});
