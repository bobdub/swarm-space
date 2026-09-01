---
name: Land Ownership Enforcement
description: Single canBuildAtWorldPoint gate for all world mutations, always-on surface markers with owner nameplates, dev-only communal/road plots
type: feature
---
**Gate:** `src/lib/world/landPermissions.ts#canBuildAtWorldPoint(point, actorId)` projects a world point into the lattice-origin tangent frame and defers to `landPlots.canBuildAtTangent`. Every mutation routes through it: prefab place, move/edit, delete, decorate (BrainUniverseScene) and tool swings / digging (`toolActions.landBlocks`). Fails OPEN on math errors.

**Rules:** unclaimed ground = anyone; private plot = owner only; commons = devs only (public land stays walkable, nobody builds on it). Plot surveying also refuses to extend into foreign or communal cells.

**Devs:** `src/lib/world/devRoles.ts` — hardcoded `DEV_PEER_IDS` plus runtime `localStorage['swarm-dev-peer-ids']` (`grantDev(id)`). Devs get a "Commons" chip in the builder bar; commons claims are free and skip the SWARM burn.

**Surface markers:** `LandPlotsOverlay` renders always (not only in build mode), toggled by `landOverlayStore` ("Land" chip). Green = own, red = foreign, slate = commons, each with a Drei `<Html>` nameplate at the plot centre.
