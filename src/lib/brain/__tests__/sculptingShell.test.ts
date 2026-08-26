import { describe, it, expect } from 'vitest';
import { applyImpact } from '../sculpting';
import { EARTH_SHELLS } from '../earthShells';
import { getToolAny } from '../toolCatalog';

const axe = getToolAny('tool_axe_stone')!;
const grass = EARTH_SHELLS.find((s) => s.n <= 1)!;
const lava = EARTH_SHELLS.find((s) => s.id.startsWith('lava'));

describe('applyImpact — shell branch', () => {
  it('lets an axe break sod (n ≤ 2)', () => {
    const res = applyImpact({
      tool: axe,
      swingEnergy: 12,
      target: { kind: 'shell', shell: grass, rFrac: 1, cellKey: 'c:0:0' },
    });
    expect(res.reason).not.toBe('wrong_action_kind');
    expect(res.cut).toBe(true);
  });

  it('rejects a swing below the shell sharpness threshold', () => {
    const res = applyImpact({
      tool: axe,
      sharpness: 0,
      swingEnergy: 12,
      target: { kind: 'shell', shell: grass, rFrac: 1, cellKey: 'c:0:0' },
    });
    expect(res.cut).toBe(false);
    expect(res.reason).toBe('sharpness_below_threshold');
  });

  it('never cuts lava', () => {
    if (!lava) return;
    const res = applyImpact({
      tool: axe,
      swingEnergy: 999,
      target: { kind: 'shell', shell: lava, rFrac: 0.1, cellKey: 'c:0:0' },
    });
    expect(res.cut).toBe(false);
    expect(res.reason).toBe('lava_burns_tool');
  });

  it('raises resistance as weather curvature load rises', () => {
    const dry = applyImpact({
      tool: axe,
      swingEnergy: 12,
      curvatureLoad: 0,
      target: { kind: 'shell', shell: grass, rFrac: 1, cellKey: 'c:0:0' },
    });
    const wet = applyImpact({
      tool: axe,
      swingEnergy: 12,
      curvatureLoad: 1.5,
      target: { kind: 'shell', shell: grass, rFrac: 1, cellKey: 'c:0:0' },
    });
    expect(wet.resistance).toBeGreaterThan(dry.resistance);
    expect(wet.effectiveCut).toBeLessThan(dry.effectiveCut);
  });
});
