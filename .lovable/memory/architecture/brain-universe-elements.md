---
name: brain-universe-elements
description: Periodic-table elements as a third pin layer in the Brain Universe — shell n + azimuthal slot, matter ridges + noble-gas closure basins + inner manifold spiral
type: constraint
---
Elements (`src/lib/brain/elements.ts`) are baked into the UQRC field as a third structural pin layer alongside Galaxy and Earth.

- **Same rule as everything else in `/brain`**: writes `pinTemplate` only. Never touches `field.axes` directly. The operator's `L_S^pin` term re-asserts pins each tick.
- **Geometry**:
  - n=0: H, single isotropic boundary pin at lattice center (`+0.15`).
  - n=1: Li Be B + He(closure). Ring r=4 m.
  - n=2: Na Mg Al Si P + Ne(closure). Ring r=7 m.
  - n=3: K Ca Sc Ti V + Ar(closure). Ring r=10 m.
  - n=4+: Lanthanide/Actinide subset, tight recursive spiral basin r≈2.5 m near the galactic core.
- **Pin roles**:
  - matter `+0.45` (positive ridge, anisotropic radial outward)
  - closure (noble gas) `-0.6` with wider falloff (anisotropic radial inward — closes the shell loop in the field)
  - inner `+0.7` with tight falloff (recursive basin)
  - boundary `+0.15`, isotropic (no curvature directionality)
- **Determinism**: positions are pure functions of shell + slot + element index. Same on every peer, no network sync needed.
- **Conformance** (`elements.test.ts`): only `pinTemplate`/`pins` writes; commutator norm sampled along shell rings stays bounded after operator ticks; shell counts match the poem; `uqrcConformance.test.ts` and `infinityBinding.test.ts` regressions both pass.
- **Visual** (`ElementsVisual.tsx`): pure presentation — thin emissive shell rings (n=1..3), instanced spheres colored by shell, Drei `<Text>` labels (mobile suppresses non-closure labels), pulsing halo for noble-gas closures, inner manifold rotates slightly faster than galaxy.
- **Why**: structure is curvature. Bodies launched at a shell are deflected by the matter pin's gradient — there is no force code, only `∇u` flowing from the operator.
