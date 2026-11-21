import { describe, expect, it } from 'vitest';
import { callHealthReward, MAX_PLAYOUT_TARGET_MS, playoutTargetMs, summarizeCallStats } from '../callQuality';

const report = (over: { jitter?: number; received?: number; lost?: number; delay?: number; emitted?: number; rtt?: number } = {}) => [
  {
    type: 'inbound-rtp', kind: 'audio',
    jitter: over.jitter ?? 0.005,
    packetsReceived: over.received ?? 1000,
    packetsLost: over.lost ?? 0,
    jitterBufferDelay: over.delay ?? 40,
    jitterBufferEmittedCount: over.emitted ?? 1000,
  },
  { type: 'inbound-rtp', kind: 'video', jitter: 0.5, packetsReceived: 10, packetsLost: 9 },
  { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: over.rtt ?? 0.08 },
];

describe('call quality', () => {
  it('reads audio jitter, loss, buffer delay and round trip', () => {
    const { quality } = summarizeCallStats(report({ jitter: 0.02, received: 950, lost: 50, rtt: 0.12 }));
    expect(quality.jitterMs).toBeCloseTo(20);
    expect(quality.lossPct).toBeCloseTo(5);
    expect(quality.bufferDelayMs).toBeCloseTo(40);
    expect(quality.rttMs).toBeCloseTo(120);
  });

  it('measures loss over the last interval, not the whole call', () => {
    const first = summarizeCallStats(report({ received: 1000, lost: 100 }));
    const second = summarizeCallStats(report({ received: 2000, lost: 100 }), first.counters);
    expect(second.quality.lossPct).toBe(0);
  });

  it('leaves a clean call to the browser and cushions a shaky one', () => {
    expect(playoutTargetMs({ jitterMs: 5, lossPct: 0, rttMs: 50, bufferDelayMs: 30 })).toBeNull();
    expect(playoutTargetMs({ jitterMs: 30, lossPct: 0, rttMs: 50, bufferDelayMs: 30 })).toBe(120);
    expect(playoutTargetMs({ jitterMs: 30, lossPct: 6, rttMs: 50, bufferDelayMs: 30 })).toBe(200);
    expect(playoutTargetMs({ jitterMs: 500, lossPct: 20, rttMs: 50, bufferDelayMs: 30 })).toBe(MAX_PLAYOUT_TARGET_MS);
  });

  it('scores rough calls below clean ones for the health bus', () => {
    expect(callHealthReward({ jitterMs: 5, lossPct: 0, rttMs: 60, bufferDelayMs: 20 })).toBeGreaterThan(0);
    expect(callHealthReward({ jitterMs: 50, lossPct: 4, rttMs: 60, bufferDelayMs: 20 })).toBeLessThan(0);
    expect(callHealthReward({ jitterMs: 5, lossPct: 15, rttMs: 60, bufferDelayMs: 20 })).toBe(-0.4);
  });
});
