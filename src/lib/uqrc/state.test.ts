import { describe, expect, it } from 'vitest';

import { buildUqrcStateSnapshot, serializeUqrcStateSnapshot } from './state';

describe('UQRC state snapshot', () => {
  it('computes a bounded health score and serializes output', () => {
    const snapshot = buildUqrcStateSnapshot({
      timestamp: 100,
      cortex: { noveltyScore: 0.8, semanticDensity: 0.7, interactionVelocity: 0.6, reflectionDepth: 0.5, rollingEntropy: 0.2 },
      limbic: { rewardFlux: 0.9, influenceWeight: 0.8, energyBudget: 0.7, burnPressure: 0.2 },
      brainstem: { peerLiveness: 0.8, heartbeatIntervalMs: 0.2, messageRedundancy: 0.7, survivalConfidence: 0.9 },
      memory: { chunkRedundancy: 0.8, manifestIntegrity: 0.7, recallLatencyMs: 0.2, reconstructionSuccess: 0.9 },
      heartbeat: { hashRateEffective: 0.7, qScoreTotal: 0.2, propagationCurvature: 0.1, timestampCurvature: 0.1 },
      ethics: { harmRisk: 0.1, confidence: 0.9, interventionLevel: 0.1 },
    });

    expect(snapshot.healthScore).toBeGreaterThan(0);
    expect(snapshot.healthScore).toBeLessThanOrEqual(100);

    const serialized = serializeUqrcStateSnapshot(snapshot);
    expect(JSON.parse(serialized).healthScore).toBe(snapshot.healthScore);
  });
});
