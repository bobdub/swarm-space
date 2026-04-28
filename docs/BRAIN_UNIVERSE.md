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

## Learning ↔ Field coupling

The learning manifold (`src/lib/p2p/patternLearner.ts`,
`src/lib/p2p/languageLearner.ts`, `src/lib/p2p/dualLearningFusion.ts`) sits
on the **same** ring lattice as the neural layer. Behavioural events,
language ingestion, and peer interactions all evolve under one operator.

| Direction | Mechanism |
|---|---|
| Pattern → Field | `PatternLearner.ingestEvent` calls `inject(event.type, { reward, trust })` after every event. Repeated reward-bearing patterns build basins; toxic patterns raise local curvature. |
| Field → Fusion | `DualLearningFusion.computeReward` multiplies engagement by `1 / (1 + getCurvatureForText(event.text))`. Geometric corrosion costs reward. |
| Field → Fusion | `EXPLORATION_RATE` is no longer constant. Derived as `clamp(0.02, 1/(1+λ), 0.25)` from `dominantWavelength`. Turbulent fields explore more; stable fields exploit. |
| Field → Fusion | `selectPattern` collects all matching patterns; if ≥ 2 match it consults `selectByMinCurvature(matches, fe, steps => steps.join(' '))` and picks the lowest-ΔQ one. |
| Language → Field | After each `LanguageLearner.ingestText`, top-16 vocabulary tokens are scanned. Tokens basin-resident for ≥ 3 consecutive ingestions are `pin()`-ed at `1.0`. FIFO cap of 64 prevents lattice saturation. |
| Field → Language | Phrase merges (`PHRASE_MERGE_THRESHOLD = 5`) now require basin membership too: `count ≥ 5 AND isTextInBasin(bigram)`. Cold-start (field not warmed up) falls back to count-only. |

Visibility: `[Learning↔Field] Q=… pinnedTokens=… explore=…` is emitted at
most once every 5 s during generation. All field calls are wrapped in
`try/catch` so an outage never breaks ingestion.

Cross-link: `mem://architecture/neural-network`,
`mem://architecture/uqrc-field-engine`.

## Brain Builder Bar (UQRC-aligned, scaffolding stage)

The Brain Builder Bar is a Sims-style in-world construction dock for
`BrainUniverseScene`. Every placed prefab is a real **UQRC field
entity** — a body sampled from the lattice, written into the pin
template via `pinSupportBasin`, composed of real elements drawn from
`SHELL_DEFS ∪ INNER_SYMBOLS`, and naturally reactive to H₂O
(`sampleLandMask` / `WATER_WADE_DEPTH`), lava
(`sampleMantleRadialAcceleration`), and inhabitants. The Bar is just a
UI lens onto these laws; it never mutates `field.axes`, `body.pos`, or
pin templates directly. Commits flow through
`getBuilderBlockEngine().placeBlock(...)`.

### UQRC anchors

- **Single writer rule.** `builderBlockEngine.ts` is the only caller of
  `physics.addBody` / `removeBody` / `pinSupportBasin` /
  `unpinSupportBasin` for builder content.
- **Curvature is structure.** A wall stands because its
  `pinSupportBasin` writes a co-moving curvature well into the lattice
  every tick — not because of a constant force. `mass` and `basin` come
  from the catalog, derived from real chemistry.
- **Composition is real chemistry.** Every prefab's constituents must
  exist in the periodic table baked into the field. The catalog
  validates this at module load and throws on unknown symbols.
- **Magnetic snap = ‖[D_μ, D_ν]‖ → 0.** "Magnetic" means choosing the
  candidate offset that minimizes the local commutator norm of the
  field at the ghost's centre vs. its neighbours, with right-angle yaw
  alignment as a hard prefilter — the same metric the world already
  trusts for closure quality.
- **Earth-local anchoring.** All offsets are stored as
  `(rightOffset, forwardOffset, yaw)` in the
  `SHARED_VILLAGE_ANCHOR_ID` site frame, so blocks travel correctly
  with Earth's pose and never sink into terrain (`sampleSurfaceLift`
  lift is already applied inside `computeWorldPos`).

### Focus Mode

Toggling Builder Mode (hammer icon in the top HUD cluster) suppresses
navigation overlays — `<DesktopJoystick/>`, `<MobileJoystick/>`,
`<MiniMapHUD/>`, `<RunPill/>` — while keeping **Mic, Camera, and Chat**
active. Avatar movement intent is held while you build. The Bar
broadcasts a `brain-builder-mode` `CustomEvent` with
`{ mode, magnetic }` so other subsystems can respond.

### Prefab catalog (House)

`src/lib/brain/prefabHouseCatalog.ts` declares the initial House set:
granite foundation, concrete floor, limestone / oak walls, oak door,
soda-lime glass pane, terracotta roof. Every prefab derives:

| Field | Source | Notes |
|---|---|---|
| `color` | `blendColor(constituents)` | Shared with `ElementsVisual` |
| `mass` (kg) | `volume · density · 1000` | density g/cm³ |
| `basin` (m) | `(w·d·h)^(1/3) · 0.35`, clamped `[0.18, 0.9]` | Heavier ⇒ wider well |
| `waterResistance` | n=2 oxide closure − soluble alkali | `0..1` |
| `flammability` | (C + H) mass-fraction − mineral mass | `0..1` |
| `shellTags` | Inferred from constituent shells | `n ∈ {0,1,2,3,4}` |

### Scaffolding status

The shipped scaffold provides:

- `prefabHouseCatalog.ts` (validated against `SHELL_DEFS ∪ INNER_SYMBOLS`)
- `useBrainBuilder` hook (`mode`, `magnetic`, section + selection state,
  `brain-builder-mode` event)
- `BuilderActivator` button in the top HUD cluster
- `BrainBuilderBar` dock with section tabs and prefab tiles
- Scene-level focus-mode gating of joystick / mini-map / run pill

Follow-ups (not in this scaffold): translucent `GhostPiece`,
`findMagneticSnap` over `commutatorNorm3D`, `MagneticFieldLines` glow,
commit via `placeBlock`, hover `PlacedBlockEditChip`
(Move / Rotate / Delete / Snap-to-Magnet).

Cross-link: `mem://features/brain-builder-bar`,
`mem://features/virtual-hub-builder`,
`mem://architecture/brain-universe-elements`.

## Application ↔ Field coupling

Beyond the neural and learning layers, the **whole application** now
reports its lifecycle into the same lattice through the App Health Bus
(`src/lib/uqrc/appHealth.ts`). Five subsystems → 1 lattice → 1 Q_Score → 1
badge in the top navigation.

| Subsystem | Surface | Reward |
|---|---|---|
| P2P (`src/lib/p2p/manager.ts`) | onConnection / onDisconnection / onConnectionFailure | +0.5 / -0.2 / -0.3 |
| Storage (`src/lib/storage/providers/index.ts`) | `getProvider` resolution | +0.4 success / -0.4 missing override |
| Streaming (`src/contexts/StreamingContext.tsx`) | joinRoom / leaveRoom / errors | +0.4 / -0.1 / -0.4 |
| Mining (`src/lib/blockchain/mining.ts`) | post-mine accept / propagation block | +0.5 / -0.2 |
| Routing (`src/App.tsx`) | route change + StreamingErrorBoundary | +0.1 / -0.5 |

Inject calls go through `recordAppEvent(domain, key, { reward, trust })`,
which namespaces the field key as `${domain}:${key}` and applies a per-key
250 ms debounce so chatty subsystems can't saturate the lattice. The
`useAppHealth()` hook subscribes at ≤ 1 Hz and powers `AppHealthBadge`
(Q_Score · basin count · λ · trend, with hotspot/coldspot popover).
Throttled console summary: `[AppHealth] Q=… trend=… hotspots=…`.

Cross-link: `mem://architecture/neural-network`,
`mem://architecture/uqrc-field-engine`.
