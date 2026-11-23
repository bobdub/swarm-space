import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MANUAL_MAX_ATTEMPTS,
  MANUAL_REDIAL_INTERVAL_MS,
  MANUAL_SYNC_GRACE_MS,
  cancelManualConnect,
  getManualConnects,
  matchesManualTarget,
  requestManualConnect,
  resetManualConnects,
  tickManualConnects,
  type ManualConnectEnv,
} from '../manualConnect';

const env = (overrides: Partial<ManualConnectEnv> = {}): ManualConnectEnv => ({
  isEnabled: true,
  isConnecting: false,
  enable: vi.fn(),
  selfId: 'peer-self',
  isBlocked: () => false,
  dial: vi.fn(() => true),
  isConnected: () => false,
  isNamed: () => false,
  ...overrides,
});

const phase = (id = 'peer-host') => getManualConnects().get(id)?.phase;

describe('manual connect coordinator', () => {
  beforeEach(() => resetManualConnects());

  it('normalizes ids and ignores empty input', () => {
    expect(requestManualConnect('  host ', { now: 0 })).toBe('peer-host');
    expect(requestManualConnect('   ')).toBeNull();
    expect(phase()).toBe('starting');
  });

  it('re-knocks every 20 s for up to 8 tries, then reports unavailable', () => {
    const e = env();
    requestManualConnect('peer-host', { now: 0 });
    for (let t = 0; t <= MANUAL_REDIAL_INTERVAL_MS * MANUAL_MAX_ATTEMPTS; t += 1000) {
      tickManualConnects({ ...e, now: t });
    }
    expect(e.dial).toHaveBeenCalledTimes(MANUAL_MAX_ATTEMPTS);
    expect(phase()).toBe('unavailable');
  });

  it('never gives up before the last knock has had its full window', () => {
    const e = env();
    requestManualConnect('peer-host', { now: 0 });
    for (let t = 0; t < MANUAL_REDIAL_INTERVAL_MS * MANUAL_MAX_ATTEMPTS; t += 1000) {
      tickManualConnects({ ...e, now: t });
      expect(phase()).toBe('connecting');
    }
  });

  it('moves through syncing to connected once the channel opens', () => {
    let open = false;
    let named = false;
    const e = env({ isConnected: () => open, isNamed: () => named });
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    expect(phase()).toBe('connecting');
    open = true;
    tickManualConnects({ ...e, now: 45_000 });
    expect(phase()).toBe('syncing');
    named = true;
    tickManualConnects({ ...e, now: 46_000 });
    expect(phase()).toBe('connected');
  });

  it('counts an unnamed open channel as connected after the sync grace', () => {
    const e = env({ isConnected: () => true });
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    expect(phase()).toBe('syncing');
    tickManualConnects({ ...e, now: MANUAL_SYNC_GRACE_MS });
    expect(phase()).toBe('connected');
    expect(e.dial).not.toHaveBeenCalled();
  });

  it('enables networking once and holds the dial until it is on', () => {
    const e = env({ isEnabled: false });
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    tickManualConnects({ ...e, isConnecting: true, now: 1000 });
    expect(e.enable).toHaveBeenCalledTimes(1);
    expect(e.dial).not.toHaveBeenCalled();
    expect(phase()).toBe('starting');
    tickManualConnects({ ...e, isEnabled: true, now: 2000 });
    expect(e.dial).toHaveBeenCalledWith('peer-host');
    expect(phase()).toBe('connecting');
  });

  it('stops when the user turns networking back off', () => {
    const e = env({ isEnabled: false });
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    tickManualConnects({ ...e, now: 10_000 });
    expect(getManualConnects().has('peer-host')).toBe(false);
    expect(e.enable).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused dial buffered instead of failing it', () => {
    let accept = false;
    const dial = vi.fn(() => accept);
    const e = env({ dial });
    requestManualConnect('peer-host', { now: 0 });
    for (let t = 0; t < 30_000; t += 1000) tickManualConnects({ ...e, now: t });
    expect(phase()).toBe('starting');
    accept = true;
    tickManualConnects({ ...e, now: 30_000 });
    expect(phase()).toBe('connecting');
    expect(getManualConnects().get('peer-host')?.attempts).toBe(1);
  });

  it('uses a per-request dial override and never dials self or blocked peers', () => {
    const override = vi.fn(() => true);
    const e = env({ isBlocked: id => id === 'peer-blocked' });
    requestManualConnect('peer-host', { now: 0, dial: override });
    requestManualConnect('peer-self', { now: 0 });
    requestManualConnect('peer-blocked', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    expect(override).toHaveBeenCalledWith('peer-host');
    expect(e.dial).not.toHaveBeenCalled();
    expect(phase('peer-self')).toBe('unavailable');
    expect(phase('peer-blocked')).toBe('unavailable');
  });

  it('does not restart a connect already in flight, and can be cancelled', () => {
    const e = env();
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...e, now: 0 });
    requestManualConnect('peer-host', { now: 5000 });
    expect(getManualConnects().get('peer-host')?.attempts).toBe(1);
    cancelManualConnect('peer-host');
    expect(getManualConnects().size).toBe(0);
  });

  it('matches a typed Node ID against the live Peer ID', () => {
    expect(matchesManualTarget('peer-0123456789abcdef', 'peer-0123456789ab-171-x')).toBe(true);
    expect(matchesManualTarget('peer-0123456789abcdef', 'peer-ffffffffffff-171-x')).toBe(false);
    expect(matchesManualTarget('peer-a', 'peer-a')).toBe(true);
  });
});
