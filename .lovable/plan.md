# Make main Brain lobby builds visible to everyone (projects stay private)

## What's happening now

Placements (walls, prefabs, wall-mounted posts) live in `worldPlacementsStore` and are
gossiped over the mesh by `p2pPlacementBridge` — but only at the moment they are placed.
There is no backfill: a peer who joins the lobby later, or reloads the page, never receives
the placements that already exist, so everyone effectively sees only their own build.

Peer-received placements are also held in memory only, so a refresh wipes them.

Separately, an inbound placement carrying `universeKey: "project-<id>"` is accepted by any
node that receives it. It isn't rendered outside that universe, but if that user ever enters
the project hub the record is already there — project content can reach non-members.

## What will change

1. **Global backfill sync.** Peers exchange the lobby's placement list on connect, so
   everything already standing in the main Brain shows up for everyone present.
2. **Project scope stays private.** The backfill responder serves only `global` records.
   Project and live-room placements keep exactly today's behaviour (live broadcast while
   you're building), plus a new membership check on receipt.
3. **Non-member drop.** Incoming `project-<id>` placements are discarded unless the local
   user is a member of that project.

## Technical detail

**`src/lib/world/worldPlacementsStore.ts`**
- Add `buildGlobalPlacementSnapshot(): PlacementRecord[]` — all records whose scope is
  `global` (local-origin and peer-origin alike), stripped to transport fields.
- Add `mergePlacementSnapshot(records)` — loops through `acceptPeerPlacement`, which already
  honours the `_origin: 'local'` overwrite guard and the active-universe render filter.
- Persist peer-origin `global` records to IDB in `ingest` so a reload doesn't blank the lobby
  before the next sync lands. `writeSnapshot()` (localStorage) stays local-only, unchanged.

**`src/lib/world/p2pPlacementBridge.ts`**
- Two new channels: `world:placements:sync-request` and `world:placements:sync-response`.
- On request: reply to that peer with `buildGlobalPlacementSnapshot()` via `mesh.send(...)`.
  Never include non-global scopes.
- On response: `mergePlacementSnapshot(...)` with a payload cap (ignore absurd array sizes).
- New-peer detection: the bridge polls `getConnectedPeerIds()` every 10s, tracks the set it
  has already asked, and sends one request per newly-seen peer. No change to `swarmMesh`
  internals, so the existing sync handshake is untouched.
- Inbound live placements: if `universeKey` starts with `project-`, resolve the project via
  `getProject` and drop the record unless `isProjectMember(project, currentUser.id)`.
  `global` and `liveroom-*` records are unaffected.

## Verification

- Typecheck.
- Playwright: two browser contexts on `/brain`, place a wall in context A, confirm it arrives
  and renders in context B; reload B and confirm it persists.
- Confirm a synthetic `project-x` placement injected into a non-member node is rejected
  (`listPlacements()` empty after `setActiveUniverse('project-x')`).

## Explicitly not touched

Project hub placement creation, `setActiveUniverse` rebind logic, land plots, builder bar
gating, sculpting, or the wall-post billboard resolver.