import { describe, expect, it } from 'vitest';
import { reachabilityStage, reachabilityWindowMs } from '../reachabilityWindow';

describe('reachability window', () => {
  it('gives a dial 20 seconds (24 in a User Cell) before calling it unreachable', () => {
    expect(reachabilityWindowMs('swarm')).toBe(20_000);
    expect(reachabilityWindowMs('builder')).toBe(24_000);
  });
  it('reports negotiating instead of offline during a slow handshake', () => {
    const w = reachabilityWindowMs('swarm');
    expect(reachabilityStage(1_000, w)).toBe('dialing');
    expect(reachabilityStage(8_000, w)).toBe('negotiating');
    expect(reachabilityStage(18_000, w)).toBe('negotiating');
    expect(reachabilityStage(20_000, w)).toBe('expired');
  });
});
