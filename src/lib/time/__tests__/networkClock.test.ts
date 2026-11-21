import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_SAMPLE_RTT_MS,
  MIN_CORRECTION_MS,
  STEP_THRESHOLD_MS,
  meshClockOffset,
  networkClockOffset,
  networkNow,
  offsetFromPeerReply,
  recordPeerClockSample,
  targetClockOffset,
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

describe('cadence clock (mesh agreement)', () => {
  afterEach(() => setNetworkClockOffset(0));

  it('corrects a peer reading for half the round trip', () => {
    // Peer says 10_000 when we sent at 0; the reply arrived at 200 local.
    expect(offsetFromPeerReply(0, 10_000, 200)).toBe(10_000 + 100 - 200);
  });

  it('drops slow round trips', () => {
    expect(offsetFromPeerReply(0, 5_000, MAX_SAMPLE_RTT_MS + 1)).toBeNull();
    expect(offsetFromPeerReply(100, 5_000, 50)).toBeNull();
  });

  it('takes the median across peers, so one wrong peer cannot drag the clock', () => {
    const t = Date.now();
    recordPeerClockSample('a', t - 40, t + 19_980, t); // +20 s
    recordPeerClockSample('b', t - 40, t + 20_980, t); // +21 s
    recordPeerClockSample('c', t - 40, t + HOUR, t); // wildly off
    expect(meshClockOffset(t)).toBe(21_000);
  });

  it('keeps the mesh within the server window once the server has answered', () => {
    setNetworkClockOffset(0, { originSynced: true });
    const t = Date.now();
    recordPeerClockSample('a', t - 40, t + HOUR, t);
    expect(targetClockOffset(t)).toBe(MIN_CORRECTION_MS);
  });

  it('trusts the mesh fully when the server was never reached', () => {
    const t = Date.now();
    recordPeerClockSample('a', t - 40, t + HOUR - 20, t);
    expect(targetClockOffset(t)).toBe(HOUR);
    // A large correction applies at once.
    expect(Math.abs(networkNow() - (Date.now() + HOUR))).toBeLessThan(50);
  });

  it('eases small corrections in and never steps backwards', () => {
    const first = networkNow();
    const t = Date.now();
    recordPeerClockSample('a', t - 40, t - 3_000 - 20, t); // 3 s behind: below the step threshold
    let prev = first;
    for (let i = 0; i < 50; i++) {
      const next = networkNow();
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
    expect(networkClockOffset()).toBeGreaterThan(-STEP_THRESHOLD_MS);
  });
});
