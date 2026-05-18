# Phase 7 — NPCs visible in the world

The Phase 2 NPC live tick now has a body in the scene. `BrainUniverseScene` mounts a single `<NpcSwarmLayer/>` that subscribes to `npcRegistry` and renders one low-poly capsule per roster entry on the shared village anchor.

## Modules

- `src/lib/world/baseResources.ts` — deterministic water / wood / animal clusters seeded from a stable string (FNV-1a hash fanout, no `Math.random`).
- `src/lib/world/resourceTargeting.ts` — pure mapping `NpcDrive → ResourceKind` plus `nearestSite(tx, tz, kind)`.
- `src/components/brain/npc/NpcSwarmLayer.tsx` — capsule per NPC, drifts toward the targeted resource at ~1.2 m/s along the tangent plane, positions resolved every frame through `anchorOnEarth(...)` so the swarm rotates with the planet exactly like the player and the WetWork habitat.

## Discipline preserved

- Read-only adapter — never writes the field, never calls `builderBlockEngine`, never mutates economy.
- Honors `featureFlags.scaffoldBus` — disabling the flag freezes drift within one frame.
- No `Math.random` in motion: seed offsets and drift are pure hash-derived.
- Uses `BODY_SHELL_RADIUS` (same shell the player avatar walks on).

## QA gates

1. Open `/brain` → water / wood / animal markers visible; if NPCs are seeded, capsules drift between them.
2. Reload → roster restored from `swarm-npcs` persistence (no re-seed loop).
3. Toggle `setFeatureFlag('scaffoldBus', false)` from the console → capsules stop moving within one frame.

## Next phase

Phase 8 — per-scaffolding sub-Q health badges (App Health view extension).