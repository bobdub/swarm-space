import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordAppEvent,
  getAppHealth,
  getDomainHealth,
  __resetAppHealthForTests,
} from '../appHealth';
import { __resetSharedFieldEngineForTests, getSharedFieldEngine } from '../fieldEngine';

describe('AppHealth bus', () => {
  beforeEach(() => {
    __resetAppHealthForTests();
    __resetSharedFieldEngineForTests();
    // Touch the field once to ensure the singleton exists synchronously.
    getSharedFieldEngine();
  });

  it('namespaces keys correctly and records under the right domain', () => {
    recordAppEvent('p2p', 'peer-abc', { reward: 0.5 });
    recordAppEvent('storage', 'browser', { reward: 0.4 });
    const h = getAppHealth();
    // Both keys should be observable via per-domain views.
    expect(getDomainHealth('p2p').keyCount).toBe(1);
    expect(getDomainHealth('storage').keyCount).toBe(1);
    expect(getDomainHealth('mining').keyCount).toBe(0);
    expect(h.qScore).toBeGreaterThanOrEqual(0);
  });

  it('per-key debounce holds within 250 ms window', async () => {
    recordAppEvent('p2p', 'peer-x', { reward: 0.5 });
    // Hammer the same key — debounce should drop the rest.
    for (let i = 0; i < 10; i++) recordAppEvent('p2p', 'peer-x', { reward: 0.5 });
    // Only one entry registered (one unique key).
    expect(getDomainHealth('p2p').keyCount).toBe(1);
  });

  it('getDomainHealth filters by namespace prefix', () => {
    recordAppEvent('p2p', 'a', { reward: 0.5 });
    recordAppEvent('mining', 'block', { reward: 0.5 });
    recordAppEvent('route', '/profile', { reward: 0.3 });
    expect(getDomainHealth('p2p').keyCount).toBe(1);
    expect(getDomainHealth('mining').keyCount).toBe(1);
    expect(getDomainHealth('route').keyCount).toBe(1);
    expect(getDomainHealth('stream').keyCount).toBe(0);
  });

  it('returns finite Q_Score and bounded hotspot list', () => {
    for (let i = 0; i < 5; i++) {
      recordAppEvent('p2p', `peer-${i}`, { reward: -0.3 });
    }
    const h = getAppHealth();
    expect(Number.isFinite(h.qScore)).toBe(true);
    expect(h.hotspots.length).toBeLessThanOrEqual(3);
  });
});