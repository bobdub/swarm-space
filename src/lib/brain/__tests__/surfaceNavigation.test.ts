import { describe, it, expect } from 'vitest';
import { surfaceHeading } from '../surfaceNavigation';
import type { Vec3 } from '../earth';

describe('globe heading continuity', () => {
  it('stays tangent and continuous for a complete globe circuit', () => {
    let heading: Vec3 = [1, 0, 0];
    for (let i = 1; i <= 720; i++) {
      const angle = i * Math.PI / 360;
      const up: Vec3 = [Math.sin(angle), Math.cos(angle), 0];
      const next = surfaceHeading(up, heading, [1, 0, 0]);
      expect(Math.hypot(...next)).toBeCloseTo(1, 10);
      expect(next[0] * up[0] + next[1] * up[1] + next[2] * up[2]).toBeCloseTo(0, 10);
      expect(next[0] * heading[0] + next[1] * heading[1] + next[2] * heading[2]).toBeGreaterThan(0.999);
      heading = next;
    }
  });

  it('recovers a finite heading when both anchor axes point radially', () => {
    const heading = surfaceHeading([0, 1, 0], [0, 1, 0], [0, -1, 0]);
    expect(heading.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...heading)).toBe(1);
    expect(heading[1]).toBe(0);
  });
});