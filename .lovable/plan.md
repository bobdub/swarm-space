

## Plan: Run the physics, then let `𝒞_collide` read it

### What's actually broken

`𝒞_collide` is correct. The field it reads is not. `step3D` currently evolves `u` with only:

```text
u_{t+1} = u_t + Δt · ( ν Δu  −  ℛ u  +  κ_pin·mask·(tpl − u)  +  0.01·∂_x u )
```

That is missing three terms the postulate requires for a body to feel weather, weight, and motion:

```text
  − (u·∇)u       advection      ⇒ orbit / wind carry momentum across the lattice
  − ∇P(ρ)         pressure       ⇒ atmosphere resists compression, surface stays solid
  − ∇Φ(ρ_mass)    mass curvature ⇒ Earth bends the field (gravity is the gradient of u)
```

Without these, `‖u‖²` near the Earth surface is flat (just the smoothed pin), so `−∇Π = 0` and bodies neither fall nor get pushed by wind. With these, the basin around Earth is deep and self-maintaining, the atmosphere carries the orbit, and `𝒞_collide` returns a real force the same operator already encodes.

### Add three formal UQRC terms to `step3D`

All three are field-level, not body-level. No new constants outside the existing UQRC source of truth (`FIELD3D_*`). Bodies remain pure samplers.

#### 1. `𝒜_advect` — orbit / wind transport
```text
𝒜_advect(u) := −(u · ∇) u
```
Per axis `a`:  `∂_t u_a += −Σ_μ u_μ · 𝒟_μ u_a`
Implemented in `step3D` using the existing forward-diff `𝒟_μ` already present for the `0.01·drift` line. Replaces that ad-hoc 0.01 with the formal advection of all three axes.
Result: when the Earth pose moves, the surrounding `u` is carried with it instead of being left behind. Apartments don't drift across land because the land's `‖u‖²` carries the same velocity field the apartment sits in.

#### 2. `𝒫_pressure` — exclusion at the field level
```text
Π(u) := exp(κ · ‖u‖² / u_max²)        (same Π as 𝒞_collide — single source)
𝒫_pressure(u) := −∇Π(u)
```
Per axis: `∂_t u_a += −∂_a Π(u)`
This is the field-level twin of `𝒞_collide`. The collide operator on bodies and the pressure operator on the field are the same potential — the body version pushes a sample down the gradient, the field version self-organises so that high-`‖u‖²` regions actively resist further compression. Wind that piles up against a wall (the mantle pin) builds pressure that pushes back — which is exactly the "we collide with high winds" the user named.

#### 3. `𝒢_mass` — gravity as the gradient of `u`, sourced by the pin template
```text
ρ_mass(x) := |pinTemplate(x)|        (mass density = how strongly the cell is pinned)
∇²Φ      = ρ_mass                    (Poisson on the lattice — one Jacobi sweep / tick)
𝒢_mass   := −∇Φ
```
Per axis: `∂_t u_a += −𝒟_a Φ`
A single Jacobi relaxation pass on Φ each tick (cheap at 24³). The Earth's pinTemplate has the largest `|tpl|` so Φ has its deepest well at the Earth — `−∇Φ` is the gravitational acceleration field, and `‖u‖²` deepens around Earth as a result, giving `𝒞_collide` a real basin to find.

### Wiring

- **edit** `src/lib/uqrc/field3D.ts` — extend `step3D` to include the three new terms. Add a single allocation-stable `phi: Float32Array` on `Field3D` for the Poisson sweep. No public API change beyond the new field on the struct (back-compat: ignore on legacy snapshots).
- **edit** `src/lib/brain/collide.ts` — re-export `Π` so the field-pressure term and the body-collide term share one definition. Single source of truth, by construction.
- **edit** `src/lib/brain/uqrcPhysics.ts` — remove `isSurfaceHumanoid` gate around `causalCollide`. With the field actually evolving, every body — Earth-anchored or in deep space — should sample `−∇Π`. The "humanoid only" branch was a workaround for the dead field.
- **add** `src/lib/brain/__tests__/fieldDynamics.test.ts` — three property tests:
  1. **Advection**: inject a bump, set a uniform `u_x = 1`, step N times — bump centre moves +x by `N·Δt`.
  2. **Pressure**: inject a tall bump, step → bump amplitude decays and spreads (pressure pushed outward), `Π_max` strictly decreases.
  3. **Gravity**: pin a dense cluster at lattice centre, step → `‖u‖²` at radius `r` becomes a monotone-decreasing function of `r`, i.e. a real basin.

### Diagnostic readout (uses the existing `𝒞_light` probe)

The Sun→Earth round-trip already runs every 30 ticks. With the three terms wired, the existing HUD line should immediately show:

```text
Sun↔Earth   delay > 0    n_surf > 1    ‖∇u‖_surf > 0
```

If it does, the surface basin is real, `𝒞_collide` returns a non-zero force, and the apartment stays put on land that itself stays put as Earth orbits. If it doesn't, the test suite tells us which of the three terms is silent — no more guessing.

### Validation checklist

- `step3D` now formally implements `𝒪_UQRC = ν Δu − ℛ u + L_S^pin u + 𝒜_advect(u) + 𝒫_pressure(u) + 𝒢_mass(u)`
- `𝒞_collide` and `𝒫_pressure` import the same `Π` — one operator family, two read points
- Removing the `isSurfaceHumanoid` gate does not destabilise deep-space bodies (advection + pressure are bounded by `FIELD3D_BOUND`, gravity well is finite at the lattice scale)
- `?debug=physics` HUD shows non-zero `delay` and `‖∇u‖_surf` at the Earth surface
- Apartment spawned via `SHARED_VILLAGE_ANCHOR_ID` stays under the user as Earth orbits and rotates; user does not sink, does not float, is pushed by mantle ringing the same way they'd be pushed by wind
- All existing tests (`lavaMantle.test.ts`, `lightspeed.test.ts`, `collide` behaviour) continue to pass; new `fieldDynamics.test.ts` passes

