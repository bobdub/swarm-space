import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';

/**
 * Upgrade legacy/local shorthand anchors to the live peer id so NPC bodies
 * spawn on the player's actual world site instead of a detached hash point.
 */
export function resolveLocalAnchorId(requested: string): string {
  if (requested !== 'self') return requested;
  try {
    const peerId = getSwarmMeshStandalone().getPeerId?.();
    return typeof peerId === 'string' && peerId.trim().length > 0 ? peerId : requested;
  } catch {
    return requested;
  }
}