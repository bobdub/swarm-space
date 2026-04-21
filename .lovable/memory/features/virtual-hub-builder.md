---
name: Virtual Hub Builder Bar
description: Sims-style 3D construction inside per-project Virtual Hubs — members-only edits, persisted on Project.hubBuild, synced via standalone mesh broadcastProject; magnetic snap 0.4m; primitives only
type: feature
---

Every project owns a walkable 3D Virtual Hub (VirtualHub.tsx) with a Sims-style Builder Bar.

**Permissions:** Build mode and edits are **members-only**. `src/lib/projects.ts` allows any project member to update **only** the `hubBuild` field; all other project fields remain owner-only. Non-members see the world but cannot edit.

**Data model:** `Project.hubBuild = { pieces: HubPiece[] }` where each piece has `{ id, kind, section, position, rotationY, placedBy, placedAt }`.

**Catalog:** `src/lib/virtualHub/builderCatalog.ts` — primitive geometries only (no external assets). Sections: walls, doors, windows, roof, floor.

**Snapping:** `findSnap` in `snapping.ts` — magnetic edge-midpoint snap with **0.4 m threshold**, rotation alignment within 5° of 0/90/180/270.

**Sync:** `useBuildController` debounces `updateProject` by 1 s; the standalone mesh's `broadcastProject` propagates to peers within ~2 s.

**Mode switching:** Build mode pauses `<PointerLockControls />`, freezes the player controller, hides the mobile joystick, and reuses the same canvas pointer handlers for piece dragging.

See `docs/VIRTUAL_HUB.md`.
