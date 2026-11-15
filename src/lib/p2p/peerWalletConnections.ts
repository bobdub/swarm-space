import type { PeerConnectionDetail } from './manager';

/** Only live connections become wallet picks; the library supplies identity, not liveness. */
export function peerWalletConnections(
  peers: Array<{ peerId: string; lastActivity: number; connectedAt: number; avgRttMs: number | null }>,
  library: Array<{ peerId: string; userId?: string; displayName?: string; username?: string; avatarRef?: string }>,
  now = Date.now(),
): PeerConnectionDetail[] {
  const contacts = new Map(library.map(entry => [entry.peerId, entry]));
  return peers.map(peer => {
    const entry = contacts.get(peer.peerId);
    return {
      peerId: peer.peerId,
      userId: entry?.userId ?? null,
      profile: entry ? { displayName: entry.displayName, username: entry.username, avatarRef: entry.avatarRef } : undefined,
      status: now - peer.lastActivity < 20_000 ? 'healthy' : now - peer.lastActivity < 30_000 ? 'degraded' : 'stale',
      connectedAt: peer.connectedAt,
      lastActivity: peer.lastActivity,
      avgRttMs: peer.avgRttMs,
      lastSeenAt: peer.lastActivity,
    };
  });
}