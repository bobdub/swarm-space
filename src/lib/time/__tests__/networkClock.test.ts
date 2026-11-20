import { afterEach, describe, expect, it } from 'vitest';
import {
  networkNow,
  offsetFromServerDate,
  reconcileLiveTimestamp,
  setNetworkClockOffset,
} from '../networkClock';

const HOUR = 60 * 60 * 1000;

describe('network clock', () => {
  afterEach(() => setNetworkClockOffset(0));

  it('detects a device clock that runs an hour behind', () => {
    const trueNow = Date.UTC(2026, 10, 20, 5, 0, 0);
    const deviceNow = trueNow - HOUR; // e.g. a New York laptop still an hour out after DST
    const header = new Date(trueNow).toUTCString();
    const offset = offsetFromServerDate(header, deviceNow, deviceNow + 100);
    expect(Math.abs(offset - HOUR)).toBeLessThan(1_000);
  });

  it('ignores small differences and broken headers', () => {
    const now = Date.UTC(2026, 10, 20, 5, 0, 0);
    expect(offsetFromServerDate(new Date(now + 3_000).toUTCString(), now, now + 50)).toBe(0);
    expect(offsetFromServerDate(null, now, now)).toBe(0);
    expect(offsetFromServerDate('not a date', now, now)).toBe(0);
  });

  it('stamps with the corrected time', () => {
    setNetworkClockOffset(HOUR);
    expect(Math.abs(networkNow() - (Date.now() + HOUR))).toBeLessThan(50);
  });

  it('places a live line from a skewed sender at its arrival time', () => {
    const now = Date.UTC(2026, 10, 20, 5, 0, 0);
    expect(reconcileLiveTimestamp(now - HOUR, now)).toBe(now);
    expect(reconcileLiveTimestamp(now - 5_000, now)).toBe(now - 5_000);
  });
});
