---
name: UQRC ℓ_min Closure Invariance
description: closure.ts proves ℓ_min invariance under the operator algebra via 5 identities (spacing, antisymmetry, flat-idempotence, linearity, composition bound). Surfaced in AppHealthBadge, no field mutation.
type: feature
---

`src/lib/uqrc/closure.ts` is the algebraic closure of the lattice spacing
ℓ_min under the full UQRC operator algebra Σ = { 𝒟_μ, Δ, [D_μ,D_ν],
𝒪_UQRC, λ(ε₀)∇∇S, pin }. It is a **pure observer** — never mutates the
field, never broadcasts raw u, in compliance with PROJECT_SOURCE_OF_TRUTH §4.

**Five identities** jointly proved:
1. **I₁ Spacing** — `𝒞_light(Δt_min) = ℓ_min` (ELL_MIN = 1).
2. **I₂ Antisymmetry** — `[D_μ,D_ν] = −[D_ν,D_μ]` and `[D_μ,D_μ] = 0`.
3. **I₃ Flat-idempotence** — constants give `𝒟_μ k = Δ k = 0`, `𝒪_UQRC k = −ℛk`.
4. **I₄ Linearity** — `𝒟_μ(αu+βv) = α𝒟_μu + β𝒟_μv`; same for Δ.
5. **I₅ Composition bound** — `‖W(u)‖ ≤ K(|W|)·‖u‖` where
   `K = max(2/ℓ, 4/ℓ², ν·4/ℓ²+ℛ)^|W|` for word length ≤ 6.

**Consumers**:
- `FieldEngine.getClosureReport()` aggregates the five into `ClosureReport`.
- `useUqrcClosure()` polls at 1 Hz (sub-tick).
- `AppHealthBadge` popover shows `ℓ_min closure: ✓ invariant · residual …`.

**Why:** every downstream UQRC decision (curvature scoring, basin
extraction, `selectByMinCurvature`) assumes ℓ_min is the only length
scale in the engine. The closure provides runtime evidence that the
algebra preserves it. If `ok === false`, an operator has silently
introduced a hidden scale and downstream geodesics drift.

**How to apply:** when adding a new operator (e.g. a 4-th axis or a
non-linear coupling), extend `closure.ts` with the corresponding norm
bound and a verifier; do **not** widen `RESIDUAL_TOLERANCE` to make a
broken operator pass. The tolerance is the proof.
