import { describe, expect, it } from 'vitest';
import { PEER_QUIET_LIVE_LINK_MAX_MS, shouldEvictQuietPeer } from '../swarmMesh.standalone';

describe('quiet mesh peer eviction', () => {
  it('keeps a throttled background tab whose link is still open', () => {
    expect(shouldEvictQuietPeer(70_000, 60_000, true)).toBe(false);
    expect(shouldEvictQuietPeer(4 * 60_000, 60_000, true)).toBe(false);
  });
  it('evicts a quiet peer whose link is not open', () => {
    expect(shouldEvictQuietPeer(70_000, 60_000, false)).toBe(true);
  });
  it('never evicts within the threshold, and gives up on a live link eventually', () => {
    expect(shouldEvictQuietPeer(30_000, 60_000, false)).toBe(false);
    expect(shouldEvictQuietPeer(PEER_QUIET_LIVE_LINK_MAX_MS + 1, 60_000, true)).toBe(true);
  });
});
