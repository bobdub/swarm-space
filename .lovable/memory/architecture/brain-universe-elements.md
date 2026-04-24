---
name: brain-universe-elements
description: Periodic-table elements as a third pin layer in the Brain Universe — shell n + azimuthal slot, matter ridges + noble-gas closure basins + inner manifold spiral; shells extended to support builder chemistry
type: constraint
---
Elements (`src/lib/brain/elements.ts`) are baked into the UQRC field as a third structural pin layer alongside Galaxy and Earth.

- **Same rule as everything else in `/brain`**: writes `pinTemplate` only. Never touches `field.axes` directly. The operator's `L_S^pin` term re-asserts pins each tick.
- **Geometry**:
  - n=0: H, single isotropic boundary pin at lattice center (`+0.15`).
  - n=1: Li Be B + He(closure). Ring r=4 m. (4 slots)
  - n=2: Na Mg Al Si P **C N O F** + Ne(closure). Ring r=7 m. (10 slots — extended to support builder chemistry: cellulose, glass, oxides, nitrides.)
  - n=3: K Ca Sc Ti V **S Cl Cr Fe** + Ar(closure). Ring r=10 m. (10 slots — extended for steel/sulfates/chlorides used by builder compounds.)
  - n=4+: Lanthanide/Actinide subset, tight recursive spiral basin r≈2.5 m near the galactic core.
- **Pin roles**: matter `+0.45` (anisotropic radial outward); closure (noble gas) `-0.6` with wider falloff (anisotropic radial inward); inner `+0.7` tight falloff; boundary `+0.15` isotropic.
- **Determinism**: positions are pure functions of shell + slot + element index. Same on every peer, no network sync needed.
- **Conformance** (`elements.test.ts`): only `pinTemplate`/`pins` writes; commutator norm sampled along shell rings stays bounded after operator ticks; shell counts (n=0:1, n=1:4, n=2:10, n=3:10, n=4:≥14); `uqrcConformance.test.ts` and `infinityBinding.test.ts` regressions still pass.
- **Visual** (`ElementsVisual.tsx`): per-element color from shared `ELEMENT_COLORS` map (single source of truth, also drives builder pieces in `mem://features/virtual-hub-builder`). Shell rings use a fallback shell palette. Mobile suppresses non-closure labels.
- **Why**: structure is curvature. Bodies launched at a shell are deflected by the matter pin's gradient — there is no force code, only `∇u` flowing from the operator. The builder round-trips this chemistry: every piece a member places is made of elements pinned in the field.
- **Universe-wide chemistry**: every visible body in `/brain` resolves through one of two compound registries — `compoundCatalog` (builder pieces, flora, fauna, mountain, volcano prop) or `cosmoChemistry` (Sun = H/He plasma, Moon = Si/O/Fe/Mg/Al/Ca regolith, galactic core = Fe/Cr iron-peak, named stars = H/He blended toward Fe-line for dim ones, atmosphere = N₂/O₂/Ar/CO₂, water = H₂O, vent gas = H₂O/CO₂/SO₂). All colours flow through the same `blendColor()`, all symbols are members of `SHELL_DEFS ∪ INNER_SYMBOLS` — no new elements, no field-engine changes. `chemistryCoverage.test.ts` locks the invariant: a future body added without a compound entry fails CI. Volcano emission is exposed as `sampleVentEmission()` returning `{ rate, pressure, compound }` so HUDs can read out actual gas species rather than a scalar pressure.
