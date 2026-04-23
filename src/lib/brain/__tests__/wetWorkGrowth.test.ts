import { describe, it, expect } from 'vitest';
import { buildWetWorkSeed } from '../wetWorkSeed';

describe('wetWorkSeed', () => {
  it('grows a multi-part habitat with trunk + roots + ribs + chambers', () => {
    const nodes = buildWetWorkSeed(
      { crustCurvature: 0.1, plateStress: 0.2, coreBreath: 0 },
      { seed: 'test-habitat' },
    );
    const kinds = new Set(nodes.map((n) => n.kind));
    expect(kinds.has('trunk')).toBe(true);
    expect(kinds.has('root')).toBe(true);
    expect(kinds.has('rib')).toBe(true);
    expect(kinds.has('chamber')).toBe(true);
    expect(nodes.length).toBeGreaterThan(8);
  });

  it('expands chamber scale when crust is calm', () => {
    const calm = buildWetWorkSeed(
      { crustCurvature: 0.0, plateStress: 0, coreBreath: 0 },
      { seed: 's' },
    ).find((n) => n.kind === 'chamber')!;
    const stressed = buildWetWorkSeed(
      { crustCurvature: 1.0, plateStress: 0, coreBreath: 0 },
      { seed: 's' },
    ).find((n) => n.kind === 'chamber')!;
    expect(calm.scale).toBeGreaterThan(stressed.scale);
  });
});
