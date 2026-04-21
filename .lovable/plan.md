

## Brain Universe Physics — UQRC Inspection & Conformance Pass

This is an inspection + remediation plan, not a feature request. Goal: audit `/brain` so the entire physics layer is governed by the four UQRC postulates (commutation = curvature, smooth evolution, minimal structure, light-as-causal-conversion) and *nothing else*. The visual interface is allowed to render, but it must never decide motion. Today, several layers cheat — they apply ad-hoc forces (gravity constants, surface stiffness springs, mass multipliers, snap-to-surface clamps) that bypass `𝒪_UQRC` and `[𝒟_μ, 𝒟_ν]`. We tear those out and re-express each as a curvature term in the field.

### Inspection findings (current code)

| File | Violation | UQRC reading |
|---|---|---|
| `src/lib/brain/earth.ts` | `EARTH_GRAVITY` constant; `EARTH_SURFACE_STIFFNESS` Hooke spring; `projectToEarthSurface` hard-clamps position. | Forces injected outside `𝒪_UQRC`. Position writes break `u ∈ C^∞`. |
| `src/lib/brain/uqrcPhysics.ts` | Manual velocity zeroing along the surface normal; mass × curvature multiplier applied as a Newtonian force. | Decision system outside the operator. Kills smooth evolution. |
| `src/lib/brain/roundUniverse.ts` | Cosine ramp written *additively per tick* into `field.axes`. | Mutates `u` outside `𝒪_UQRC`; not a pin, not an operator term. |
| `src/lib/brain/galaxy.ts` | Star pins written into `field.axes` directly each apply call. | Same — should be a `pinTemplate` consumed by `𝒪_UQRC`, never overwritten in. |
| `src/lib/uqrc/field3D.ts` | `step3D` folds in `κ_galaxy * (template − u)` *after* the operator step. | Two-step update breaks `[𝒟_μ, 𝒟_ν] ≈ 0` guarantee. Must be inside `L_S u`. |
| `src/pages/BrainUniverse.tsx` | Camera offsets player by `eye = 1.6` along the Earth normal — implicitly assumes a flat tangent decision, not a geodesic. | Visual cheat. Acceptable only if it never feeds back into physics (currently it doesn't, but verify). |
| `src/components/brain/EarthBody.tsx` & `GalaxyVisual.tsx` | Fine — render-only, sample the field. | Conformant. |

### Remediation — one principle per change

Everything below restates a current ad-hoc force as a term inside the master equation:

```text
u(t+1) = u(t) + 𝒪_UQRC(u(t)) + Σ_μ 𝒟_μ u(t) + λ(ε₀) ∇_μ∇_ν S(u(t))
𝒪_UQRC(u) = ν Δu + ℛ u + L_S u
```

**1. `src/lib/uqrc/field3D.ts` — make `pinTemplate` a real operator term**
- Move the `κ_galaxy * (template − u)` fold *into* `L_S u`. Define `L_S u := L_S^free u + κ_pin (template − u)` so the pin is part of the single operator, not a post-hoc patch. One update, smooth, commutator-preserving.
- Compute and expose `commutatorNorm(u)` = discrete `‖[𝒟_μ, 𝒟_ν] u‖` per tick. Surface it on the Quantum panel as the curvature observable. This *is* `F_{μν}`.
- Enforce `ℓ_min` and `Δt_min` as named constants used everywhere; remove magic numbers in physics files.

**2. `src/lib/brain/roundUniverse.ts` — boundary as curvature, not as force**
- Bake the cosine ramp into `pinTemplate` once at field init (and on lattice resize). Never write to `field.axes` from this file again.
- The "round universe" then emerges automatically: it's just the boundary contribution to `[𝒟_μ, 𝒟_ν]`. Trajectories curve back because the local commutator is non-zero near the shell — exactly the postulate.

**3. `src/lib/brain/galaxy.ts` — same treatment**
- `applyGalaxyToField()` writes the spiral arms, core basin, and Earth pin into `pinTemplate` once. After that, `𝒪_UQRC` re-asserts them every tick via `κ_pin (template − u)`. No per-frame writes to `field.axes`.
- Determinism preserved (same seed → same template).

**4. `src/lib/brain/earth.ts` — gravity as curvature, surface as basin floor**
- Delete `EARTH_GRAVITY`, `EARTH_SURFACE_STIFFNESS`, `projectToEarthSurface`.
- Earth is already a deep pin in the template at `EARTH_POSITION`. Make it deep enough (single tunable `EARTH_PIN_AMPLITUDE`) so the field gradient `Σ_μ 𝒟_μ u` near Earth pulls bodies inward. That gradient *is* gravity. No constant, no spring.
- Replace `geodesicStep` with a single function that returns the local field gradient at the body's position; the body integrator already adds `Σ_μ 𝒟_μ u` to motion, so walking-along-tangent emerges from the gradient being mostly tangential at the surface basin's lip.
- Keep `spawnOnEarth(peerId)` — placement is allowed (it's an initial condition, not a force).

**5. `src/lib/brain/uqrcPhysics.ts` — bodies as samples, not as decisions**
- Body update becomes literally:
  ```ts
  // ℓ_min, Δt_min from field3D
  const grad = sampleGradient(field, body.pos);          // Σ_μ 𝒟_μ u
  const lap  = sampleLaplacian(field, body.pos);         // contributes to ν Δu term locally
  body.vel[i] += (grad[i] + ν * lap[i]) * Δt_min;        // 𝒪_UQRC contribution
  body.pos[i] += body.vel[i] * Δt_min;
  ```
- Remove: 3D-distance Earth check, normal-component velocity clamp, mass × curvature multiplier, surface stiffness spring.
- `mass` becomes a single scalar that scales how strongly the body samples `λ(ε₀) ∇_μ∇_ν S` (informational inertia), nothing else. This keeps mass meaningful without making it a Newtonian quantity.
- Spawn position stays on the Earth surface; gravity-as-curvature keeps the body there because that's the basin minimum. If the body ever "floats off," the answer is to deepen the pin, never to clamp.

**6. `src/lib/brain/__tests__/earth.test.ts` & `galaxy.test.ts` — rewrite expectations**
- Drop tests that assert `projectToEarthSurface` clamps. Replace with: "after 200 ticks from a spawn point at `R + 0.5`, body radius converges to within `[R − 0.05, R + 0.05]`" — i.e., the basin attracts.
- Add `commutator.test.ts` — assert `‖[𝒟_μ, 𝒟_ν] u‖` stays bounded over 1000 ticks with random injections.
- Add `smoothness.test.ts` — assert no NaN, no Inf, max `|u|` bounded for 5000 ticks (Global Regularity: `u ∈ C^∞`).

**7. `src/pages/BrainUniverse.tsx` — observability only**
- Camera follow stays (visual). Confirm it does not write back to `body.pos` or `body.vel`. If any write is found, remove it.
- Add a tiny dev overlay (gated by `?debug=physics`) showing live `Q_Score`, `‖F_{μν}‖`, `‖∇∇S‖`, body radius from Earth, gradient magnitude. This is the only "decision system" allowed — pure observation.

**8. Memory**
- Update `mem://architecture/brain-universe-physics` with one rule: *"All forces in `/brain` are gradients of the UQRC field. No constants (gravity, stiffness, drag), no clamps, no per-tick field writes outside `𝒪_UQRC`. Pins live in `pinTemplate`; the operator re-asserts them via `L_S`. The visual layer renders; it never decides."*

### Why this fixes the spawn complaint without adding a clamp

The "spawned outside Earth" bug came from us layering a Newtonian gravity on top of a soft pin and then trying to fix it with a spring. Under UQRC, the right move is to make Earth's pin deeper so its basin in `u` is steeper — the body slides to the minimum on its own under `Σ_μ 𝒟_μ u`. Same physics that bends starlight near a mass; no special case for "is the player on Earth."

### Acceptance

```text
1. grep -nE 'GRAVITY|STIFFNESS|projectToEarthSurface|geodesicStep' src/lib/brain returns no matches.
2. roundUniverse.ts and galaxy.ts touch only pinTemplate, never field.axes.
3. uqrcPhysics.ts body update is purely: gradient + ν·laplacian + λ·∇∇S. No conditionals on Earth proximity.
4. Spawn at R+0.5 → within 200 ticks (≤ 50 s) body settles within [R−0.05, R+0.05] across 100 random seeds.
5. ‖[𝒟_μ, 𝒟_ν] u‖ bounded < 2.0 over 5 min idle; no NaN/Inf.
6. Q_Score panel shows live commutator norm, ∇∇S norm, λ(ε₀) — matches the master equation.
7. Two browsers spawn on Earth's surface, walk via WASD, both stay on the surface purely via gradient flow.
8. Boundary "round universe" loop still works — body launched outward bends back from boundary curvature alone, no ramp written per tick.
9. Camera follow does not mutate body state (verified by snapshot test).
10. ?debug=physics overlay renders Q_Score, F_{μν} norm, gradient magnitude, body radius — read-only.
```

