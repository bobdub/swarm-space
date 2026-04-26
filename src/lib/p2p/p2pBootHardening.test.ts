import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getCanonicalHome, isHomelessRedirect, resolvePostAuthTarget } from '@/lib/routing/canonicalHome';
import {
  loadConnectionState,
  subscribeToConnectionState,
  updateConnectionState,
} from '@/lib/p2p/connectionState';

const STORAGE_KEY = 'p2p-connection-state';

describe('boot hardening regressions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('treats /index as homeless so logged-in users resolve to /brain', () => {
    const user = { id: 'u1', username: 'otto', publicKey: 'pk', wrappedKeyRef: 'wk', createdAt: new Date().toISOString() };
    expect(isHomelessRedirect('/index')).toBe(true);
    expect(resolvePostAuthTarget(user, '/index')).toBe('/brain');
    expect(getCanonicalHome(user)).toBe('/brain');
  });

  it('broadcasts connection-state updates after auth restore flips enabled=true', () => {
    const observed: Array<{ enabled: boolean; mode: string }> = [];
    const unsubscribe = subscribeToConnectionState((state) => {
      observed.push({ enabled: state.enabled, mode: state.mode });
    });

    updateConnectionState({ enabled: true, mode: 'swarm' });
    unsubscribe();

    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(observed.at(-1)).toEqual({ enabled: true, mode: 'swarm' });
    expect(loadConnectionState().enabled).toBe(true);
  });

  it('stores a single unified startup preference snapshot', () => {
    updateConnectionState({ enabled: true, mode: 'builder', lastConnectedAt: 123 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toEqual({
      enabled: true,
      mode: 'builder',
      lastConnectedAt: 123,
    });
  });
});
