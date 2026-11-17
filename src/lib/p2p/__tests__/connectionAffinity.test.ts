import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('local connection affinity', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  it('unions duplicate channels, checkpoints and does not count offline time', async () => {
    const m = await import('../connectionAffinity');
    m.observeConnections('owner', [{ userId: 'friend', peerId: 'peer-a', connectedAt: 1_000 }], 1_000);
    m.observeConnections('owner', [{ userId: 'friend', peerId: 'peer-a', connectedAt: 1_000 }, { userId: 'friend', peerId: 'peer-b', connectedAt: 2_000 }], 2_000);
    expect(m.getConnectionAffinity('owner', 'friend', 11_000)).toMatchObject({ connectedDurationMs: 10_000, sessions: 1 });
    m.observeConnections('owner', [], 11_000);
    expect(m.getConnectionAffinity('owner', 'friend', 99_000).connectedDurationMs).toBe(10_000);
    vi.resetModules();
    const restored = await import('../connectionAffinity');
    expect(restored.getConnectionAffinity('owner', 'friend', 100_000).connectedDurationMs).toBe(10_000);
    restored.observeConnections('owner', [{ userId: 'friend', peerId: 'peer-rotated', connectedAt: 100_000 }], 100_000);
    expect(restored.getConnectionAffinity('owner', 'friend', 101_000)).toMatchObject({ connectedDurationMs: 11_000, sessions: 2 });
    expect(restored.getConnectionAffinity('other-owner', 'friend').connectedDurationMs).toBe(0);
  });
  it('never turns a guest peer coordinate into a canonical account', async () => {
    const m = await import('../connectionAffinity');
    m.observeConnections('owner', [{ peerId: 'peer-guest', connectedAt: 0 }], 1_000);
    expect(m.getConnectionAffinity('owner', 'peer-guest', 9_000).sessions).toBe(0);
  });
});
describe('stored connection history validation', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  it('sanitizes corrupt stored counters and keeps "__proto__" a plain key', async () => {
    localStorage.setItem('swarm-connection-affinity:owner', JSON.stringify({
      bad: { connectedDurationMs: 'lots', sessions: -3, lastInteractionAt: null },
      __proto__: { connectedDurationMs: 5 },
    }));
    const m = await import('../connectionAffinity');
    expect(m.getConnectionAffinity('owner', 'bad', 1)).toEqual({ connectedDurationMs: 0, sessions: 0, lastInteractionAt: 0 });
    m.observeConnections('owner', [{ userId: '__proto__', peerId: 'p', connectedAt: NaN }], 1_000);
    const h = m.getConnectionAffinity('owner', '__proto__', 4_000);
    expect(h.connectedDurationMs).toBe(3_000);
    expect(({} as Record<string, unknown>).connectedDurationMs).toBeUndefined();
  });
});
