import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS, type Vec3 } from '../../earth';
import { getVillageDockSite, travel } from '../dockSite';
import { WAKE_LIFE_S, WAKE_MAX_POINTS, WakeTrail } from '../wake';

describe('wake', () => {
  it('trails a moving boat, widens and fades, and leaves none at rest', () => {
    const site = getVillageDockSite()!;
    const trail = new WakeTrail();
    const h = site.boatHeading;
    let n: Vec3 = site.boatCenter;
    for (let i = 0; i <= 40; i++) {
      trail.sample({ center: n, heading: h }, 0.1, i * 0.1, EARTH_RADIUS);
    }
    expect(trail.points.length).toBe(0);
    for (let i = 0; i <= 40; i++) {
      n = travel(site.boatCenter, h, 3 * i * 0.1);
      trail.sample({ center: n, heading: h }, 3, 10 + i * 0.1, EARTH_RADIUS);
    }
    expect(trail.points.length).toBeGreaterThan(10);
    const pos = new Float32Array(WAKE_MAX_POINTS * 6);
    const alpha = new Float32Array(WAKE_MAX_POINTS * 2);
    const k = trail.ribbon(14, EARTH_RADIUS, 0.06, pos, alpha);
    expect(k).toBe(trail.points.length);
    const width = (i: number) => Math.hypot(pos[i * 6] - pos[i * 6 + 3], pos[i * 6 + 1] - pos[i * 6 + 4], pos[i * 6 + 2] - pos[i * 6 + 5]);
    // Oldest (first) is widest and faintest.
    expect(width(0)).toBeGreaterThan(width(k - 1));
    expect(alpha[0]).toBeLessThan(alpha[2 * (k - 1)]);
    // All gone once the life has passed.
    trail.sample({ center: n, heading: h }, 0, 14 + WAKE_LIFE_S + 1, EARTH_RADIUS);
    expect(trail.ribbon(14 + WAKE_LIFE_S + 1, EARTH_RADIUS, 0.06, pos, alpha)).toBe(0);
  });
});
