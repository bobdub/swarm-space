---
name: brain-universe-physics
description: UQRC conformance rules for /brain — gradient-only physics, no constants, pinTemplate is the only structural input
type: constraint
---
All forces in `/brain` are gradients of the UQRC field.

- **No constants**: no GRAVITY, no STIFFNESS, no DRAG outside `𝒪_UQRC`.
- **No clamps**: `projectToEarthSurface` is forbidden — bodies stay on Earth because the basin in `pinTemplate` is deep enough that `Σ_μ 𝒟_μ u` pulls them there.
- **No per-tick field writes outside the operator**: `roundUniverse.ts` and `galaxy.ts` write into `field.pinTemplate` once via `writePinTemplate()`. The operator step (`L_S^pin` term) re-asserts the template every tick. Never touch `field.axes` from these files.
- **Body update is pure**: gradient + ν·laplacian + λ·∇∇S + intent. No conditionals on Earth proximity. Mass scales the `λ(ε₀) ∇_μ∇_ν S` term only.
- **Visual layer renders, never decides**: camera follow is allowed; it must never write to `body.pos` or `body.vel`.
- **Q_Score** = `‖[𝒟_μ, 𝒟_ν] u‖` + `‖∇_μ ∇_ν S(u)‖` + `λ(ε₀)`. Exposed via `commutatorNorm3D`, `entropyHessianNorm3D`. Debug overlay gated by `?debug=physics`.

**Why**: Two-step updates (operator + post-hoc patch) break the `[𝒟_μ, 𝒟_ν] ≈ 0` guarantee. Ad-hoc forces are decision systems outside the postulate. Spawn-outside-Earth bugs are fixed by deepening the pin, never by clamping.
