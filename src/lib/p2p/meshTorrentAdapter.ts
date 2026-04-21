/**
 * ═══════════════════════════════════════════════════════════════════════
 * Mesh ↔ Torrent Adapter Bridge
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Adapts the active mesh instance (StandaloneSwarmMesh or
 * StandaloneBuilderMode) to the MeshTransportAdapter interface
 * expected by TorrentSwarm.
 *
 * Usage:
 *   const adapter = createSwarmMeshAdapter(meshInstance, localPeerId);
 *   const torrent = getTorrentSwarm(adapter);
 *   torrent.start();
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { MeshTransportAdapter } from "./torrentSwarm.standalone";
import type { StandaloneSwarmMesh } from "./swarmMesh.standalone";
import type { StandaloneBuilderMode } from "./builderMode.standalone-archived";

type AnyMesh = StandaloneSwarmMesh | StandaloneBuilderMode;

export function createMeshTorrentAdapter(
  mesh: AnyMesh,
  localPeerId: string
): MeshTransportAdapter {
  return {
    localPeerId,

    send(channel: string, peerId: string, payload: unknown): Promise<boolean> {
      return mesh.send(channel, peerId, payload);
    },

    broadcast(channel: string, payload: unknown): void {
      mesh.broadcast(channel, payload);
    },

    onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void {
      return mesh.onMessage(channel, handler);
    },

    getConnectedPeerIds(): string[] {
      return mesh.getConnectedPeerIds();
    },
  };
}
