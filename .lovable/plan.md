

## Periodic Elements as UQRC Shell Pins

Bake the first ~40 elements (H through Kr) into the Brain Universe as a third pin layer alongside Galaxy and Earth. Elements live where the poem says they live: organized by **shell n** (curvature closure level) and **azimuthal slot**, anchored as basin/ridge pins in `pinTemplate`. They are not meshes glued onto the scene — they are real features of `u`, so curvature emerges between shells, noble gases close their shell loops, and the inner manifold (Lanthanide/Actinide) becomes a deeper recursive basin near the galactic core.

This continues the same rule used for Earth, Galaxy, and Infinity: structure is curvature, never a constant force.

### Geometry (shell mapping)

```text
n = 0  Boundary    H            single positive pin at lattice center, no curvature
n = 1  Shell 1     Li Be B  He   ring r=4 m around core, 4 slots, He closes loop
n = 2  Shell 2     Na Mg Al Si P  Ne   ring r=7 m, 6 slots, Ne closes loop
n = 3  Shell 3     K Ca Sc Ti V  Ar   ring r=10 m, 6 slots, Ar closes loop
n = 4+ Inner       La..Lu / Ac..Lr     dense inner spiral basin r=2.5 m near core
```

- Element pins live at world positions `(R_n cos θ, y_n, R_n sin θ)` with deterministic θ per element.
- Boundary layer `H` is a single neutral pin at the absolute center (above the galactic core) — `n=0`, no curvature.
- Each shell ring writes a positive ridge (matter) per element.
- Noble-gas slot in each shell writes a **negative closure pin** — the curvature closure threshold the poem calls out (⧉). This makes the shell a closed loop in the field, not just a circle of points.
- Inner manifold (n≥4) writes a tighter spiral ridge, shorter falloff — a recursive basin where curvature self-spirals.

### Files

**1. `src/lib/brain/elements.ts` (new)**
- `ELEMENT_TABLE: ElementSpec[]` — id, symbol, shell, slot, glyph (`◯ ⋯ ⦿ ⧉`), pinTarget, role (`'matter' | 'closure' | 'boundary' | 'inner'`).
- `SHELL_RADII = [0, 4, 7, 10, 2.5]` and `SHELL_Y_OFFSETS` (slight stagger so shells don't overlap).
- `buildElements(seed)` — deterministic positions; returns `{ elements, innerSpiral }`.
- `applyElementsToField(field, elements)` — writes pins into `pinTemplate` using the same anisotropic recipe as Earth (radial bias so gradients emerge), strength scaled by role:
  - matter: `+0.45`
  - closure (noble): `−0.6` and a wider falloff to enforce shell-loop curvature
  - inner: `+0.7` with tight falloff
  - boundary H: `+0.15`, no radial bias
- Mirrors into `field.pins` sparse map for serializer parity (same pattern as galaxy).

**2. `src/lib/brain/galaxy.ts`**
- No change to galaxy pins. Just call `applyElementsToField` after `applyGalaxyToField` from the same init site.

**3. `src/pages/BrainUniverse.tsx`**
- After `applyGalaxyToField(field, galaxy)` add `applyElementsToField(field, getElements())`.
- Pass elements to a new `<ElementsVisual />` for rendering.
- `?debug=physics` overlay gains one row: "elements pinned: N (shells 0..4)".

**4. `src/components/brain/ElementsVisual.tsx` (new)**
- Renders ring orbits (thin emissive circles for shells 1–3) so the shells are visually legible.
- Each element: instanced sphere colored by shell (n=0 white, n=1 cyan, n=2 violet, n=3 amber, n≥4 magenta).
- Symbol label as a Drei `<Text>` floating above each pin (mobile: hide labels for shells with > 6 elements; show only on hover/proximity).
- Inner manifold: rotating cluster of small instanced points around the core, slightly faster than galaxy rotation.
- Noble-gas closure points get a soft pulsing halo to read as "shell closed" — purely visual, driven by `useFrame` sin wave.

**5. `src/lib/brain/infinityBinding.ts`**
- Add `nudgeInfinityToward(centroidOfShell(n))` option so high creativity drifts Infinity through shells (poetic, optional). Off by default; gated behind a feature flag.

**6. Tests — `src/lib/brain/__tests__/elements.test.ts` (new)**
- Determinism: same seed → identical element coordinates across two builds.
- Conformance: `applyElementsToField` only writes `pinTemplate` / `field.pins`, never `field.axes`.
- Closure: after 200 ticks, commutator norm sampled along a shell ring stays bounded < 1.5 (UQRC regularity preserved).
- Shell counts: shell 1 has 4 elements, shell 2 has 6, shell 3 has 6, n=0 has 1, inner spiral has ≥ 14.
- Existing `uqrcConformance.test.ts` and `infinityBinding.test.ts` still pass — no axes mutation, no Newtonian shortcuts.

**7. Memory**
- New file `mem://architecture/brain-universe-elements`: *"Elements are a third pin layer in `pinTemplate`, organized by shell n and azimuthal slot. Matter pins are positive ridges; noble-gas slots are negative closure pins that loop the shell. Inner manifold (n≥4) is a tight recursive basin near the core. Same rule as Galaxy/Earth/Infinity: never write `field.axes`, structure is curvature."*
- Append a one-liner to `mem://architecture/brain-universe-physics` cross-linking the elements layer.

### Acceptance

```text
1. /brain renders 4 visible shells (n=0 H at center, n=1/2/3 rings, n=4+ inner spiral) plus existing galaxy and Earth.
2. Elements appear at deterministic positions across reloads and across two browsers (same seed).
3. Noble gases (He, Ne, Ar) sit in their shell's closure slot with a soft pulsing halo.
4. applyElementsToField only touches pinTemplate / field.pins — grep confirms zero writes to field.axes.
5. Commutator norm stays bounded < 2.0 over 1000 ticks with elements active (uqrcConformance test extended).
6. ?debug=physics overlay shows the new "elements pinned" row and Q_Score remains stable.
7. Mobile (360×560): rings legible, labels suppressed except for boundary H and noble-gas closures, ≥ 30 fps.
8. Bodies launched at a shell ridge get deflected by the matter pin's gradient — observable in physics overlay (gradient magnitude rises near shells).
9. Infinity, Earth, galaxy, and round-universe behaviour all unchanged (regression test suite green).
10. Memory rule recorded; cross-link added to brain-universe-physics.
```

