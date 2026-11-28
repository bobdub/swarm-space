import { describe, expect, it, vi } from 'vitest';
vi.mock('../swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => ({ getStats: () => ({ phase: 'offline' }), getPeerId: () => 'peer-self' }) }));
import { GunAdapter } from '../transports/gunAdapter';
import { getGlobalCell, inviteKnockSlot } from '../globalCell';

function fakeGun() {
  const writes: Array<{ slot: string; data: { type: string } }> = [];
  const souls = new Map<string, { type: string }>();
  // Envelopes go to their own soul (`<graphKey>/<slot>`), then that node is
  // linked into the slot so map().on() subscribers see it.
  const gun = {
    get: (key: string) => ({
      put: (data: { type: string }) => { souls.set(key, data); return { soul: key }; },
      get: (slot: string) => ({ put: (ref: { soul: string }) => writes.push({ slot, data: souls.get(ref.soul)! }) }),
    }),
  };
  return { gun, writes };
}

describe('invite knock registry slots', () => {
  it('writes a knock to its own slot so a later presence beacon cannot overwrite it', () => {
    const adapter = new GunAdapter({ registryMode: true, graphKey: 'test' });
    const { gun, writes } = fakeGun();
    Object.assign(adapter as object, { gun, localPeerId: 'peer-self' });
    adapter.broadcastToAll('invite-knock', { to: 'peer-a' }, { slot: inviteKnockSlot('peer-self', 'peer-a') });
    adapter.broadcastToAll('presence', {});
    expect(writes.map(w => [w.slot, w.data.type])).toEqual([
      ['peer-self~knock~peer-a', 'invite-knock'],
      ['peer-self', 'presence'],
    ]);
  });

  it('holds knocks sent before Gun is ready and flushes each into its own slot', () => {
    const cell = getGlobalCell() as unknown as {
      sendInviteKnock: (target: string) => boolean;
      flushPendingKnocks: () => void;
      gunAdapter: { broadcastToAll: ReturnType<typeof vi.fn> } | null;
    };
    cell.gunAdapter = null;
    expect(cell.sendInviteKnock('peer-a')).toBe(false);
    expect(cell.sendInviteKnock('peer-b')).toBe(false);
    const broadcastToAll = vi.fn(() => true);
    cell.gunAdapter = { broadcastToAll };
    cell.flushPendingKnocks();
    expect(broadcastToAll.mock.calls.map(c => (c[2] as { slot: string }).slot)).toEqual([
      'peer-self~knock~peer-a',
      'peer-self~knock~peer-b',
    ]);
  });
});
