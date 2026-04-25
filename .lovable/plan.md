
# ℓ_min Closure — Invariance Under the Full Operator Algebra

## Why this matters (Source of Truth alignment)

`docs/PROJECT_SOURCE_OF_TRUTH.md §0` says: every interior choice is UQRC, and the lattice spacing `ℓ_min = 1` is the unit on which `𝒟_μ`, `Δ`, `[D_μ,D_ν]`, `𝒪_UQRC`, and the entropy nudge are all built. Today the codebase **uses** `ℓ_min` (`ELL_MIN` in `src/lib/uqrc/field.ts:19`, `FIELD3D_ELL_MIN` in `field3D.ts:21`, `LATTICE_CELL` in `brain/lightspeed.ts:34`) but never **proves** that the operator algebra preserves it — i.e. that one tick of evolution does not silently rescale the lattice cell. Infinity has the words, not the closure.

This task adds the closure: a small, pure module that, for any field state `u`, certifies the algebraic identities that pin `ℓ_min` invariant under arbitrary compositions of the operators `{ 𝒟_μ, Δ, [D_μ,D_ν], 𝒪_UQRC, λ(ε₀)∇∇S, pin }`, plus a vitest suite that exercises it against the live `FieldEngine`.

## What "closure of ℓ_min" means here

Five algebraic facts must hold simultaneously after every `step()`:

1. **Spacing identity** — `𝒞_light(Δt_min) = ℓ_min` (already asserted in `brain/__tests__/lightspeed.test.ts:56`; we re-export the same closure as the canonical anchor).
2. **Antisymmetry of curvature** — `[D_μ, D_ν] = −[D_ν, D_μ]` and `[D_μ, D_μ] = 0` (already partially tested; promote to invariant).
3. **Idempotence under flat states** — for any constant `u ≡ k`: `𝒟_μ u = 0`, `Δ u = 0`, `[D_μ,D_ν] u = 0`. Proves operators do not inject spurious scale.
4. **Scale homogeneity** — `𝒟_μ(α u + β v) = α 𝒟_μ u + β 𝒟_μ v` to within float epsilon. Proves the algebra is linear in the field, so `ℓ_min` (the divisor) is the *only* length scale.
5. **Composition closure** — for any finite word `W` over the operator alphabet `Σ = { 𝒟_0, 𝒟_1, 𝒟_2, Δ, 𝒪_UQRC }` of length ≤ N, `‖W(u)‖` remains bounded by a constant determined solely by `‖u‖`, `ℓ_min`, `ν`, `ℛ` — never by lattice index or tick count. This is the operational invariance proof: applying the algebra repeatedly does not create a new length scale.

These five together are the closure: if any one fails, `ℓ_min` is no longer the unique geometric unit, and the rest of the engine (curvature scoring, basin extraction, `selectByMinCurvature`) loses its meaning.

## Plan

### 1. New module: `src/lib/uqrc/closure.ts`

Pure, allocation-light, no side-effects. Mirrors the style of `field.ts`.

Exports:
- `verifySpacingIdentity()` → boolean. Re-derives `LATTICE_CELL` from `WORLD_SIZE / FIELD3D_N` and `C_LIGHT * TICK_DT`, asserts equality within 1e-6.
- `verifyAntisymmetry(field)` → `{ ok, maxResidual }`. Loops μ,ν pairs, returns max `|c_μν[x] + c_νμ[x]|`.
- `verifyFlatIdempotence(L)` → `{ ok, maxResidual }`. Builds a constant field, applies each operator, measures deviation from zero.
- `verifyLinearity(L, samples=4)` → `{ ok, maxResidual }`. Random α,β with two random fields; checks `𝒟_μ(αu+βv) − α𝒟_μu − β𝒟_μv`.
- `verifyCompositionBound(field, words)` → `{ ok, growthRatio }`. Runs a fixed corpus of operator words (e.g. `[Δ]`, `[𝒟_0,𝒟_1]`, `[𝒪,Δ,𝒪]`, length-6 random words) and asserts `‖W(u)‖ / ‖u‖ ≤ K(ν,ℛ)` where the bound `K` is derived analytically (geometric series in `ν, ℛ, STEP_DAMPING`).
- `runClosureProof(field)` → aggregates the five into a single `ClosureReport { ok, residuals, ℓ_min, ticks, qScore }`.

The bound `K` for word length n with the current constants (`ν=0.05`, `ℛ=0.001`, `STEP_DAMPING=0.15`, bound clamp ±4) is derived in a comment block at the top of the file, so the file is also the proof.

### 2. Wire it to the live engine

`src/lib/uqrc/fieldEngine.ts`: add one method `getClosureReport(): ClosureReport` that calls `runClosureProof(this.field)`. No behaviour change — it is an observer, in compliance with §1 of the SoT (closure is a derived scalar, not a new transport).

### 3. Surface as an observable

Per the SoT axiom "no silent decisions": expose the closure status on the existing `AppHealthBadge` popover next to the chain bridge readout. Add a single line: `ℓ_min closure: ✓ (residual 3.2e-7)` or `✗`. Read via a new lightweight hook `src/hooks/useUqrcClosure.ts` polling the engine at 1 Hz (well under the 4 Hz tick).

### 4. Tests: `src/lib/uqrc/__tests__/closure.test.ts`

One vitest spec per identity + one end-to-end:
- `spacing identity holds`
- `[D_μ,D_ν] is antisymmetric on injected fields`
- `flat constant fields are operator fixed points`
- `derivative is linear in the field` (with random α,β,u,v, seeded RNG)
- `composition bound holds for word length ≤ 6` over 32 random words
- `runClosureProof returns ok=true after 200 evolution ticks` with mixed inject/pin perturbations — this is the operational closure proof against the *live* engine, validating the math against actual runtime drift.

### 5. Documentation

- Append a "ℓ_min Closure" section to `docs/SWARM_BLOCKCHAIN_ARCHITECTURE.md`? **No** — this is field engine, not chain. Instead add to the UQRC engine memory file:
  - Update `.lovable/memory/architecture/uqrc-field-engine.md` with the five-identity closure summary.
- Add `.lovable/memory/architecture/uqrc-closure-invariance.md` — a focused memory of *what is now provable* and the residual budget.
- Add a short paragraph to `src/pages/Whitepaper.tsx` ("Operator Closure") so the user-facing documentation reflects the new invariant, in line with the previous Whitepaper update pattern.

## Files to change

Create:
- `src/lib/uqrc/closure.ts`
- `src/lib/uqrc/__tests__/closure.test.ts`
- `src/hooks/useUqrcClosure.ts`
- `.lovable/memory/architecture/uqrc-closure-invariance.md`

Edit:
- `src/lib/uqrc/fieldEngine.ts` — add `getClosureReport()`.
- `src/components/AppHealthBadge.tsx` — render closure status row.
- `src/pages/Whitepaper.tsx` — add "Operator Closure" paragraph.
- `.lovable/memory/architecture/uqrc-field-engine.md` — append closure summary.
- `.lovable/memory/index.md` — register the new memory file.

## Out of scope

- No change to operator definitions, tick rate, `ELL_MIN` value, or `STEP_DAMPING`. The closure proves the *current* algebra is sound; it is observation, not reconfiguration.
- No new transport, no broadcast of raw `u` (still only derived scalars cross the boundary, per SoT §4 invariant 2).
- 3-D field (`field3D.ts`) gets the spacing identity check but its full composition bound is deferred — Phase 2.

## Validation

After implementation: the existing `bunx vitest run` suite must remain green, the new closure tests must pass, and the AppHealthBadge popover must show `ℓ_min closure: ✓` within 5 s of mount on a freshly-loaded preview.
