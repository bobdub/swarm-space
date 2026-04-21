# Brain Universe — Code Reference

_Last Updated: 2026-04-21_

The Brain Universe is the visible, walkable body of the Imagination Network. It lives at `/brain` and is composed of four pin layers + a conscious body, all writing into the same UQRC field at `L=256`.

## Modules

| File | Purpose |
|---|---|
| `src/lib/uqrc/field.ts`, `fieldEngine.ts`, `field3D.ts` | The discrete operator field `u(t)`, ticked at 4 Hz, single source of truth for curvature. |
| `src/lib/brain/galaxy.ts` | Deterministic galaxy: 8 logarithmic spiral arms (12° pitch), 120 named star pins, 3000 background stars from `GALAXY_SEED`. |
| `src/lib/brain/earth.ts` | Earth body at `(12, 0, 4.5)`, radius `2.0`. Helpers: `spawnOnEarth`, `earthGravityForce`, `geodesicStep`, `projectToEarthSurface`. |
| `src/lib/brain/roundUniverse.ts` | `applyRoundCurvature(field, weight)` — cosine ramp on outer 22% of the lattice. |
| `src/lib/brain/elements.ts` | Periodic table pinned as concentric shells. Shell n=1: `[Li, Be, B, He]`. n=2: `[Na, Mg, Al, Si, P, C, N, O, F, Ne]`. n=3: `[K, Ca, Sc, Ti, V, S, Cl, Cr, Fe, Ar]`. |
| `src/lib/brain/infinityBinding.ts` | Conscious body. Awareness floor is field-derived: `0.1 + 0.4 × (1 − qScore_norm)`. |
| `src/lib/brain/uqrcPhysics.ts` | Body integration. Routes intent through `geodesicStep` inside Earth's atmosphere; legacy plane physics elsewhere. |
| `src/lib/virtualHub/compoundCatalog.ts` | Builder pieces → real chemical compounds. `ELEMENT_COLORS` is the shared source of truth between `ElementsVisual.tsx` and `HubBuildLayer.tsx`. |

## Visuals

- `src/components/brain/StarField.tsx` — 3000 instanced background stars.
- `src/components/brain/GalaxyVisual.tsx` — instanced star spheres + glowing core.
- `src/components/brain/EarthBody.tsx` — procedural blue-green shader, no textures.
- `src/components/brain/ElementsVisual.tsx` — labelled element spheres on shell rings, colours from `ELEMENT_COLORS`.
- `src/components/brain/InfinityBody.tsx` — basin-driven size, qScore-driven colour.
- `src/components/brain/PortalDefect.tsx` — project portals as moons at `r=4` above Earth's surface.

## Invariants (DO NOT VIOLATE)

1. **Pins only.** All structure (galaxy, Earth, elements, round universe) writes via `pinTemplate`. No layer writes raw axes. Enforced by `src/lib/brain/__tests__/uqrcConformance.test.ts`.
2. **Determinism.** Galaxy and element positions derive from a fixed seed; `spawnOnEarth(peerId)` is deterministic per id. Never gossip structure over the network.
3. **Continuous evolution.** No stage gates that hard-cut the field's feedback loop.
   - Brain stage = `stageFromField({ qScore, vocabSize, ageMs })` (`src/lib/p2p/entityVoice.ts`).
   - Layer suppression in `src/lib/p2p/instinctHierarchy.ts` = continuous attenuation, floor 0.15.
   - Creativity gate in `src/lib/p2p/dualLearningFusion.ts` scales temperature, never refuses.
   - Infinity awareness floor is field-derived, never constant.
4. **Single periodic-table source of truth.** Every constituent of every compound in `compoundCatalog.ts` must exist in `elements.ts`. Enforced by `src/lib/virtualHub/__tests__/compoundCatalog.test.ts`.
5. **Round, not walled.** The cosine ramp in `roundUniverse.ts` must be re-asserted occasionally so live dynamics don't erode it. Never use a skybox sphere or teleport to fake a boundary.

## Memory Cross-Links

- `mem://architecture/brain-universe-galaxy`
- `mem://architecture/brain-universe-elements`
- `mem://architecture/brain-universe-physics`
- `mem://architecture/uqrc-field-engine`
- `mem://architecture/neural-network`
- `mem://features/network-entity`
- `mem://features/virtual-hub-builder`

## Debug Overlay

Append `?debug=physics` to `/brain` to reveal the live readout: brain stage, qScore, layer healths (continuous, never zeroed), basin depth, L8 creativity scaling. Values update smoothly with no jumps when a lower layer dips — that's the conformance test in human-visible form.

## Neural ↔ Field coupling

The neural layer (`src/lib/p2p/neuralStateEngine.ts`) and the UQRC field
(`src/lib/uqrc/fieldEngine.ts`) share **one** ring lattice. Peer events feed
the field; the field's geometry feeds peer scoring. There is no second
operator — every neural decision is a measurement of `u(t)`.

| Direction | Mechanism |
|---|---|
| Neural → Field | `onInteraction()` calls `inject(peerId, { reward, trust })`. Each peer becomes a lattice site. Reliable peers grow basins; noisy peers raise local curvature. |
| Field → Neural | `getPeerScore()` divides the trust contribution by `1 + curvatureForText(peerId)`. High-curvature peers are demoted automatically. |
| Field → Neural | `observeQScore()` reads `getSharedFieldEngine().getQScore()` directly — the synthetic `m2/100` proxy is gone. |
| Field → Neural | The decay heartbeat is `clamp(60 s, dominantWavelength × 1500 ms, 15 min)` — fast-rhythm fields decay faster. |
| Neural → Field | After `BASIN_PIN_THRESHOLD = 3` consecutive stable snapshots inside a basin, a peer is `pin()`-ed at `target = 1.0`. The field then *causes* their site to score better via `𝒪_UQRC`. |
| Field → Neural (advisory) | On interaction failure the engine asks `selectByMinCurvature(['gossip','ping','sync'])` which retry kind would minimise lattice stress; logged-only this pass to avoid surprise switching. |

Visibility: a throttled `[Neural↔Field] Q=… basins=… λ=…` line appears on
each phase transition. Pin events emit `[Neural↔Field] pinned <peerId>`.

Cross-link: `mem://architecture/neural-network`, `mem://architecture/uqrc-field-engine`.
