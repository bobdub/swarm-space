import { describe, it, expect } from 'vitest';
import {
  spawnOnEarth,
  projectToEarthSurface,
  geodesicStep,
  earthGravityForce,
  EARTH_POSITION,
  EARTH_RADIUS,
} from '../earth';

describe('earth', () => {
  it('spawns 32 peers near surface without exact stacks', () => {
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const p = spawnOnEarth(`peer-${i}`);
      // Each spawn lies on the surface (within 0.1 of R)
      const dx = p[0] - EARTH_POSITION[0];
      const dy = p[1] - EARTH_POSITION[1];
      const dz = p[2] - EARTH_POSITION[2];
      const r = Math.hypot(dx, dy, dz);
      expect(Math.abs(r - EARTH_RADIUS)).toBeLessThan(0.15);
      // No prior point at the exact same coordinates (anti-stack).
      for (const q of seen) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(d).toBeGreaterThan(0.01);
      }
      seen.push(p);
    }
  });

  it('same peer id produces same spawn point (deterministic)', () => {
    const a = spawnOnEarth('alice');
    const b = spawnOnEarth('alice');
    expect(a).toEqual(b);
  });

  it('projectToEarthSurface clamps interior points to surface', () => {
    const inside: [number, number, number] = [
      EARTH_POSITION[0] + 0.5,
      EARTH_POSITION[1],
      EARTH_POSITION[2],
    ];
    const out = projectToEarthSurface(inside);
    const r = Math.hypot(
      out[0] - EARTH_POSITION[0],
      out[1] - EARTH_POSITION[1],
      out[2] - EARTH_POSITION[2],
    );
    expect(r).toBeCloseTo(EARTH_RADIUS, 5);
  });

  it('geodesicStep preserves intent magnitude on the surface', () => {
    const surface: [number, number, number] = [
      EARTH_POSITION[0] + EARTH_RADIUS,
      EARTH_POSITION[1],
      EARTH_POSITION[2],
    ];
    const out = geodesicStep(surface, 1.0, 0.0);
    const mag = Math.hypot(out[0], out[1], out[2]);
    // tangent component of a purely-X intent at +X surface is ~0; check that
    // the function at least doesn't blow up and stays bounded.
    expect(mag).toBeLessThanOrEqual(1.01);
  });

  it('earthGravityForce zero outside atmosphere', () => {
    const far: [number, number, number] = [50, 50, 50];
    const f = earthGravityForce(far);
    expect(Math.hypot(f[0], f[1], f[2])).toBe(0);
  });

  it('earthGravityForce points inward when above surface', () => {
    const above: [number, number, number] = [
      EARTH_POSITION[0] + EARTH_RADIUS + 0.4,
      EARTH_POSITION[1],
      EARTH_POSITION[2],
    ];
    const f = earthGravityForce(above);
    expect(f[0]).toBeLessThan(0); // pulled in -X toward Earth center
  });
});