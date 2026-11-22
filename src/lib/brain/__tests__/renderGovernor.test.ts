import { describe, expect, it } from 'vitest';
import { RenderGovernor, createTierGate, welfordPush, welfordStd } from '../renderGovernor';

describe('render governor', () => {
  it('learns Welford mean and spread', () => {
    let s = { n: 0, mean: 0, m2: 0 };
    for (const x of [2, 4, 4, 4, 5, 5, 7, 9]) s = welfordPush(s, x);
    expect(s.mean).toBe(5);
    expect(welfordStd(s)).toBeCloseTo(2.138, 2);
  });
  it('rises from calm to strained on slow frames and reports changes once', () => {
    const g = new RenderGovernor();
    const seen: string[] = [];
    g.onPressure((p) => seen.push(p));
    for (let i = 0; i < 60; i++) g.observeFrame(40);
    expect(g.pressure()).toBe('strained');
    expect(seen).toEqual(['stressed', 'strained']);
  });
  it('ignores tab-suspension gaps', () => {
    const g = new RenderGovernor();
    g.observeFrame(5000);
    expect(g.pressure()).toBe('calm');
    expect(g.frame.n).toBe(0);
  });
  it('runs every tier every frame, even under strain', () => {
    const g = new RenderGovernor();
    for (let i = 0; i < 100; i++) g.observeFrame(60);
    expect(g.pressure()).toBe('strained');
    for (const tier of ['critical', 'proximity', 'ambiance'] as const) {
      const gate = createTierGate(tier, g);
      expect(gate(1 / 120)).toBeCloseTo(1 / 120);
      expect(gate(1 / 120)).toBeCloseTo(1 / 120);
    }
  });
});
