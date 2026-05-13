---
name: World Tools Placement (Phase 5)
description: Click-to-place prefabs onto Earth via raycast → BuilderBlockEngine → IDB + BroadcastChannel + scaffold bus
type: feature
---
Pointer raycasts an invisible sphere co-located with Earth (`PlacementInteractor`).
Hit point → Earth-local frame via `registerLocalSiteFrame(anchorId)` →
`getBuilderBlockEngine().placeBlock(...)` (single writer of pin templates).
Each placement emits `world.mutation` through `world.bus` (labour credit
via `coin.bus`). Persistence: IDB `swarm-world-placements` v1 +
`BroadcastChannel('swarm:world:placements')`, hydrated on idle, replays
through the engine. Local-protect against peer overwrite. Gated by
`builder.mode === 'build' && selectedPrefabId`. See
`docs/PHASE_5_WORLD_TOOLS.md`.