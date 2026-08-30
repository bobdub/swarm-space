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
  attachPlacementDeleteGossip,
  acceptPeerPlacement,
  acceptPeerPlacementDelete,
  buildGlobalPlacementSnapshot,
  buildGlobalTombstoneSnapshot,
  mergePlacementSnapshot,
  type PlacementRecord,
  type PlacementTombstone,
} from '@/lib/world/worldPlacementsStore';
import {
  attachToolGossip,
  acceptPeerForgedTool,
  type ForgedToolRecord,
} from '@/lib/brain/toolMintStore';
import {
  attachBarLightsGossip,
  acceptPeerBarLights,
  getBarLightsSnapshot,
} from '@/lib/brain/barLightsStore';

import {
  attachPubTableGossip,
  attachPubIntentGossip,
  acceptPeerTable,
  acceptPeerIntent,
  buildPubTableSnapshot,
  mergePubTableSnapshot,
  type PubTable,
  type PubIntent,
} from '@/lib/pub/gameTableStore';

const PLACEMENT_CHANNEL = 'world:placement';
const PLACEMENT_DELETE_CHANNEL = 'world:placement:delete';
const TOOL_CHANNEL = 'tools:forged';
const SYNC_REQUEST_CHANNEL = 'world:placements:sync-request';
const SYNC_RESPONSE_CHANNEL = 'world:placements:sync-response';
const BARLIGHTS_CHANNEL = 'brain:barlights';
const BARLIGHTS_SYNC_REQUEST = 'brain:barlights:sync-request';
const BARLIGHTS_SYNC_RESPONSE = 'brain:barlights:sync-response';
const PUBTABLE_CHANNEL = 'pub:table';
const PUBTABLE_INTENT_CHANNEL = 'pub:table:intent';
const PUBTABLE_SYNC_REQUEST = 'pub:table:sync-request';
const PUBTABLE_SYNC_RESPONSE = 'pub:table:sync-response';
/** How often we look for peers we haven't backfilled from yet. */
const PEER_POLL_MS = 10_000;

let booted = false;

/**
 * Project-scoped placements are private to that project's members.
 * A `project-<id>` record from the mesh is only accepted when the local
 * user is a member. `global` (main lobby) and `liveroom-*` are untouched.
 */
async function isAcceptableScope(universeKey?: string): Promise<boolean> {
  const key = universeKey && universeKey.length > 0 ? universeKey : 'global';
  if (!key.startsWith('project-')) return true;
  const projectId = key.slice('project-'.length);
  if (!projectId) return false;
  try {
    const [{ getProject, isProjectMember }, { getCurrentUser }] = await Promise.all([
      import('@/lib/projects'),
      import('@/lib/auth'),
    ]);
    const [project, user] = await Promise.all([getProject(projectId), getCurrentUser()]);
    return Boolean(project && user && isProjectMember(project, user.id));
  } catch {
    return false;
  }
}

export function bootPlacementGossipBridge(): void {
  if (booted) return;
  booted = true;

  void (async () => {
    let mesh: {
      broadcast: (c: string, p: unknown) => void;
      send: (c: string, peerId: string, p: unknown) => Promise<boolean>;
      onMessage: (c: string, h: (peerId: string, payload: unknown) => void) => () => void;
      getConnectedPeerIds: () => string[];
    } | null = null;
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
    attachPlacementDeleteGossip((tomb: PlacementTombstone) => {
      try { mesh!.broadcast(PLACEMENT_DELETE_CHANNEL, tomb); } catch { /* noop */ }
    });
    attachToolGossip((rec: ForgedToolRecord) => {
      try { mesh!.broadcast(TOOL_CHANNEL, rec); } catch { /* noop */ }
    });
    // Bar lights are lobby-wide shared state — relay every local flip.
    attachBarLightsGossip((snap) => {
      try { mesh!.broadcast(BARLIGHTS_CHANNEL, snap); } catch { /* noop */ }
    });

    // Pub game tables — LWW table snapshots + host-routed move intents.
    attachPubTableGossip((rec: PubTable) => {
      try { mesh!.broadcast(PUBTABLE_CHANNEL, rec); } catch { /* noop */ }
    });
    attachPubIntentGossip((intent: PubIntent) => {
      try { mesh!.broadcast(PUBTABLE_INTENT_CHANNEL, intent); } catch { /* noop */ }
    });

    // Inbound — funnel peer records through the same accept-plug points
    // the BroadcastChannel cross-tab path uses, so the local-protect
    // guard and BuilderBlockEngine replay logic still apply.
    mesh.onMessage(PLACEMENT_CHANNEL, (_peerId, payload) => {
      const rec = payload as PlacementRecord | undefined;
      if (!rec || !rec.placementId || !rec.prefabId) return;
      void isAcceptableScope(rec.universeKey).then((ok) => {
        if (!ok) return;
        try { acceptPeerPlacement(rec); } catch (err) {
          console.warn('[placementBridge] accept placement failed', err);
        }
      });
    });
    mesh.onMessage(TOOL_CHANNEL, (_peerId, payload) => {
      const rec = payload as ForgedToolRecord | undefined;
      if (!rec || !rec.id || !rec.tool) return;
      try { acceptPeerForgedTool(rec); } catch (err) {
        console.warn('[placementBridge] accept tool failed', err);
      }
    });

    mesh.onMessage(PLACEMENT_DELETE_CHANNEL, (_peerId, payload) => {
      const tomb = payload as PlacementTombstone | undefined;
      if (!tomb || !tomb.placementId) return;
      void isAcceptableScope(tomb.universeKey).then((ok) => {
        if (!ok) return;
        try { acceptPeerPlacementDelete(tomb); } catch (err) {
          console.warn('[placementBridge] accept delete failed', err);
        }
      });
    });

    // ── Bar lights: live gossip + newcomer backfill ─────────────────
    mesh.onMessage(BARLIGHTS_CHANNEL, (_peerId, payload) => {
      try { acceptPeerBarLights(payload); } catch { /* noop */ }
    });
    mesh.onMessage(BARLIGHTS_SYNC_REQUEST, (peerId) => {
      try {
        const snap = getBarLightsSnapshot();
        if (snap.updatedAt <= 0) return; // never flipped locally — nothing authoritative to share
        void mesh!.send(BARLIGHTS_SYNC_RESPONSE, peerId, snap);
      } catch { /* noop */ }
    });
    mesh.onMessage(BARLIGHTS_SYNC_RESPONSE, (_peerId, payload) => {
      try { acceptPeerBarLights(payload); } catch { /* noop */ }
    });

    // ── Pub tables: live gossip + newcomer backfill ────────────────
    mesh.onMessage(PUBTABLE_CHANNEL, (_peerId, payload) => {
      try { acceptPeerTable(payload); } catch { /* noop */ }
    });
    mesh.onMessage(PUBTABLE_INTENT_CHANNEL, (_peerId, payload) => {
      // Ignored unless we host the named table.
      try { acceptPeerIntent(payload); } catch { /* noop */ }
    });
    mesh.onMessage(PUBTABLE_SYNC_REQUEST, (peerId) => {
      try {
        const snap = buildPubTableSnapshot();
        if (snap.length === 0) return;
        void mesh!.send(PUBTABLE_SYNC_RESPONSE, peerId, snap);
      } catch { /* noop */ }
    });
    mesh.onMessage(PUBTABLE_SYNC_RESPONSE, (_peerId, payload) => {
      try { mergePubTableSnapshot(payload); } catch { /* noop */ }
    });

    // ── Backfill: main-Brain lobby placements only ──────────────────
    mesh.onMessage(SYNC_REQUEST_CHANNEL, (peerId) => {
      try {
        const snapshot = buildGlobalPlacementSnapshot();
        const tombs = buildGlobalTombstoneSnapshot();
        if (snapshot.length === 0 && tombs.length === 0) return;
        void mesh!.send(SYNC_RESPONSE_CHANNEL, peerId, { placements: snapshot, tombstones: tombs });
      } catch (err) {
        console.warn('[placementBridge] sync-request failed', err);
      }
    });

    mesh.onMessage(SYNC_RESPONSE_CHANNEL, (_peerId, payload) => {
      const body = payload as { placements?: unknown; tombstones?: unknown } | undefined;
      const list = body?.placements;
      const tombs = Array.isArray(body?.tombstones) ? (body!.tombstones as PlacementTombstone[]) : null;
      if (!Array.isArray(list) && !tombs) return;
      try {
        const n = mergePlacementSnapshot(
          Array.isArray(list) ? (list as PlacementRecord[]) : [],
          tombs,
        );
        if (n > 0) console.log(`[placementBridge] merged ${n} lobby placement(s) from peer`);
      } catch (err) {
        console.warn('[placementBridge] merge snapshot failed', err);
      }
    });

    // Ask each newly-seen peer once for the lobby snapshot.
    const asked = new Set<string>();
    const pollPeers = () => {
      try {
        const ids = mesh!.getConnectedPeerIds();
        const live = new Set(ids);
        for (const id of [...asked]) if (!live.has(id)) asked.delete(id);
        for (const id of ids) {
          if (asked.has(id)) continue;
          asked.add(id);
          void mesh!.send(SYNC_REQUEST_CHANNEL, id, {});
          void mesh!.send(BARLIGHTS_SYNC_REQUEST, id, {});
          void mesh!.send(PUBTABLE_SYNC_REQUEST, id, {});
        }
      } catch { /* noop */ }
    };
    pollPeers();
    setInterval(pollPeers, PEER_POLL_MS);

    console.log('[placementBridge] mesh gossip wired (placements + backfill + forged tools + pub tables)');
  })();
}