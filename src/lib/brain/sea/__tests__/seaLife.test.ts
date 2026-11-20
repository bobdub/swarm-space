import { describe, it, expect, beforeEach } from 'vitest';
import { groundElevationAt } from '../../groundHeight';
import { getVillageDockSite } from '../dockSite';
import { BITE_WAIT_SCHOOL_S, BITE_WAIT_DEEP_S, meanBiteWait } from '../fishing';
import {
  SCHOOL_MIN_DEPTH,
  SHARK_MIN_DEPTH,
  _resetSeaLifeForTest,
  arcMetres,
  getSeaLife,
  nearestDistance,
  schoolNear,
  seaLifeNear,
  seaPoseAt,
} from '../seaLife';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;

beforeEach(() => _resetSeaLifeForTest());

describe('sea life', () => {
  it('fills the sea with schools and a few sharks, quickly', () => {
    const t0 = performance.now();
    const all = getSeaLife();
    expect(performance.now() - t0).toBeLessThan(1500);
    const schools = all.filter((c) => c.kind === 'school');
    const sharks = all.filter((c) => c.kind === 'shark');
    expect(schools.length).toBeGreaterThan(150);
    expect(sharks.length).toBeGreaterThan(20);
    expect(sharks.length).toBeLessThan(schools.length / 3);
  });

  it('is the same on every peer: same homes, same place at the same shared time', () => {
    const a = getSeaLife().map((c) => ({ ...c }));
    _resetSeaLifeForTest();
    const b = getSeaLife();
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 17) {
      expect(b[i].id).toBe(a[i].id);
      expect(seaPoseAt(b[i], T0 + 123.4).n).toEqual(seaPoseAt(a[i], T0 + 123.4).n);
    }
  });

  it('keeps every creature in water deep enough for it, all round its loop', () => {
    const all = getSeaLife();
    for (let i = 0; i < all.length; i += 3) {
      const c = all[i];
      const need = c.kind === 'school' ? SCHOOL_MIN_DEPTH : SHARK_MIN_DEPTH;
      for (let t = T0; t < T0 + 600; t += 7.3) {
        const depth = -groundElevationAt(seaPoseAt(c, t).n);
        // Checked on a grid at seed time: between grid points the floor
        // can rise a little, but never close to the surface.
        expect(depth).toBeGreaterThanOrEqual(need - 1);
      }
    }
  });

  it('swims at a fish-like pace with a heading along its path', () => {
    const c = getSeaLife().find((x) => x.kind === 'school')!;
    for (let t = T0; t < T0 + 60; t += 5) {
      const a = seaPoseAt(c, t);
      const b = seaPoseAt(c, t + 0.05);
      const moved = arcMetres(a.n, b.n) / 0.05;
      expect(moved).toBeLessThan(2.5);
      expect(Math.abs(moved - a.speed)).toBeLessThan(0.1);
      if (moved > 0.2) {
        const d: number[] = [b.n[0] - a.n[0], b.n[1] - a.n[1], b.n[2] - a.n[2]];
        const l = Math.hypot(...d);
        const along = (d[0] * a.heading[0] + d[1] * a.heading[1] + d[2] * a.heading[2]) / l;
        expect(along).toBeGreaterThan(0.95);
      }
    }
  });

  it('puts fish a short row from the jetty, and keeps sharks off the shelf', () => {
    const site = getVillageDockSite()!;
    const schools = seaLifeNear(site.boatCenter, 250, 'school').filter((c) => c.id.startsWith('school-v'));
    expect(schools.length).toBeGreaterThanOrEqual(3);
    // No shark ever comes within 80 m of the berth.
    expect(nearestDistance(site.boatCenter, T0, 'shark', 80)).toBe(Infinity);
    expect(seaLifeNear(site.boatCenter, 600, 'shark').length).toBeGreaterThanOrEqual(1);
  });

  it('a school under the boat makes the fish bite sooner', () => {
    const c = getSeaLife().find((x) => x.kind === 'school')!;
    const at = seaPoseAt(c, T0).n;
    expect(schoolNear(at, T0)).toBe(true);
    expect(meanBiteWait(20, true)).toBe(BITE_WAIT_SCHOOL_S);
    expect(meanBiteWait(20, true)).toBeLessThan(meanBiteWait(20, false));
    expect(meanBiteWait(20, false)).toBe(BITE_WAIT_DEEP_S);
  });
});
