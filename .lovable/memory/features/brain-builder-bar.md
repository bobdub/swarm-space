---
name: Brain Builder Bar (UQRC-aligned)
description: Sims-style in-world construction dock for BrainUniverseScene. Hammer icon toggles Builder Mode, hides joystick/mini-map/run pill but keeps mic/camera/chat. Prefabs are real UQRC bodies; constituents validated against SHELL_DEFS ∪ INNER_SYMBOLS; magnetic snap defined as minimizing ‖[D_μ,D_ν]‖. Commits go ONLY through getBuilderBlockEngine().placeBlock — never touch field.axes/body.pos/pin templates directly.
type: feature
---

The Brain Builder Bar lets users place real UQRC bodies into the world
via a Sims-style dock. The bar is a UI lens; the **only** writer to the
lattice for builder content is `src/lib/brain/builderBlockEngine.ts`
(its `placeBlock` / `removeBlock` / `upgradeBlock`). The Bar never
mutates `field.axes`, `body.pos`, or pin templates.

**Activator:** hammer icon in the top HUD cluster (alongside Mic /
Camera / Chat). Toggles `useBrainBuilder.mode` between `'off'` and
`'build'` and emits a `brain-builder-mode` `CustomEvent` with
`{ mode, magnetic }`.

**Focus mode:** while `mode === 'build'`, `<DesktopJoystick/>`,
`<MobileJoystick/>`, `<MiniMapHUD/>`, and `<RunPill/>` are unmounted.
**Mic, Camera, and Chat remain active** so users can collaborate while
building.

**Catalog:** `src/lib/brain/prefabHouseCatalog.ts`. Every prefab's
constituents MUST exist in `SHELL_DEFS ∪ INNER_SYMBOLS`
(`src/lib/brain/elements.ts`); the module validates this at load and
throws on unknown symbols. Per-prefab `color`, `mass`, `basin`,
`waterResistance`, `flammability`, and `shellTags` are derived from
constituents — no free-floating numbers. Sections: foundations, floors,
walls, doors, windows, roofs.

**Magnetic snap:** "magnetic" means selecting the candidate offset that
minimizes the local commutator norm `‖[D_μ, D_ν]‖` of the field at the
ghost's centre vs. its neighbours, with right-angle yaw as a hard
prefilter. Same metric the world trusts for closure quality, so snapped
pieces are also more lattice-stable. Toggle is ON by default.

**Earth-local anchoring:** all offsets stored as
`(rightOffset, forwardOffset, yaw)` in the `SHARED_VILLAGE_ANCHOR_ID`
site frame (same frame `WetWorkHabitat`, `SurfaceTree`, `NatureLayer`
use). Surface lift is already applied inside `computeWorldPos`, so
blocks never sink into terrain.

**Stability:** no `<form>`. All buttons `type="button"`. Bar uses
`role="form"`. No new IndexedDB schema; piece persistence reuses the
existing `loadPieces` / `savePieces` path.

**Scaffolding shipped:** prefab catalog, `useBrainBuilder` hook,
`BuilderActivator`, `BrainBuilderBar` dock, scene focus-mode gating.
**Follow-up:** translucent `GhostPiece`, `findMagneticSnap` over
`commutatorNorm3D`, magnetic field-line glow, commit via `placeBlock`,
hover `PlacedBlockEditChip` (Move / Rotate ±π/2 / Delete / Snap).

See `docs/BRAIN_UNIVERSE.md` § Brain Builder Bar.