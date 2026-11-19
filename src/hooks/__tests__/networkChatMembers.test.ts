import { describe, it, expect } from 'vitest';
import { mergeNetworkChatMembers } from '../useNetworkChatPeers';

describe('network chat members', () => {
  it('lists Brain and menu chatters once each, marking who is in the Brain', () => {
    const members = mergeNetworkChatMembers(
      [{ peerId: 'B', username: 'Bee' }],
      [{ peerId: 'E', username: 'Eve' }, { peerId: 'B', username: 'Bee' }],
    );
    expect(members).toEqual([
      { peerId: 'E', username: 'Eve', inBrain: false },
      { peerId: 'B', username: 'Bee', inBrain: true },
    ]);
  });
});
