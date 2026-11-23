import { describe, expect, it } from 'vitest';
import {
  CONSTELLATIONS,
  buildConstellationBuffers,
  chartPointDirection,
  skyDirection,
  twinkleTime,
  TWINKLE_PERIOD_S,
} from '../constellations';

const angleDeg = (a: number[], b: number[]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;

describe('night-sky constellations', () => {
  it('has the Cat, the Dragon, the Pirate Ship and the Flask', () => {
    expect(CONSTELLATIONS.map((c) => c.id)).toEqual(['cat', 'dragon', 'ship', 'flask']);
  });

  it('only draws lines between stars that exist', () => {
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        expect(c.stars[a]).toBeDefined();
        expect(c.stars[b]).toBeDefined();
        expect(a).not.toBe(b);
      }
    }
  });

  it('keeps chart distances as angles on the sky', () => {
    for (const c of CONSTELLATIONS) {
      const centre = skyDirection(c.ra, c.dec);
      for (const star of c.stars) {
        const d = chartPointDirection(c, star.x, star.y);
        expect(Math.hypot(...d)).toBeCloseTo(1, 6);
        const expected = Math.hypot(star.x, star.y);
        expect(Math.abs(angleDeg(d, centre) - expected)).toBeLessThan(0.6);
      }
    }
  });

  it('points chart north toward the celestial pole and east to the right', () => {
    const c = CONSTELLATIONS[0];
    const centre = skyDirection(c.ra, c.dec);
    expect(chartPointDirection(c, 0, 5)[1]).toBeGreaterThan(centre[1]);
    const right = chartPointDirection(c, 5, 0);
    const left = chartPointDirection(c, -5, 0);
    const ra = (v: number[]) => Math.atan2(v[2], v[0]);
    expect(ra(right)).not.toBeCloseTo(ra(left), 3);
  });

  it('keeps the four figures apart on the sky', () => {
    for (let i = 0; i < CONSTELLATIONS.length; i++) {
      for (let j = i + 1; j < CONSTELLATIONS.length; j++) {
        const a = CONSTELLATIONS[i];
        const b = CONSTELLATIONS[j];
        expect(angleDeg(skyDirection(a.ra, a.dec), skyDirection(b.ra, b.dec))).toBeGreaterThan(45);
      }
    }
  });

  it('bakes deterministic buffers on the sky shell', () => {
    const radius = 1000;
    const a = buildConstellationBuffers(radius);
    const b = buildConstellationBuffers(radius);
    const stars = CONSTELLATIONS.reduce((n, c) => n + c.stars.length, 0);
    const lines = CONSTELLATIONS.reduce((n, c) => n + c.lines.length, 0);
    expect(a.starPositions.length).toBe(stars * 3);
    expect(a.starMags.length).toBe(stars);
    expect(a.linePositions.length).toBe(lines * 6);
    expect(Array.from(a.starPositions)).toEqual(Array.from(b.starPositions));
    expect(Array.from(a.starPhases)).toEqual(Array.from(b.starPhases));
    for (let i = 0; i < a.starPositions.length; i += 3) {
      expect(Math.hypot(a.starPositions[i], a.starPositions[i + 1], a.starPositions[i + 2]))
        .toBeCloseTo(radius, 1);
    }
  });

  it('folds the shared clock into one twinkle period', () => {
    expect(twinkleTime(0)).toBe(0);
    expect(twinkleTime(TWINKLE_PERIOD_S * 1000 + 12.5)).toBeCloseTo(12.5, 6);
    expect(twinkleTime(-1)).toBeCloseTo(TWINKLE_PERIOD_S - 1, 6);
  });
});
