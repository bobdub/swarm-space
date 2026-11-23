import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatAt, msUntilNextBeat, startBeatLoop } from '../sharedBeat';
import { setNetworkClockOffset } from '../networkClock';

describe('shared beat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setNetworkClockOffset(0);
  });

  it('numbers beats from the shared clock, so two devices agree', () => {
    const shared = Date.UTC(2026, 10, 23, 3, 0, 0) + 610;
    expect(beatAt(250, shared)).toBe(Math.floor(shared / 250));
    expect(msUntilNextBeat(250, shared)).toBe(140);
    expect(msUntilNextBeat(250, shared - 610)).toBe(250);
  });

  it('wakes on the beat boundary, not where the loop started', () => {
    vi.setSystemTime(Date.UTC(2026, 10, 23, 3, 0, 0) + 100);
    const seen: number[] = [];
    const loop = startBeatLoop(250, () => { seen.push(Date.now() % 250); });
    vi.advanceTimersByTime(1000);
    loop.stop();
    expect(seen.length).toBe(4);
    for (const phase of seen) expect(phase).toBeLessThan(5);
  });

  it('reports skipped beats after a stall and stops cleanly', () => {
    vi.setSystemTime(Date.UTC(2026, 10, 23, 3, 0, 0));
    const elapsed: number[] = [];
    const loop = startBeatLoop(250, (_b, e) => { elapsed.push(e); });
    vi.advanceTimersByTime(260);
    // Simulate a throttled tab: the clock jumps a second with no timer firing.
    vi.setSystemTime(Date.now() + 1000);
    vi.advanceTimersByTime(250);
    loop.stop();
    vi.advanceTimersByTime(2000);
    expect(elapsed[0]).toBe(1);
    expect(elapsed[1]).toBeGreaterThanOrEqual(4);
    expect(elapsed.length).toBe(2);
  });
});
