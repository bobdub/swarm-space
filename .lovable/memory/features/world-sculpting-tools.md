---
name: World Sculpting & Tools
description: Voxel-style sculpting via composite tools (Knife/Axe/Shovel) using a single energy-vs-resistance UQRC predicate; Users and NPCs share the same path.
type: feature
---

## Rule

All tool-driven world mutation flows through one predicate:
`src/lib/brain/sculpting.ts → applyImpact()`. Both Users and NPCs call
it. Density CONTRIBUTES to resistance; bond term and `||[D_μ,D_ν]||`
round it out. A cut succeeds when
`(swingEnergy · sharpness) / resistance ≥ 1`.

## Modules

- `earthShells.ts` — symmetric N=0..4..0 layer table (`sampleShellAt`).
- `toolCatalog.ts` — composite tools (handle/head/binding), derived
  `baseSharpness` and `headDensity`.
- `toolSharpening.ts` — `sharpenTool` (consumes Salt Rock NaCl) and
  `applyToolWear` (auto per swing).
- `sculpting.ts` — the predicate + `cell-carved` event bus.
- `horizonFade.ts` — `evolutionHorizonAlpha(d)` smooth horizon ramp at
  `√(2·R·h) ≈ 76 m`.

## Constraints

- Tools and Salt Rock are published as Prefabs in
  `prefabHouseCatalog.ts` so the Builder Bar reuses the existing
  placement path. **Never** add a parallel placement system.
- Lava cannot be cut — `applyImpact` returns `lava_burns_tool`.
- Sharpness threshold per shell is a hard floor; below it no cut can
  happen regardless of swing energy.
- All elements used by tools/shells must exist in `elements.ts`
  (validators throw at module load).