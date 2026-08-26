# Brain Effects: Tools, Digging, Weather, Lava

Six gaps, all confirmed in the current code. Each is fixed in its own module so nothing else in the Brain destabilises.

## What is actually missing today

- `emitCellCarved` in `src/lib/brain/sculpting.ts` has **no emitters and no subscribers** — carving a planet shell never happens and is never drawn.
- `ToolTarget` (`src/lib/world/toolTargets.ts`) only resolves placements, nature blocks, and water surface. There is **no shell target**, so earth layers can never be dug or verified.
- The held tool exists only as a 2D chip (`HeldToolHUD.tsx`). Avatars (`InfinityBody.tsx`, `RemoteAvatarBody.tsx`) render no tool mesh.
- Swing feedback is one generic ring (`ToolSwingFX.tsx`) — no chips, no chopping, no petal pickup.
- There is **no weather module** anywhere in `src/lib` — no evaporation, clouds, or rain.
- The volcano renders crater glow + plume only (`NatureLayer`, `EarthBody` displacement). No lava pool surface.

## Phase 1 — Tool visuals

- **Tool in hand**: a small `HeldToolMesh` group parented to the avatar, built from the prefab's colour/dimensions, with a short swing animation triggered off `swingFxBus`. Both self and remote avatars read `heldToolStore`, so peers see each other's tools.
- **Per-material impact FX**: extend `swingFxBus` with a `material` tag (`wood`, `stone`, `soil`, `flora`, `water`). `ToolSwingFX` renders matching short-lived particles — wood chips, stone sparks, soil clods, petals lifting, water splash — instead of one generic ring.
- Chop progress: a tree/block below full durability shows a visible notch decal and shakes on hit, then falls (tips over, fades) instead of vanishing.

## Phase 2 — Digging and earth layers

- New `shell` variant in `toolTargets`: when the cursor/reach hits bare ground, resolve the shell via `sampleShellAt` and pass it to the existing `applyImpact` predicate (already supports `kind: 'shell'`).
- On a successful cut, emit `cell-carved` (finally wiring the existing bus) and record the carved cell in a new `carvedCellsStore` (IndexedDB, throttled writes, same pattern as world placements).
- New `CarvedCellsLayer` renders each carved cell as a recessed pit whose inner walls are tinted with the shell's element colour, so digging **shows** the n=0→1→2 stratigraphy. Digging deeper in the same cell steps to the next shell and changes the colour band.
- The dug shell label + element symbols surface briefly in the swing toast, which is the verification the layers exist.
- Sharpness/lava rejections already return reasons — surface them as the impact label (`too dull`, `lava burns tool`).

## Phase 3 — Water cycle and weather

New `src/lib/world/weather.ts` driven off the UQRC field, ticked at low frequency (1 Hz), pure state, no per-frame work:

- **Evaporate**: sun-facing ocean/shore cells feed a humidity scalar.
- **Condense**: humidity above threshold spawns cloud cells with a position drifting on the field's context axis.
- **Rain**: clouds over threshold precipitate, decrementing humidity; rain lands as short falling streaks plus splash ripples on the ground, and wets nearby cells (a `wetness` value that raises soil density, so digging wet ground is harder — the loop that makes weather matter to UQRC).
- Renderer: `WeatherLayer` with instanced cloud puffs and a capped instanced rain mesh near the player only, fading with `horizonFade`.

## Phase 4 — UQRC instability from environment

Weather feeds back into the field so the system is no longer artificially calm:

- Rain, wind, and vent emission inject curvature into the field (`inject3D`) at their locations, raising local `||[D_μ,D_ν]||`.
- `sampleSwingAt` already reads curvature load — so swinging in a storm is measurably harder, and the App Health badge's Q_Score visibly moves with weather instead of staying flat.
- Bounds are enforced by the existing `FIELD3D_BOUND` clamp and covered by the existing conformance test, so instability stays finite.

## Phase 5 — Volcano lava floor

- Add a lava pool disc inside the crater at the vent radius from `volcanoOrgan`, using an animated emissive shader (flow noise, crust cracks brightening with `getMantlePressure()`).
- Lava rim glow lights nearby geometry; standing too close pushes heat FX; `applyImpact` already returns `lava_burns_tool`, now shown with a burn effect.

## Technical notes

- All new render layers mount inside the existing Brain scene, are frustum/distance culled, and use instanced meshes — no new per-frame allocations, in line with the project's browser-performance constraint.
- Carved cells and weather state persist non-destructively (throttled IndexedDB writes, new stores, no schema deletion).
- Carved cells broadcast through the existing `p2pPlacementBridge` gossip path so digs are shared, last-writer-wins.
- No changes to `applyImpact`'s predicate maths — it already handles shells; we only start calling it and start drawing the result.

## Suggested order

Phase 1 and 2 first (visible tool + dig feedback), then 5 (lava, self-contained), then 3 and 4 together (weather is only meaningful once it perturbs the field).
