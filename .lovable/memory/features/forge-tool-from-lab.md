---
name: Forge Tool from Lab (Phase 4)
description: Lab molecules forge into custom Tools that feed toolCatalog. IndexedDB swarm-tool-mints v1, BroadcastChannel swarm:tool:mints. Consumers must use getToolAny/listAllTools to see forges; built-in getTool only returns base specs.
type: feature
---

## Rule

`forgeMoleculeAsTool()` derives a Tool (handle/head/binding) from a
`Molecule`, registers it via `registerCustomTool`, persists to
`swarm-tool-mints` v1, gossips on `swarm:tool:mints`, and emits a
`lab.recipe` with `formula: forge:<molFormula>` on the scaffold bus.

## Derivation

- head = highest atomic-mass non-organic element
- handle = best organic (C → H → fallback)
- binding = smallest-count remaining
- actionKind by mass: ≤0.4 kg → whittle, ≤1.5 kg → chop, else dig
- baseSharpness = 0.32 + aspectTerm·0.55 + mineralBonus(0.18) − organicPenalty(0.12)

## Constraints

- Consumers that must see forged tools call `getToolAny()` /
  `listAllTools()`. Built-in `getTool()` is unchanged for backwards-compat.
- Local-protection: peer records cannot overwrite local-origin records.
- Non-destructive IDB upgrade: `onversionchange` only closes the handle.
- All constituent symbols must already exist in `elements.ts` /
  `ELEMENT_COLORS` (validated at register).
- No standalone placement path — the forged Tool surfaces only through
  the catalog the existing `sculpting.applyImpact` predicate reads.