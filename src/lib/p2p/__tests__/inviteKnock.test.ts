import { describe, it, expect, vi } from 'vitest';
vi.mock('../swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => ({ getStats: () => ({ phase: 'offline' }) }) }));
import { acceptInviteKnock } from '../globalCell';

const base = { id: 'k1', from: 'peer-a', to: 'peer-b', at: 1_000_000 };
describe('invite knock', () => {
  it('accepts a fresh knock addressed to us once', () => {
    const seen = new Map<string, number>();
    expect(acceptInviteKnock(base, 'peer-b', seen, 1_000_500)).toBe(true);
    expect(acceptInviteKnock(base, 'peer-b', seen, 1_000_600)).toBe(false);
  });
  it('drops knocks older than 30 seconds', () => {
    expect(acceptInviteKnock(base, 'peer-b', new Map(), 1_030_001)).toBe(false);
  });
  it('ignores knocks for other peers or from ourselves', () => {
    expect(acceptInviteKnock(base, 'peer-c', new Map(), 1_000_100)).toBe(false);
    expect(acceptInviteKnock({ ...base, from: 'peer-b' }, 'peer-b', new Map(), 1_000_100)).toBe(false);
  });
});
