---
name: Remix — Elemental Alchemy Lab
description: /remix is the creator surface (Lab/Brains/Assets tabs) where users draw with real elements/molecules and evolve them through the same UQRC field engine that drives Brains. Constituents validated against SHELL_DEFS ∪ INNER_SYMBOLS. Only labField may construct/tick a Field. Minted assets propagate as media-coins and drop into the Builder Bar via registerCustomPrefab. Lab is reachable from BrainBuilderBar's FlaskConical "Enter the Lab" button. No <form>, all buttons type="button".
type: feature
---

`/remix` is the project's creator manifold. Three tabs:

- **Lab** — `src/pages/Remix.tsx` → `LabTab` (canvas + element picker +
  UQRC stats). Strokes seed `u(0)`; `step(field)` evolves; rendering
  projects from `u(t)` (commutator → bonds, `curvatureMap` → heat).
- **Brains** — remixable Project Brain universes (placeholder).
- **Assets** — minted molecules / structures (placeholder).

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
`prefabHouseCatalog.registerCustomPrefab(prefab)`. The bar's
`listPrefabs()` returns static ∪ runtime overlay; subscribers re-render
via `subscribeCustomPrefabs`.

**Lab entry:** `BrainBuilderBar` shows a `FlaskConical` button labelled
“Enter the Lab” that navigates to `/remix`. Builder Mode state is
preserved.

**Hard rules:**
- No `<form>`. Wrappers use `role="form"`. All buttons `type="button"`.
- “Hydrogen cannot be locally modified without global reconfiguration”
  — editing an H atom triggers a full re-pin pass before the next tick.
- Synapse writes for `molecule:<id>` keys are throttled (project ≥ 2.5 m
  performance rule).

See `docs/REMIX_LAB.md` for the full pipeline diagram and follow-ups.