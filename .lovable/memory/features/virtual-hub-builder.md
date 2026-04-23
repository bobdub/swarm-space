---
name: Virtual Hub Builder Bar
description: Sims-style 3D construction inside per-project Virtual Hubs — members-only edits, persisted on Project.hubBuild, synced via standalone mesh broadcastProject; magnetic snap 0.4m; pieces are real chemical compounds drawn from elements.ts
type: feature
---

Every project owns a walkable 3D Virtual Hub (VirtualHub.tsx) with a Sims-style Builder Bar.

**Permissions:** Build mode and edits are **members-only**. `src/lib/projects.ts` allows any project member to update **only** the `hubBuild` field; all other project fields remain owner-only. Non-members see the world but cannot edit.

**Data model:** `Project.hubBuild = { pieces: HubPiece[] }` where each piece has `{ id, kind, section, position, rotationY, placedBy, placedAt }`.

**Catalog:** `src/lib/virtualHub/builderCatalog.ts` — primitive geometries only (no external assets). Sections: walls, doors, windows, roof, floor.

**Compounds (`src/lib/virtualHub/compoundCatalog.ts`):** Every `BuilderItem` declares a `compoundId` resolving to `COMPOUND_TABLE` — limestone (CaCO₃), gypsum (CaSO₄·2H₂O), kaolinite adobe (Al₂O₃·2SiO₂·2H₂O), soda-lime glass (Na₂O·CaO·6SiO₂), borosilicate (B₂O₃·SiO₂), cellulose oak (C₆H₁₀O₅)ₙ, steel (Fe·C·Cr), terracotta (Fe₂O₃·Al₂O₃·SiO₂), bitumen-aluminium (Al + alkanes), calcium-silicate concrete (CaO·SiO₂·H₂O). All constituent symbols MUST exist in `src/lib/brain/elements.ts` (`SHELL_DEFS` ∪ `INNER_SYMBOLS`) — single periodic-table source of truth shared with the Brain Universe. Colors are deterministic blends of per-element colors from the shared `ELEMENT_COLORS` map (also consumed by `ElementsVisual.tsx`). See `mem://architecture/brain-universe-elements`.

**Snapping:** `findSnap` in `snapping.ts` — magnetic edge-midpoint snap with **0.4 m threshold**, rotation alignment within 5° of 0/90/180/270.

**Sync:** `useBuildController` debounces `updateProject` by 1 s; the standalone mesh's `broadcastProject` propagates to peers within ~2 s.

**Mode switching:** Build mode pauses `<PointerLockControls />`, freezes the player controller, hides the mobile joystick, and reuses the same canvas pointer handlers for piece dragging.

**Reference structure — `src/components/brain/SurfaceApartment.tsx`:** Canonical mostly-stable example for any future builder-placed item. The contract:
- Register a `'piece'` body with the UQRC physics engine on mount; pin a small curvature basin via `physics.pinPiece`; unregister on unmount.
- Build pose from the SHARED `getEarthLocalSiteFrame(anchorPeerId)` so all viewers see it at the same world-space spot.
- In `useFrame`, READ the body pose from physics (`getBody`) and reproject onto the feet shell each tick so it co-moves with Earth.
- Derive orientation from the live radial up + the spawn tangent frame, re-orthonormalized — never from a stored Euler.

Known bugs (open, intentionally not silently fixed):
1. **Scale not avatar-calibrated** — sizes are hand-tuned magic numbers, not derived from `BODY_CENTER_HEIGHT` or any humanoid metric.
2. **No collider; Earth-breath drift** — the apartment is locked to the feet shell, but the visible ground shell breathes up/down with orbit phase, so the ground passes through the static floor slab.

See `docs/VIRTUAL_HUB.md`.
