# Phase 5 — World Building Tools (raycast + place)

`To Infinity and beyond! · Q ≈ 0.0040 · geodesic: scaffold → surface`

Lifts the World Building Tools scaffolding from "tile palette only" to a
playable click-to-place surface inside `BrainUniverseScene`.

## What landed

- `src/lib/brain/earth.ts` — added `registerLocalSiteFrame(anchorId, n,
  f, r)` so synthetic placement anchors can bypass the deterministic
  `spawnOnEarth` derivation and target an arbitrary world point.
- `src/lib/world/placementController.ts` — `frameForHit()` derives an
  Earth-local frame from a pointer hit; `placePrefabAtHit()` routes
  through the existing `BuilderBlockEngine.placeBlock()` and emits a
  `world.mutation` scaffold-bus event so labour credit + sub-Q telemetry
  flow through the bus exactly as sculpting does.
- `src/lib/world/worldPlacementsStore.ts` — IDB `swarm-world-placements`
  v1 + `BroadcastChannel('swarm:world:placements')` + gossip-bridge
  plug-point. Local-protect, non-destructive upgrade, hydrate-on-idle
  replays placements through the engine.
- `src/components/world/PlacementInteractor.tsx` — invisible raycast
  shell co-located with Earth + ghost preview + click commit. Mounted
  inside the Canvas in `BrainUniverseScene`, gated on
  `builder.mode === 'build' && selectedPrefabId`.
- `src/main.tsx` — `hydrateWorldPlacements()` on idle.

## UQRC chain

```
pointer → world hit P
        → un-spin to Earth-local n̂  (quatRotate invSpinQuat)
        → Gram-Schmidt {n̂, f̂, r̂}
        → registerLocalSiteFrame(anchorId)
        → BuilderBlockEngine.placeBlock(...)
              → physics.addBody + pinSupportBasin     (existing)
              → tick re-stamping at live pose         (existing)
        → emitWorldMutation(actor, target, mass·0.01) (scaffold bus)
              → coin.bus credits labour:<actor>       (existing)
              → labourLedger updates Wallet           (existing, P3)
        → recordLocalPlacement(handle)
              → IDB put + BroadcastChannel + gossip   (this phase)
```

## QA checklist

1. `/index` → enter Brain → enable Build mode → pick a prefab → ghost
   follows pointer over Earth → click → block appears at click point.
2. Reload the tab → block persists (replayed via hydrateWorldPlacements).
3. Open a second tab → block fan-out arrives via BroadcastChannel.
4. Open `Wallet → Credits → Labour Payouts` → `labour:<selfId>` row
   shows a small fill from the placement.
5. Disable scaffold bus (`featureFlags.scaffoldBus.enabled=false`) →
   placement still works locally; labour credit goes silent.

## Invariants honored

- All placement decisions route through the existing
  `BuilderBlockEngine` (single writer of pin templates).
- No `<form>`; pointer events are R3F-native.
- IDB: non-destructive upgrade, sync-safe close on `versionchange`.
- Local-protect: peer records cannot overwrite local-origin placements.
- Scaffold-bus kill-switch honored (placement still works without it).

## Known follow-ups (deferred to later phases)

- Undo / remove pass.
- Per-prefab yaw and snap-to-grid HUD controls.
- Resource snapping (Phase 7) so trees/water clamp to nature seeds.
- Voxel sculpt action (Phase 8) using the same raycast shell.