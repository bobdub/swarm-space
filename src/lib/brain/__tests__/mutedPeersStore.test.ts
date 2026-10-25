import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isPeerMuted,
  listMutedPeers,
  mutePeer,
  subscribeMutedPeers,
  unmutePeer,
} from '@/lib/brain/mutedPeersStore';

function clearAll() {
  for (const e of listMutedPeers()) {
    if (e.peerId) unmutePeer(e.peerId);
    if (e.userId) unmutePeer(e.userId);
  }
  window.localStorage.clear();
}

describe('mutedPeersStore', () => {
  afterEach(clearAll);

  it('matches a muted peer by peerId and by userId', () => {
    mutePeer({ peerId: 'peer-abc', userId: 'user-123', username: 'Ada' });
    expect(isPeerMuted('peer-abc')).toBe(true);
    expect(isPeerMuted('user-123')).toBe(true);
    expect(isPeerMuted('peer-other')).toBe(false);
    expect(isPeerMuted(undefined)).toBe(false);
    expect(isPeerMuted(null)).toBe(false);
  });

  it('unmutes by either id and removes the whole entry', () => {
    mutePeer({ peerId: 'peer-abc', userId: 'user-123', username: 'Ada' });
    unmutePeer('user-123');
    expect(isPeerMuted('peer-abc')).toBe(false);
    expect(listMutedPeers()).toHaveLength(0);
  });

  it('ignores a mute with no identity at all', () => {
    mutePeer({ username: 'Nobody' });
    expect(listMutedPeers()).toHaveLength(0);
  });

  it('re-muting the same identity replaces instead of duplicating', () => {
    mutePeer({ peerId: 'peer-abc', username: 'Ada' });
    mutePeer({ peerId: 'peer-abc', userId: 'user-123', username: 'Ada' });
    expect(listMutedPeers()).toHaveLength(1);
    expect(isPeerMuted('user-123')).toBe(true);
  });

  it('notifies subscribers on mute and unmute', () => {
    const fn = vi.fn();
    const unsub = subscribeMutedPeers(fn);
    mutePeer({ peerId: 'peer-abc', username: 'Ada' });
    unmutePeer('peer-abc');
    unsub();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('persists across a reload (fresh module read from localStorage)', async () => {
    mutePeer({ peerId: 'peer-abc', userId: 'user-123', username: 'Ada' });
    vi.resetModules();
    const fresh = await import('@/lib/brain/mutedPeersStore');
    expect(fresh.isPeerMuted('peer-abc')).toBe(true);
    expect(fresh.isPeerMuted('user-123')).toBe(true);
    fresh.unmutePeer('peer-abc');
  });
});
