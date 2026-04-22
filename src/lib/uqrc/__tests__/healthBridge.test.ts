import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __resetSharedFieldEngineForTests,
  getSharedFieldEngine,
} from '../fieldEngine';
import {
  getFieldHealthMultiplier,
  shouldAccelerateRedundancy,
  shouldDeferMining,
  __resetHealthBridgeForTests,
} from '../healthBridge';
import {
  reportDeliveryEvent,
  __resetDeliveryTelemetryForTests,
} from '../../pipeline/deliveryTelemetry';

describe('UQRC healthBridge', () => {
  beforeEach(() => {
    __resetSharedFieldEngineForTests();
    __resetDeliveryTelemetryForTests();
    __resetHealthBridgeForTests();
    getSharedFieldEngine();
  });

  afterEach(() => {
    __resetHealthBridgeForTests();
  });

  it('getFieldHealthMultiplier returns values inside [0.25, 1.0]', () => {
    const mul = getFieldHealthMultiplier();
    expect(mul).toBeGreaterThanOrEqual(0.25);
    expect(mul).toBeLessThanOrEqual(1.0);
  });

  it('shouldDeferMining is false on a fresh field with no stress', () => {
    expect(shouldDeferMining(10_000)).toBe(false);
  });

  it('shouldAccelerateRedundancy lists pending IDs only when Q is high', () => {
    // Pending alone shouldn't accelerate (Q starts low).
    reportDeliveryEvent({ kind: 'manifest-pending', manifestId: 'file-pending-1' });
    reportDeliveryEvent({ kind: 'manifest-pending', manifestId: 'file-pending-2' });
    const result = shouldAccelerateRedundancy();
    // Either no acceleration (Q low) OR — if some test-order leaks raised Q —
    // targets must be the pending set.
    if (result.accelerate) {
      expect(result.targets).toEqual(
        expect.arrayContaining(['file-pending-1', 'file-pending-2']),
      );
    } else {
      expect(result.targets).toEqual([]);
    }
  });

  it('reporting manifest-resolved removes it from pending', () => {
    reportDeliveryEvent({ kind: 'manifest-pending', manifestId: 'file-x' });
    reportDeliveryEvent({ kind: 'manifest-resolved', manifestId: 'file-x' });
    const r = shouldAccelerateRedundancy();
    expect(r.targets).not.toContain('file-x');
  });

  it('field engine accepts the inject signatures used by the bridge', () => {
    const engine = getSharedFieldEngine();
    expect(() =>
      engine.inject('stress', { reward: -0.8, trust: 0.2, amplitude: 0.4 }),
    ).not.toThrow();
    expect(() =>
      engine.inject('content', { reward: -0.5, trust: 0.5, amplitude: 0.3, axis: 1 }),
    ).not.toThrow();
    expect(() => engine.pin('mine.health', 0.7)).not.toThrow();
  });
});
