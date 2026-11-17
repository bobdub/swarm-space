import { beforeEach, describe, expect, it, vi } from 'vitest';
const mesh = vi.hoisted(() => ({ getLibrary: vi.fn(), getConnectedPeers: vi.fn(() => []) }));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => mesh }));
vi.mock('@/lib/store', () => ({ getAll: vi.fn(async () => []) }));
import { bindMentions, mentionNotificationRecipients, mentionRecipient, resolveUsernameToId, validMentionBindings } from './mentions';

describe('untrusted mention bindings from peers', () => {
  beforeEach(() => { localStorage.clear(); mesh.getLibrary.mockReturnValue([]); });

  it('drops malformed shapes instead of crashing the reader', () => {
    const text = 'hi @Mike';
    for (const junk of [null, 'x', 42, { 0: 1 }, [null, 'a', 7]]) {
      expect(validMentionBindings(text, junk)).toEqual([]);
      expect(mentionRecipient(text, 3, 'Mike', junk, new Map([['mike', 'legacy']]))).toBeUndefined();
      expect(mentionNotificationRecipients(junk, 'author')).toEqual([]);
    }
  });

  it('accepts only a binding that covers exactly one @handle token', () => {
    const text = 'hi @Mike and @Mikey';
    const ok = { userId: 'a', username: 'Mike', startIndex: 3, endIndex: 8 };
    expect(validMentionBindings(text, [
      ok,
      { ...ok, userId: 'second-claim' },                    // same token claimed twice
      { ...ok, startIndex: '3', endIndex: '8' },            // string indices
      { ...ok, startIndex: 3.5, endIndex: 8.5 },            // non-integer
      { ...ok, endIndex: 9 },                               // range wider than token
      { userId: 'b', username: 'Mike', startIndex: 13, endIndex: 18 }, // prefix of @Mikey
      { userId: '', username: 'Mikey', startIndex: 13, endIndex: 19 }, // no identity
      { userId: 'c', username: 'Mi ke', startIndex: 3, endIndex: 9 },  // not a handle
    ]).map(m => m.userId)).toEqual(['a']);
  });

  it('keeps a well-formed discriminator and drops a malformed one', () => {
    const base = { userId: 'a', username: 'Mike', startIndex: 0, endIndex: 5 };
    expect(validMentionBindings('@Mike', [{ ...base, discriminator: 'abcd1234' }])[0].discriminator).toBe('abcd1234');
    expect(validMentionBindings('@Mike', [{ ...base, discriminator: '<script>' }])[0]).not.toHaveProperty('discriminator');
  });

  it('finds the exact handle even when more than six peers share its prefix', async () => {
    localStorage.setItem('me', JSON.stringify({ id: 'owner' }));
    const crowd = Array.from({ length: 8 }, (_, i) => ({ peerId: `p${i}`, nodeId: `n${i}`, userId: `u${i}`, username: `Mike${i}`, lastSeen: Date.now() }));
    mesh.getLibrary.mockReturnValue([...crowd, { peerId: 'px', nodeId: 'nx', userId: 'exact', username: 'Mike' }]);
    expect((await resolveUsernameToId('Mike'))?.userId).toBe('exact');
    expect((await bindMentions('yo @Mike'))[0]?.userId).toBe('exact');
  });
});
