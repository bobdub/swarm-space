import { describe, it, expect } from 'vitest';
import {
  buildGalaxy,
  GALAXY_SEED,
  GALAXY_STAR_COUNT,
  GALAXY_ARMS,
  applyGalaxyToField,
} from '../galaxy';
import { createField3D, FIELD3D_N } from '../../uqrc/field3D';

describe('galaxy', () => {
  it('produces same star positions for the same seed', () => {
    const a = buildGalaxy(GALAXY_SEED);
    const b = buildGalaxy(GALAXY_SEED);
    expect(a.stars.length).toBe(b.stars.length);
    for (let i = 0; i < a.stars.length; i++) {
      expect(a.stars[i].pos[0]).toBeCloseTo(b.stars[i].pos[0], 6);
      expect(a.stars[i].pos[1]).toBeCloseTo(b.stars[i].pos[1], 6);
      expect(a.stars[i].pos[2]).toBeCloseTo(b.stars[i].pos[2], 6);
    }
  });

  it('produces different star positions for a different seed', () => {
    const a = buildGalaxy(1);
    const b = buildGalaxy(2);
    let differs = 0;
    for (let i = 0; i < a.stars.length; i++) {
      if (Math.abs(a.stars[i].pos[0] - b.stars[i].pos[0]) > 0.01) differs++;
    }
    expect(differs).toBeGreaterThan(a.stars.length / 2);
  });

  it('contains GALAXY_STAR_COUNT (rounded to arms) named stars', () => {
    const g = buildGalaxy(GALAXY_SEED);
    const expected = Math.floor(GALAXY_STAR_COUNT / GALAXY_ARMS) * GALAXY_ARMS;
    expect(g.stars.length).toBe(expected);
  });

  it('writes pins into the field without throwing', () => {
    const f = createField3D(FIELD3D_N);
    const g = buildGalaxy(GALAXY_SEED);
    expect(() => applyGalaxyToField(f, g)).not.toThrow();
    // Earth + core + stars all leave at least one pin per axis or per star.
    expect(f.pins.size).toBeGreaterThan(g.stars.length / 2);
  });
});