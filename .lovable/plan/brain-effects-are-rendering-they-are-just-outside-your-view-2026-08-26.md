# Brain effects are rendering — they are just outside your view

I re-checked the code with the assumption that you did hold an axe and swing it. The layers are all mounted in `BrainUniverseScene.tsx:2056-2059` and `nature/NatureLayer.tsx`, the build is clean, and 214 tests pass. The problem is geometry and thresholds, not wiring.

## What the numbers say

**The axe is below the camera frustum.**
The eye sits at `bodyPos + up × EYE_LIFT` (0.75 m above body centre). `HeldToolMesh` puts the tool at body centre `+0.55 m` forward, `−0.25 m` down, `+0.42 m` right. Relative to the eye that is ~1.0 m below and 0.55 m ahead — about 61° below the horizon, while the camera is a 60° fov (30° half-angle) looking at the horizon. The tool renders every frame and is never on screen unless you stare at your feet.

**The swing FX are the same size as a dinner plate and last 320 ms.**
`resolveSwingProbe` emits a ring of radius `max(0.42, ∛mass × 0.72)` ≈ 0.4–0.8 m, impact rings 0.28–0.5 m, for 320/760 ms, at the target point. On a 360 px phone at eye height that is a few pixels of thin translucent line. The particle burst sizes (0.06–0.11 m) are smaller still.

**Clouds are placed by a site anchor, which is not UQRC.**
`tickWeather` calls `getEarthLocalSiteFrame('swarm-shared-village')` and spawns clouds at a random arc 60–280 m from it, with `Math.random()` headings and a scalar global `humidity`. That is a hand-placed simulation sitting beside the field, not a trace of it — exactly the thing the `/brain` rule forbids. It is also why the sky is empty: nothing spawns where you are, and the first cloud needs ~33 s of humidity accumulation plus ~14 s of charge.

**Digging needs a dig-capable tool on bare ground.** An axe resolves `chop`, which `actionMatchesTarget` only accepts for shells n=1–2, and only bare dry ground resolves to a `shell` target at all. Everything else silently returns a `surface` target, so no pit, no `cell-carved`, no `CarvedCellsLayer` geometry.

## Changes

### 1. Put the tool in frame
- Reposition `HeldToolMesh` relative to the **eye**, not the body centre: roughly `eye + forward 0.62 + right 0.34 − up 0.34`, and scale it up ~1.6× so it reads like a first-person held item.
- Add a mild idle bob and keep the existing swing pivot animation.
- Verify with a Brain screenshot at default pitch that the axe head is visible in the lower-right of the viewport before calling it done.

### 2. Make impacts unmistakable
- Raise swing/impact ring radii ~2.5× and lifetime to ~600/1100 ms, add a bright expanding shockwave disc on a successful cut.
- Scale the particle bursts to match (size ×2, spread ×1.4) and add a short-lived scorch/notch decal at the hit point so evidence persists a couple of seconds.
- Emit an FX even on a rejected swing (dull/wrong-tool) so a miss is still visible feedback rather than silence.

### 3. Weather as a field observable — no anchors, no random placement

Rewrite `weather.ts` so cloud state is *read out of the operator field*, never authored:

- **Humidity becomes a field quantity, not a global scalar.** Evaporation writes into the field: sun-lit ocean/shore cells call `injectAt` on the reward/context axes with an amplitude set by `sunDot × waterFraction`. The atmosphere no longer has a private counter — the moisture *is* `u`.
- **Condensation nucleates at field extrema.** Each 1 Hz tick samples the field over the lit hemisphere and forms a cloud where the sampled scalar exceeds its neighbourhood *and* `‖∇∇S(u)‖` marks a local entropy-curvature well — the minimum-curvature selection the engine already uses for language (`selectByMinCurvature`). Clouds appear wherever the field says condensation is cheapest, which may be over ocean, over the volcano, or nowhere.
- **Drift is the gradient, not `Math.random()`.** A cloud's per-tick motion is `Σ_μ 𝒟_μ u` projected onto the local tangent plane; heading jitter is removed entirely. Charge integrates the sampled amplitude; rain begins when the well deepens past closure and ends when the gradient flattens.
- **Rain is the back-reaction.** Precipitation subtracts from the field at the cloud site and adds wetness to the ground cell, so `weatherCurvatureBoost` and the harder-to-dig soil are consequences of the same `u`, not a parallel bookkeeping.
- **Visibility follows from physics, not from seeding.** Because evaporation injects wherever the player actually is (the lit ocean under them is a real source), storms form near the player without any anchor. Cloud radius/puff count scale with the sampled well depth so a strong basin reads clearly on a phone screen.

Conformance: no constants outside the operator, no writes to `field.axes`, bounded by the existing `FIELD3D_BOUND` clamp. `WEATHER_ANCHOR_ID` is deleted.

### 4. Make digging reachable
- Allow `dig` and `chop` on n≤2 shells (axe can break sod), and resolve `shell` targets for any bare ground under the reticle, not just dry ground.
- Show the shell name and depth on the ground reticle when a tool is held, so you can see "Grass (n=1) · 0.0 m" before swinging and watch it change as the pit deepens.
- Deepen the first cut visually: `DIG_STEP_M` per swing with pit walls banded by shell colour, as already implemented in `CarvedCellsLayer`.

### 5. A visible lava floor check
- Confirm `VolcanoLavaPool` renders at the crater radius with a screenshot; if it sits below the displaced crater floor, raise it to the sampled surface lift like the other surface layers do.

### 6. Verification, not assumption
- Drive the Brain with Playwright at your viewport (360×565), equip a tool, swing, and capture screenshots for: tool in hand, impact burst, a dug pit, and a cloud. Nothing gets reported as fixed without a frame showing it.
- Add tests for the weather state machine (evaporate → condense → rain → curvature injection stays inside `FIELD3D_BOUND`) and the shell branch of `applyImpact`.

## Technical notes

- All changes are placement, scale, threshold, and gating — no new forces, no writes to `field.axes`, so the `/brain` gradient-only rule holds.
- Weather still perturbs the field only through `injectAt`.
- Carved cells keep their existing throttled `localStorage` persistence; sharing digs across peers is a separate follow-up.
