import { describe, it, expect, vi, beforeEach } from 'vitest';

const inject = vi.fn();
vi.mock('@/config/featureFlags', () => ({ getFeatureFlags: () => ({ scaffoldBus: true }) }));
vi.mock('@/lib/uqrc/fieldEngine', () => ({ getSharedFieldEngine: () => ({ inject }) }));

import { emitScaffold, batchScaffoldInjects, subscribeScaffold, __resetScaffoldBusForTests } from '../scaffoldBus';

const decision = (npcId: string) => ({ domain: 'npc', type: 'decision', npcId, verb: 'rest', qDelta: 0 }) as const;

describe('scaffold bus field-injection batching', () => {
  beforeEach(() => { inject.mockClear(); __resetScaffoldBusForTests(); });

  it('injects immediately outside a batch', () => {
    emitScaffold(decision('a'));
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('defers field nudges to the end of the batch but still fires listeners synchronously', () => {
    const heard: string[] = [];
    subscribeScaffold('npc', (e) => { heard.push((e as { npcId: string }).npcId); });
    batchScaffoldInjects(() => {
      emitScaffold(decision('a'));
      emitScaffold(decision('b'));
      expect(inject).not.toHaveBeenCalled();
      expect(heard).toEqual(['a', 'b']);
    });
    expect(inject.mock.calls.map((c) => c[0])).toEqual(['npc:a:rest', 'npc:b:rest']);
  });

  it('flushes only when the outermost batch ends, even if the pass throws', () => {
    expect(() => batchScaffoldInjects(() => {
      batchScaffoldInjects(() => emitScaffold(decision('a')));
      expect(inject).not.toHaveBeenCalled();
      throw new Error('boom');
    })).toThrow('boom');
    expect(inject).toHaveBeenCalledTimes(1);
    emitScaffold(decision('b'));
    expect(inject).toHaveBeenCalledTimes(2);
  });
});
