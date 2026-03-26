import { describe, expect, it } from 'vitest';

import { DEFAULT_UQRC_ETHICS_STATE, deriveUqrcEthicsState } from './ethics';

describe('UQRC ethics manifold', () => {
  it('derives bounded ethics scores with complete axiom + ember vectors', () => {
    const state = deriveUqrcEthicsState({
      successRate: 0.9,
      failureRate: 0.08,
      rendezvousRate: 0.86,
      throughputBalance: 0.82,
      activityDensity: 0.74,
      redundancy: 0.66,
      entropy: 0.15,
    });

    expect(state.harmRisk).toBeGreaterThanOrEqual(0);
    expect(state.harmRisk).toBeLessThanOrEqual(1);
    expect(state.confidence).toBeGreaterThan(0.5);
    expect(state.interventionLevel).toBeLessThan(0.5);

    expect(Object.keys(state.axioms)).toHaveLength(15);
    expect(Object.keys(state.embers)).toHaveLength(10);
  });

  it('raises intervention when failures and entropy spike', () => {
    const stressed = deriveUqrcEthicsState({
      successRate: 0.2,
      failureRate: 0.9,
      rendezvousRate: 0.1,
      throughputBalance: 0.22,
      activityDensity: 0.95,
      redundancy: 0.18,
      entropy: 0.92,
    }, DEFAULT_UQRC_ETHICS_STATE);

    expect(stressed.harmRisk).toBeGreaterThan(0.55);
    expect(stressed.interventionLevel).toBeGreaterThan(0.5);
    expect(stressed.confidence).toBeLessThan(0.6);
  });
});
