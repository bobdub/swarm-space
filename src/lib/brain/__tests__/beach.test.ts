import { describe, expect, it } from 'vitest';
import { BEACH_LOW_M, BEACH_TOP_M, isBeachAt, isBeachElevation } from '../beach';
import { groundElevationAt } from '../groundHeight';
import { sampleMapSurface } from '../mapSurface';
import type { Vec3 } from '../earth';

describe('beach band', () => {
  it('runs from wet sand below the waterline up to the grass', () => {
    expect(isBeachElevation(BEACH_LOW_M)).toBe(true);
    expect(isBeachElevation(0)).toBe(true);
    expect(isBeachElevation(BEACH_TOP_M - 0.01)).toBe(true);
    expect(isBeachElevation(BEACH_TOP_M)).toBe(false);
    expect(isBeachElevation(-3)).toBe(false);
  });

  it('is where the mini map paints sand, and is common round the coasts', () => {
    let beach = 0;
    for (let i = 0; i < 20000; i++) {
      const y = 1 - (2 * (i + 0.5)) / 20000;
      const r = Math.sqrt(1 - y * y);
      const n: Vec3 = [r * Math.cos(i * 2.39996), y, r * Math.sin(i * 2.39996)];
      const e = groundElevationAt(n);
      if (!isBeachAt(n)) continue;
      beach++;
      if (e >= 0) expect(sampleMapSurface(n)).toBe('beach');
    }
    expect(beach).toBeGreaterThan(100);
  });
});
