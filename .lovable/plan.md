

## Plan: introduce the Causal Conversion Operator `𝒞_light` and use it to diagnose why surface bodies still float

### What this is

You asked for a real measurement, not another tuning pass. We add the lightspeed operator as a first-class UQRC primitive and fire it Sun→Earth→Sun through the live field. The round-trip delay it returns is the **direct, falsifiable readout** of whether the local geometric pull at Earth's surface is real or zero.

```text
𝒞_light(Δt) := c · Δt          (causal conversion: time → length)
ℓ_min      = 𝒞_light(Δt_min)   (closure: lattice cell = c · tick)

Probe:
  ray = Sun.pos → Earth.surface → Sun.pos
  Δt_flat   = |ray| / c                                  (Euclidean baseline)
  Δt_actual = Σ over ray segments: ds / (c · n(u(x)))    (field-modulated)
  delay     = Δt_actual − Δt_flat                        (≥ 0 ⇒ geometric pull)
```

If `delay ≈ 0` at the Earth surface, the field there is flat — that is *exactly* why bodies do not fall. The operator turns "things float" from a vibe into a number we can fix against.

### Implementation

1. **New module `src/lib/brain/lightspeed.ts`** — the operator and its probe.
   - `C_LIGHT` constant in sim units (`= WORLD_SIZE / (FIELD3D_N · TICK_DT)` so `ℓ_min = 𝒞_light(Δt_min)` holds by construction — closure relation honoured).
   - `causalConvert(dt)` → `c · dt` (the literal operator).
   - `refractiveIndex(field, x)` → `1 + κ · |u(x)|` where `u` is sampled from the field. This is how `pinTemplate` curvature shows up as optical-path delay; flat field ⇒ `n = 1` ⇒ no delay.
   - `traceCausalRay(field, from, to, samples)` → integrates `Σ ds·n / c` along the segment.
   - `sunEarthRoundTrip(field)` → returns `{ flatDt, actualDt, delay, surfaceN, surfaceGradMag }` using `SUN_POSITION` and the Earth surface point closest to the Sun (read from `getEarthPose()`).

2. **Wire into the physics tick as a diagnostic, not a force.**
   - In `src/lib/brain/uqrcPhysics.ts`, every N ticks (cheap) call `sunEarthRoundTrip(this.field)` and stash the result on the singleton (`this.lastCausalProbe`).
   - Pure read. No body update changes. The operator is an observer.

3. **Expose the readout.**
   - Add `getLastCausalProbe()` export on `uqrcPhysics.ts`.
   - Add a debug overlay line in the existing `?debug=physics` HUD (search for the existing physics debug panel) showing:
     ```
     Sun↔Earth  flat=… s   actual=… s   Δ=… s   n_surf=…   |∇u|_surf=…
     ```
   - This is the falsifiable number. If `Δ` is ~0 and `|∇u|_surf` is ~0, the surface field is flat and we know precisely why nothing falls — and we know the next fix has to deepen `pinTemplate` curvature at `r ≈ EARTH_RADIUS`, not tune another scalar.

4. **Conformance test `src/lib/brain/__tests__/lightspeed.test.ts`.**
   - Closure: `C_LIGHT * TICK_DT ≈ ℓ_min` (one cell).
   - Identity: empty field ⇒ `delay === 0`, `actualDt === flatDt`.
   - Curvature: with the lava-mantle pin active, the ray crossing the Earth basin returns `delay > 0` and `n_surface > 1`. If this test fails, the surface basin is genuinely flat at the lattice scale — which is the real bug behind the floating, and the test will pin it down.

5. **No physics rewrites in this step.** The operator is added, the probe runs, the HUD shows the number. Once we can read `delay` and `|∇u|_surf` live, the *next* change (deepening the surface basin amplitude / sharpening `pinTemplate` at `r=EARTH_RADIUS`) becomes a measured fix instead of another guess.

### Files to add / change

- **add** `src/lib/brain/lightspeed.ts`
- **add** `src/lib/brain/__tests__/lightspeed.test.ts`
- **edit** `src/lib/brain/uqrcPhysics.ts` — call probe every N ticks, expose `getLastCausalProbe()`
- **edit** the existing physics debug overlay (the component reading `?debug=physics`) — render the round-trip line

### Technical details

```text
ℓ_min      = WORLD_SIZE / FIELD3D_N            (one lattice cell, ~531 m)
Δt_min     = lattice tick interval             (the integrator's dt)
C_LIGHT    = ℓ_min / Δt_min                    (closure: 𝒞_light(Δt_min) = ℓ_min)

n(x)      := 1 + κ · |u(x)|                    (κ small, e.g. 1.0; field-coupled)
ray       := from = SUN_POSITION,
             to   = pose.center + (SUN−pose.center)/|…| · EARTH_RADIUS
Δt_actual := Σ_i (ds_i · n(x_i)) / C_LIGHT     (forward + return)
delay     := Δt_actual − 2·|ray|/C_LIGHT
```

```text
Expected readouts:
  • Empty space:        delay = 0,  n_surf = 1.0,  |∇u|_surf = 0
  • Healthy basin:      delay > 0,  n_surf > 1.0,  |∇u|_surf > 0   ⇒ bodies fall
  • Current bug state:  delay ≈ 0,  n_surf ≈ 1.0,  |∇u|_surf ≈ 0   ⇒ bodies float
```

### Validation checklist

- `C_LIGHT · TICK_DT === ℓ_min` (closure relation enforced by test)
- `causalConvert(0) === 0`, `causalConvert(Δt_min) === ℓ_min`
- Sun→Earth→Sun probe returns a finite `delay ≥ 0` every tick
- `?debug=physics` overlay shows the live round-trip line
- Reading `delay` and `|∇u|_surf` at the surface gives us the diagnostic that drives the next, measured fix to the floating bug — no guessing

