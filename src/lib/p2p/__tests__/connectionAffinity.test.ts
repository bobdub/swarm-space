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