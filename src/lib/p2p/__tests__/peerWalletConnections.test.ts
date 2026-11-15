import { expect, test } from 'vitest';
import { peerWalletConnections } from '../peerWalletConnections';

test('maps live peers to canonical wallet identities and excludes offline library contacts', () => {
  const connections = peerWalletConnections(
    [{ peerId: 'peer-c', lastActivity: 99_000, connectedAt: 90_000, avgRttMs: 42 }],
    [{ peerId: 'peer-c', userId: 'member-c', displayName: 'C', avatarRef: 'avatar-c' },
      { peerId: 'offline', userId: 'offline-member' }], 100_000,
  );
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ userId: 'member-c', profile: { displayName: 'C', avatarRef: 'avatar-c' }, status: 'healthy' });
});

test('unknown and guest connections remain ineligible for wallet picks', () => {
  expect(peerWalletConnections([{ peerId: 'guest', lastActivity: 0, connectedAt: 0, avgRttMs: null }],
    [{ peerId: 'guest', displayName: 'Guest' }], 1)[0].userId).toBeNull();
});