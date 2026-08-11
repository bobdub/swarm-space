# Deleted walls stay deleted

## Problem (verified in code)

`removeLocalPlacement()` in `src/lib/world/worldPlacementsStore.ts` deletes the record from memory + IndexedDB, but:

1. It never tells other tabs or mesh peers about the deletion (no BroadcastChannel post, no gossip).
2. There is no record that the placement *was* deleted.

So on the next login, `p2pPlacementBridge` asks each peer for the lobby snapshot, the peer still holds the wall in `buildGlobalPlacementSnapshot()`, and `mergePlacementSnapshot()` re-ingests it as a peer record — the wall reappears. Even offline, a second open tab can re-broadcast it back.

## Fix: deletion tombstones

Add a small, self-contained tombstone layer to the placements store.

- New IndexedDB store `tombstones` in the same `swarm-world-placements` DB (non-destructive upgrade, DB_VERSION 1 -> 2, create-if-missing only).
- A tombstone is `{ placementId, universeKey, deletedAt }`, mirrored into a localStorage snapshot alongside the existing placements snapshot.
- `removeLocalPlacement()` writes a tombstone, then broadcasts a delete message on the BroadcastChannel and through the gossip bridge.
- `ingest()` drops any incoming record whose `placementId` has a tombstone newer than the record's `createdAt`/`updatedAt`, so backfill can no longer resurrect it.
- `buildGlobalPlacementSnapshot()` excludes tombstoned placements and ships the tombstone list with the snapshot, so peers who missed the live delete also learn about it.
- `mergePlacementSnapshot()` accepts the tombstone list first, applies them locally (removing any matching live record), then merges placements.
- Tombstones expire after 30 days to keep storage bounded.

## Mesh wiring

In `src/lib/world/p2pPlacementBridge.ts`:

- New `world:placement:delete` channel — broadcast on local delete, and on receive apply the tombstone through a new `acceptPeerPlacementDelete()` plug-point (scope-checked with the existing `isAcceptableScope`, so project deletes stay private).
- Sync response payload gains `tombstones`; the handler passes them to `mergePlacementSnapshot`.

## Verification

1. Unit test extending `src/lib/world/__tests__/placementSnapshot.test.ts`: after deleting a placement, `mergePlacementSnapshot()` with a peer snapshot still containing it must not re-add it, and the snapshot builder must emit the tombstone.
2. Live preview: place a wall in `/brain`, delete it, reload the page, confirm it does not return.

## Scope

Only `worldPlacementsStore.ts`, `p2pPlacementBridge.ts`, and the placement test file change. Placement, move, and decorate paths are untouched.
