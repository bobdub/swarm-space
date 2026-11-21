import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS, type Vec3 } from '../../earth';
import { getVillageDockSite, travel } from '../dockSite';
import {
  KELVIN_HALF_ANGLE,
  RIPPLE_VERTS,
  WAKE_LIFE_S,
  WAKE_MAX_POINTS,
  WakeTrail,
  rippleIndices,
  ripplePhaseSpeed,
  rippleRadius,
  rippleWavelength,
} from '../wake';

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

  it('spreads rings from the bow that draw a Kelvin wedge', () => {
    const site = getVillageDockSite()!;
    const trail = new WakeTrail();
    const h = site.boatHeading;
    const U = 6;
    const T = 5;
    for (let t = 0; t <= T + 1e-9; t += 0.05) {
      trail.sample({ center: travel(site.boatCenter, h, U * t), heading: h }, U, t, EARTH_RADIUS);
    }
    const max = WAKE_MAX_POINTS * RIPPLE_VERTS;
    const pos = new Float32Array(max * 3);
    const off = new Float32Array(max * 2);
    const ring = new Float32Array(max * 4);
    const k = trail.ripples(T, EARTH_RADIUS, 0.05, pos, off, ring);
    expect(k).toBeGreaterThan(10);
    // Every ring's front, seen from where the bow is now, stays inside
    // asin(1/3) ≈ 19.47° of the track: the Kelvin wedge.
    expect((KELVIN_HALF_ANGLE * 180) / Math.PI).toBeCloseTo(19.47, 2);
    for (const p of trail.points) {
      const age = T - p.t;
      if (age < 1) continue;
      const behind = U * age;
      const R = rippleRadius(p.speed, age);
      expect(Math.asin(Math.min(1, R / behind))).toBeLessThan(KELVIN_HALF_ANGLE + 0.12);
    }
    // Crests outrun the front (phase speed > ring growth), and older rings
    // are wider and fainter.
    expect(ripplePhaseSpeed(rippleWavelength(U))).toBeGreaterThan(U / 3 / 2);
    const first = ring.subarray(0, 4);
    const last = ring.subarray((k - 1) * RIPPLE_VERTS * 4, (k - 1) * RIPPLE_VERTS * 4 + 4);
    expect(first[0]).toBeGreaterThan(last[0]);
    expect(first[1]).toBeLessThan(1);
    // The patch spans the ring and sits on the sea.
    const r0 = Math.hypot(pos[0], pos[1], pos[2]);
    expect(r0).toBeGreaterThan(EARTH_RADIUS - 0.5);
    expect(r0).toBeLessThan(EARTH_RADIUS + 0.5);
    expect(Math.abs(off[0])).toBeCloseTo(first[0], 5);
    expect(rippleIndices(k).length).toBe(k * 4 * 4 * 6);
    // Gone once the life has passed.
    expect(trail.ripples(T + WAKE_LIFE_S + 1, EARTH_RADIUS, 0.05, pos, off, ring)).toBe(0);
  });
});
