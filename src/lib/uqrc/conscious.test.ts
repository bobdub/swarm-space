import { describe, expect, it } from 'vitest';

import {
  computeUqrcConsciousHealth,
  deriveUqrcConsciousState,
  type UqrcConsciousTelemetry,
} from './conscious';

describe('UQRC conscious node', () => {
  const telemetry: UqrcConsciousTelemetry = {
    sessionActive: true,
    uptimeMs: 1000 * 60 * 45,
    connectionAttempts: 120,
    successfulConnections: 95,
    failedConnectionAttempts: 25,
    rendezvousAttempts: 80,
    rendezvousSuccesses: 60,
    relayCount: 140,
    pingCount: 200,
    bytesUploaded: 16_000,
    bytesDownloaded: 12_000,
    accountId: 'acct-1',
  };

  it('derives deterministic conscious state from telemetry', () => {
    const first = deriveUqrcConsciousState(telemetry);
    const second = deriveUqrcConsciousState(telemetry);

    expect(first).toEqual(second);
    expect(first.subconscious.sessionContinuity).toBeGreaterThan(0);
    expect(first.subconscious.overloadRisk).toBeGreaterThanOrEqual(0);
    expect(first.subconscious.overloadRisk).toBeLessThanOrEqual(1);
  });

  it('computes bounded conscious health score', () => {
    const state = deriveUqrcConsciousState(telemetry);
    const health = computeUqrcConsciousHealth(state);

    expect(health).toBeGreaterThanOrEqual(0);
    expect(health).toBeLessThanOrEqual(1);
  });
});
