

## Bind every universe body to chemistry

Right now the periodic table (`elements.ts`) and compound catalog (`compoundCatalog.ts`) only bind **builder pieces** and **nature/mountain/volcano props**. The cosmic + geological backbone — **Sun, Moon, galactic core, named stars, atmosphere, water, and the volcano vent itself** — render and exert curvature without any declared composition. This plan makes every body in the universe a member of one shared chemistry registry, so colour, density, and (where it matters) field coupling all derive from real constituents.

### Scope

```text
Currently bound:                    To bind in this plan:
  • builder pieces (compoundCatalog)  • Sun        (H, He plasma)
  • flora (grass/tree/flower)         • Moon       (Si, O, Fe, Mg regolith)
  • fauna (fish/bee/queen/hive)       • Galactic core (Fe, Ni, dense)
  • mountain (basalt-ish)             • Named stars (H/He w/ metallicity)
  • volcano *prop* (basalt)           • Atmosphere (N, O, Ar, C)
                                      • Water bodies (H, O)
                                      • Volcano vent outflow (S, O, C, H — gas)
```

### Steps

1. **New shared registry: `src/lib/brain/cosmoChemistry.ts`**
   Single source of truth for non-builder bodies. Exports `COSMO_COMPOUNDS` keyed by body kind (`sun`, `moon`, `galactic_core`, `star_main_sequence`, `atmosphere`, `water`, `vent_gas`) with `{ name, formula, constituents, color, density }`. Colours flow through the existing `blendColor()` so the palette stays unified. Constituents reference symbols already in `SHELL_DEFS` (no new elements needed — `S`, `Cl`, `Fe`, `Ni` placeholder via `Fe`, etc.).

2. **Wire the celestial visuals**
   - `GalaxyVisual.tsx` — read core colour from `COSMO_COMPOUNDS.galactic_core`; per-star tint from `star_main_sequence` blended with brightness (hot = more H/He white, dim = redder).
   - `EarthBody.tsx` / `AtmosphereSky.tsx` — atmosphere shader tint pulled from `COSMO_COMPOUNDS.atmosphere.color` instead of the hard-coded sky blue.
   - Sun light + Moon material — colour derived from compound, not literal hex. (Sun light intensity unchanged; only the colour input.)

3. **Bind the volcano vent to vent-gas chemistry**
   Extend `VolcanoOrgan` (`volcanoOrgan.ts`) with a `ventCompound` field referencing `vent_gas` (SO₂/CO₂/H₂O blend). `lavaMantle.ts`'s `sampleVentOutflow` already returns a scalar — expose a parallel `sampleVentEmission()` that returns `{ rate, compound }` so the renderer can colour the plume from the compound and the HUD can read out "venting SO₂ + H₂O" instead of just "pressure: 0.7".

4. **Bind water to H₂O**
   `surfaceProfile.ts`'s water rendering (currently a flat blue tint) reads its colour from `COSMO_COMPOUNDS.water` so the ocean is literally H₂O blended.

5. **Conformance test: `src/lib/brain/__tests__/chemistryCoverage.test.ts`**
   Enumerate every "body" producer in `/brain` (Galaxy stars, Earth, Moon, Sun, atmosphere, water, mantle vent, nature, builder pieces) and assert each has a non-empty `constituents` whose every symbol is present in `SHELL_DEFS ∪ INNER_SYMBOLS`. This is the lock that prevents future bodies from sneaking in chemistry-free.

6. **Docs touch-up**
   Add a one-paragraph note to `mem://architecture/brain-universe-elements` saying "every visible body in `/brain` resolves through one of two compound registries: `compoundCatalog` (builder) or `cosmoChemistry` (cosmic + geological)."

### Technical details

- **No field-engine changes.** Cosmo-chemistry is colour + metadata only; UQRC pins, mantle bands, vent geometry, and `pinTemplate` writes all stay byte-identical. Galaxy/Earth/Elements pin amplitudes are unchanged.
- **No new elements.** Everything resolves against the symbols already in `SHELL_DEFS` (H, He, C, N, O, F, Ne, Na, Mg, Al, Si, P, S, Cl, K, Ca, Sc, Ti, V, Cr, Fe, Ar) plus the inner manifold. Sun = H + He; Moon regolith = Si + O + Fe + Mg + Al + Ca; galactic core = Fe + Ni-as-Fe-proxy + Cr; atmosphere ≈ N₂ + O₂ + Ar + CO₂; vent gas ≈ H₂O + CO₂ + SO₂; water = H₂O.
- **Star tinting** uses the existing `brightness` field as a mix factor between the main-sequence H/He blend and a dim-star Fe-tinted tone — purely a render-time lerp.
- **Determinism preserved.** All chemistry is static data; no PRNG, no time term — same as the current compound table.
- **Tests updated:** `uqrcConformance` and `infinityBinding` regressions stay untouched (no pin behaviour changes). New `chemistryCoverage` test is the only addition.

### Files

- New: `src/lib/brain/cosmoChemistry.ts`, `src/lib/brain/__tests__/chemistryCoverage.test.ts`
- Edit: `src/components/brain/GalaxyVisual.tsx`, `src/components/brain/AtmosphereSky.tsx`, `src/components/brain/EarthBody.tsx`, `src/lib/brain/volcanoOrgan.ts`, `src/lib/brain/lavaMantle.ts` (add `sampleVentEmission`), `src/lib/brain/surfaceProfile.ts` (water colour wire), `mem://architecture/brain-universe-elements.md`

