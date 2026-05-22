---
name: Remix — Elemental Alchemy Lab
description: /remix is the creator surface (Lab/Crafting/Brains/Assets tabs) where users draw with real elements/molecules and evolve them through the same UQRC field engine that drives Brains. Constituents validated against SHELL_DEFS ∪ INNER_SYMBOLS. Only labField may construct/tick a Field. Minted assets propagate as media-coins and surface as a native "Lab" section in BrainBuilderBar (no popover). The first tile in that section is "+ Create" and routes to /remix. No <form>, all buttons type="button".
type: feature
---

`/remix` is the project's creator manifold. Four tabs:

- **Lab** — `src/pages/Remix.tsx` → `LabTab` (canvas + element picker +
  UQRC stats). Strokes seed `u(0)`; `step(field)` evolves; rendering
  projects from `u(t)` (commutator → bonds, `curvatureMap` → heat).
- **Crafting** — Blacksmith Forge: condense harvested chemicals into
  unsealed SWARM coins (85% hard cap) or smelt sealed coins back into
  the active project's pool. Rail shows first 5 empties; focuses on the
  picked coin with a "Show all (N)" toggle.
- **Brains** — public gallery of remixable Project Brain submissions.
- **Assets** — project-scoped minted molecules, import-gated by
  harvested chemicals.

**Periodic guardrail:** every constituent symbol must exist in
`SHELL_DEFS ∪ INNER_SYMBOLS` (`src/lib/brain/elements.ts`).
`moleculeCatalog.ts` enforces this at module load.

**Single physics:** only `src/lib/remix/labField.ts` may construct or
tick a `Field`. UI never imports `src/lib/uqrc/field.ts` directly,
mirroring the Builder Bar / `builderBlockEngine` discipline.

**Mint:** serializes the field via `serializeField` and emits a
media-coin through `src/lib/blockchain/mediaCoin.standalone.ts`.
Disables the Mint button while encrypting; obeys the 20 MB cap.

**Builder Bar drop:** minted assets call
`prefabHouseCatalog.registerCustomPrefab(prefab)` and are tracked by
`mintedPrefabsStore`. `BrainBuilderBar` exposes a virtual **Lab**
section tab that lists this project's mints as native PrefabTiles. The
first tile is "+ Create" and navigates to
`/remix?projectId=…`. The previous floating `LabPopover` has been
removed.

**Hard rules:**
- No `<form>`. Wrappers use `role="form"`. All buttons `type="button"`.
- “Hydrogen cannot be locally modified without global reconfiguration”
  — editing an H atom triggers a full re-pin pass before the next tick.
- Synapse writes for `molecule:<id>` keys are throttled (project ≥ 2.5 m
  performance rule).

See `docs/REMIX_LAB.md` for the full pipeline diagram and follow-ups.