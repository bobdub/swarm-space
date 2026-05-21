/**
 * p2pPlacementBridge — wires world placements + forged tools to the
 * SwarmMesh broadcast/onMessage transport so connected peers see each
 * other's buildings and dropped tools in real time.
 *
 * Pattern matches existing scaffold buses: local-first stores remain the
 * source of truth, this bridge only relays records over the mesh and
 * funnels incoming records through the stores' `acceptPeer*` plug-points
 * (which already respect the `_origin: 'local'` overwrite guard).
 */
import {
  attachPlacementGossip,
  acceptPeerPlacement,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import {
  attachToolGossip,
  acceptPeerForgedTool,
  type ForgedToolRecord,
} from '@/lib/brain/toolMintStore';

const PLACEMENT_CHANNEL = 'world:placement';
const TOOL_CHANNEL = 'tools:forged';

let booted = false;

export function bootPlacementGossipBridge(): void {
  if (booted) return;
  booted = true;

  void (async () => {
    let mesh: { broadcast: (c: string, p: unknown) => void; onMessage: (c: string, h: (peerId: string, payload: unknown) => void) => () => void } | null = null;
    try {
      const mod = await import('@/lib/p2p/swarmMesh.standalone');
      mesh = mod.getSwarmMeshStandalone() as unknown as typeof mesh;
    } catch (err) {
      console.warn('[placementBridge] mesh unavailable', err);
      return;
    }
    if (!mesh) return;

    // Outbound — every new local placement / forged tool is relayed.
    attachPlacementGossip((rec: PlacementRecord) => {
      try { mesh!.broadcast(PLACEMENT_CHANNEL, rec); } catch { /* noop */ }
    });
    attachToolGossip((rec: ForgedToolRecord) => {
      try { mesh!.broadcast(TOOL_CHANNEL, rec); } catch { /* noop */ }
    });

    // Inbound — funnel peer records through the same accept-plug points
    // the BroadcastChannel cross-tab path uses, so the local-protect
    // guard and BuilderBlockEngine replay logic still apply.
    mesh.onMessage(PLACEMENT_CHANNEL, (_peerId, payload) => {
      const rec = payload as PlacementRecord | undefined;
      if (!rec || !rec.placementId || !rec.prefabId) return;
      try { acceptPeerPlacement(rec); } catch (err) {
        console.warn('[placementBridge] accept placement failed', err);
      }
    });
    mesh.onMessage(TOOL_CHANNEL, (_peerId, payload) => {
      const rec = payload as ForgedToolRecord | undefined;
      if (!rec || !rec.id || !rec.tool) return;
      try { acceptPeerForgedTool(rec); } catch (err) {
        console.warn('[placementBridge] accept tool failed', err);
      }
    });

    console.log('[placementBridge] mesh gossip wired (placements + forged tools)');
  })();
}