import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flags = { scaffoldBus: true, deferredFieldInjects: true };
vi.mock('@/config/featureFlags', () => ({ getFeatureFlags: () => flags }));

import {
  queueFieldInject,
  flushFieldInjects,
  getFieldInjectQueueStats,
  FLUSH_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  __resetFieldInjectQueueForTests,
} from '../fieldInjectQueue';
import {
  FieldEngine,
  getSharedFieldEngine,
  __resetSharedFieldEngineForTests,
} from '../fieldEngine';
import { emitScaffold, __resetScaffoldBusForTests } from '../scaffoldBus';

describe('deferred field-inject queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    flags.deferredFieldInjects = true;
    __resetFieldInjectQueueForTests();
    __resetScaffoldBusForTests();
    __resetSharedFieldEngineForTests();
  });
  afterEach(() => {
    __resetFieldInjectQueueForTests();
    vi.useRealTimers();
  });

  it('keeps the field caches warm while events stream in, then applies them in one batch', () => {
    const fe = getSharedFieldEngine();
    const injectSpy = vi.spyOn(fe, 'inject');
    const batchSpy = vi.spyOn(fe, 'injectBatch');
    const q0 = fe.getQScore();
    const map0 = fe.getCurvatureMap();

    // A peer walking around: presence + relays + pings, many per second.
    for (let i = 0; i < 50; i++) {
      queueFieldInject('peer-walker', { reward: 0.5, trust: 40 });
      emitScaffold({ domain: 'npc', type: 'decision', npcId: 'n1', verb: 'rest', qDelta: 0 });
    }

    expect(injectSpy).not.toHaveBeenCalled();
    // Same cached array instance — nothing dropped the caches.
    expect(fe.getCurvatureMap()).toBe(map0);
    expect(fe.getQScore()).toBe(q0);

    vi.advanceTimersByTime(FLUSH_INTERVAL_MS + IDLE_TIMEOUT_MS);

    expect(batchSpy).toHaveBeenCalledTimes(1);
    const stats = getFieldInjectQueueStats();
    expect(stats.received).toBe(100);
    expect(stats.flushes).toBe(1);
    // peer-walker on axis 0 + reward axis 2, npc decision on axis 1.
    expect(stats.applied).toBe(3);
    expect(stats.pending).toBe(0);
  });

  it('lands the same lattice change as the per-event path (linear sum)', () => {
    const direct = new FieldEngine();
    const events = [
      { text: 'p2p:peer-a', opts: { reward: 0.5 } },
      { text: 'p2p:peer-a', opts: { reward: 0.5 } },
      { text: 'npc:x:rest', opts: { amplitude: 0.1, axis: 1 } },
      { text: 'coin:c', opts: { amplitude: 0.08, axis: 2, reward: 0.3 } },
    ];
    for (const e of events) direct.inject(e.text, e.opts);

    const shared = getSharedFieldEngine();
    for (const e of events) queueFieldInject(e.text, e.opts);
    flushFieldInjects();

    const a = direct.cloneSnapshot();
    const b = shared.cloneSnapshot();
    for (let axis = 0; axis < a.axes.length; axis++) {
      for (let i = 0; i < a.axes[axis].length; i++) {
        expect(b.axes[axis][i]).toBeCloseTo(a.axes[axis][i], 6);
      }
    }
  });

  it('falls back to a synchronous inject per event when the flag is off', () => {
    flags.deferredFieldInjects = false;
    const fe = getSharedFieldEngine();
    const injectSpy = vi.spyOn(fe, 'inject');
    queueFieldInject('p2p:peer-b', { reward: 0.2 });
    queueFieldInject('p2p:peer-b', { reward: 0.2 });
    expect(injectSpy).toHaveBeenCalledTimes(2);
    expect(getFieldInjectQueueStats().direct).toBe(2);
    expect(getFieldInjectQueueStats().pending).toBe(0);
  });
});
