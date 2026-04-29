# /remix — Elemental Alchemy Lab

A creator surface where users draw, assign **real chemical elements and
molecules**, and watch the project's **UQRC field engine** evolve them
into living assets. There is no separate physics — every Lab tick runs
through `src/lib/uqrc/field.ts`, the same engine that drives Brains,
Builder Mode, and the Neural Network bus.

Route: `/remix` (lazy-loaded, behind `<AuthGuard/>`).

## Tabs

- **Lab** — 2D vector canvas + element/molecule picker + UQRC live HUD.
  Strokes carry pressure (→ local energy density), elements come from
  `SHELL_DEFS ∪ INNER_SYMBOLS`, molecules from `moleculeCatalog`. Mint
  emits a media-coin asset that propagates over the existing mesh.
- **Brains** — gallery of remixable Project Brain universes
  (placeholder in scaffold stage).
- **Assets** — minted molecules / structures, with “Drop into Brain”
  and “Open in Lab” actions (placeholder in scaffold stage).

## UQRC pipeline (single continuous operator flow)

```text
   2D drawing → seed u(0)
        │  inject(symbol, amplitude=Z/30, axis=0)
        │  pin(symbol, target=shellPin, axis=1)
        │  inject(bond, amplitude=order·0.15, axis=2)
        ▼
   step(field) at 4 Hz   ──► render from u(t)
        │                       (atoms, bonds = commutator strength,
        │                        background = curvatureMap)
        ▼
   Mint   ──► serializeField  +  mediaCoin.standalone
        ▼
   Drop   ──► registerCustomPrefab(prefab)
              (Builder Bar reads static ∪ runtime overlay)
```

## Hard rules

- **Periodic guardrail** — every constituent symbol MUST live in
  `SHELL_DEFS ∪ INNER_SYMBOLS`. Both `moleculeCatalog` and
  `prefabHouseCatalog` validate at registration time.
- **Single physics** — only `src/lib/remix/labField.ts` constructs or
  ticks a `Field`. UI components never import `field.ts` directly.
- **No `<form>`** — wrappers use `role="form"`, every button is
  `type="button"`.
- **Mint flow** — disables the Mint button while encrypting and obeys
  the project's 20 MB upload limit.
- **Hydrogen rule** — editing an `H` atom triggers a global re-pin pass
  before the next tick (mirrors the elements pin contract).

## Builder Bar entry

`BrainBuilderBar.tsx` shows a `FlaskConical` button labelled
“Enter the Lab”. Click → `navigate('/remix')`. Builder Mode state is
preserved on return (it's just a route change).

## Scaffold shipped

- Route + page (`src/pages/Remix.tsx`).
- Tabs: `LabTab`, `BrainsTab`, `AssetsTab`.
- `VectorCanvas` (HTML5 Canvas, pressure-aware strokes).
- `ElementPicker` over `moleculeCatalog.searchPeriodic`.
- `labField` singleton seam (lazy `Field`, stats subscribe, reset).
- `prefabHouseCatalog.registerCustomPrefab` runtime overlay.
- `BrainBuilderBar` Lab entry button.

## Follow-up (not in this scaffold)

- 4 Hz tick scheduler driving `step(field)` with temperature/external
  field controls.
- `seedFromStrokes` + `UqrcLabRender` projection (`commutator`-driven
  bond thickness, `curvatureMap` heatmap).
- `formulaParser` for ad-hoc `C6H12O6`-style entries with valence /
  closure assessment.
- `assetMint` + `assetStore`, IndexedDB-backed (throttled 2.5 m writes).
- Synapse memory key `molecule:<id>` writing into `synapseLayer`.
- Brains tab listing + clone-into-new-project flow.