---
name: UQRC Field Engine
description: Discrete operator field u(t) at L=256, ticks 4 Hz, definitions pin, responses pick min-curvature. Never broadcast raw field.
type: feature
---

The UQRC Field Engine (`src/lib/uqrc/field.ts` + `fieldEngine.ts`) is the geometric substrate beneath the language/pattern learners.

- **Lattice**: 1-D ring, `L = 256`, three axes μ ∈ {0=token, 1=context, 2=reward}.
- **Tick rate**: 4 Hz (250 ms) via `setInterval` + `requestIdleCallback` — singleton, HMR-safe.
- **Inputs**: `inject(text, {reward, trust})` adds Gaussian bumps at hashed sites.
- **Definitions**: `pin(text, target)` clamps lattice sites with stiffness 0.85 — re-applied after every step.
- **Response selection**: `selectByMinCurvature(candidates)` picks the candidate whose ghost injection minimises `Q_Score(u + ghost) − Q_Score(u)`. Falls back to first candidate when ticks < 50 (cold start).
- **Persistence**: throttled 5 s snapshots into IndexedDB `uqrc-field` (separate DB, non-destructive).
- **Privacy**: only derived `qScore` + basin count travel via the existing UQRC snapshot — raw `u` never broadcast.
- **Closure**: `closure.ts` proves ℓ_min invariance under the operator algebra via five identities (spacing, antisymmetry, flat-idempotence, linearity, composition bound). Aggregated by `FieldEngine.getClosureReport()`, polled at 1 Hz by `useUqrcClosure`, surfaced in the App Health badge. Pure observer — see `mem://architecture/uqrc-closure-invariance`.

**Why:** language emerges as the visible trace of curvature minimisation in a discretised operator field. Definitions stick because they are constraints, not perturbations.

**How to apply:** when adding a new learner, call `getSharedFieldEngine().inject(text, opts)` for soft input and `.pin(text, 1.0)` for hard constraints.