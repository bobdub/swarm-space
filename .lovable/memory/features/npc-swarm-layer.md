---
name: npc-swarm-layer
description: Phase 7 — NpcSwarmLayer renders one capsule per npcRegistry entry on the shared village anchor, drifts toward deterministic water/wood/animal sites mapped from NpcDrive; honors scaffoldBus kill-switch
type: feature
---
Live NPC roster is now visible in `BrainUniverseScene`. Read-only presentation layer — never writes field / builderBlockEngine / economy.

- Layer: `src/components/brain/npc/NpcSwarmLayer.tsx` — subscribes to `npcRegistry`, capsule per entry, positioned every frame via `anchorOnEarth(anchorId, tx, tz, BODY_SHELL_RADIUS, pose)` so the swarm rotates with Earth exactly like the player and WetWork habitat.
- Drift: ~1.2 m/s along tangent plane toward `nearestSite(tx, tz, driveToResourceKind(currentDrive))`. Stops within `ARRIVE_RADIUS` (1.5 m). No `Math.random` — deterministic interpolation.
- Resource sites: `src/lib/world/baseResources.ts` — 3 water, 5 wood, 4 animal seeded from FNV-1a hash, cached on first call, `_resetResourceSitesForTest` seam.
- Drive map: `src/lib/world/resourceTargeting.ts` — drink/fish→water, gather/craft→wood, hunt/eat→animal, others→null (idle).
- Kill-switch: `getFeatureFlags().scaffoldBus === false` freezes drift within one frame; capsules remain rendered.
- Mount: `BrainUniverseScene` next to `NatureLayer`, anchored to `SHARED_VILLAGE_ANCHOR_ID`.