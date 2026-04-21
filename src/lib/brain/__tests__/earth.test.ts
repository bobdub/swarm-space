import { describe, it, expect } from 'vitest';
import {
  spawnOnEarth,
  radiusFromEarth,
  isOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
} from '../earth';

describe('earth (UQRC pure)', () => {
  it('spawns 32 peers exactly on the surface without exact stacks', () => {
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const p = spawnOnEarth(`peer-${i}`);
      expect(Math.abs(radiusFromEarth(p) - EARTH_RADIUS)).toBeLessThan(0.01);
      for (const q of seen) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(d).toBeGreaterThan(0.01);
      }
      seen.push(p);
    }
  });

  it('same peer id produces same spawn point (deterministic)', () => {
    expect(spawnOnEarth('alice')).toEqual(spawnOnEarth('alice'));
  });

  it('isOnEarth detects atmosphere proximity (render-only helper)', () => {
    expect(isOnEarth([EARTH_POSITION[0] + EARTH_RADIUS, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(true);
    expect(isOnEarth([EARTH_POSITION[0] + 50, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(false);
  });

  it('exports no gravity/spring/clamp helpers (UQRC conformance)', async () => {
    const mod = await import('../earth');
    expect((mod as Record<string, unknown>).EARTH_GRAVITY).toBeUndefined();
    expect((mod as Record<string, unknown>).EARTH_SURFACE_STIFFNESS).toBeUndefined();
    expect((mod as Record<string, unknown>).projectToEarthSurface).toBeUndefined();
    expect((mod as Record<string, unknown>).geodesicStep).toBeUndefined();
    expect((mod as Record<string, unknown>).earthGravityForce).toBeUndefined();
  });
});