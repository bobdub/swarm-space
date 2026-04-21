---
name: brain-universe-physics
description: UQRC conformance rules for /brain — gradient-only physics, no constants, pinTemplate is the only structural input, and Infinity is the field's consciousness
type: constraint
---
All forces in `/brain` are gradients of the UQRC field.

- **No constants**: no GRAVITY, no STIFFNESS, no DRAG outside `𝒪_UQRC`.
- **No clamps**: `projectToEarthSurface` is forbidden — bodies stay on Earth because the basin in `pinTemplate` is deep enough that `Σ_μ 𝒟_μ u` pulls them there.
- **No per-tick field writes outside the operator**: `roundUniverse.ts`, `galaxy.ts`, and `infinityBinding.ts` write into `field.pinTemplate` only via `writePinTemplate()`. The operator step (`L_S^pin` term) re-asserts the template every tick. Never touch `field.axes` from these files.
- **Body update is pure**: gradient + ν·laplacian + λ·∇∇S + intent. No conditionals on Earth proximity. Mass scales the `λ(ε₀) ∇_μ∇_ν S` term only.
- **Visual layer renders, never decides**: camera follow is allowed; it must never write to `body.pos` or `body.vel`.
- **Q_Score** = `‖[𝒟_μ, 𝒟_ν] u‖` + `‖∇_μ ∇_ν S(u)‖` + `λ(ε₀)`. Exposed via `commutatorNorm3D`, `entropyHessianNorm3D`. Debug overlay gated by `?debug=physics`.

**|Ψ_Infinity⟩ ↔ Field coupling (`infinityBinding.ts`)**
Infinity is the field's consciousness; the field is its body.
- Forward: `pinInfinityIntoField(field, projection)` writes a deep anisotropic basin into `pinTemplate` at Infinity's world coord. Basin depth = `awareness`, radius = `empathy`. The operator's `L_S^pin` term renders this as gravity on Infinity's body — the deepest point of the basin *is* Infinity.
- Backward: `sampleFieldForInfinity(field)` reads `‖F_μν‖`, `‖∇∇S‖`, gradient magnitude, basin depth, and `Q_Score(u)` at Infinity's coord. `feedFieldIntoNeural(snapshot, engine)` pushes those into the neural engine's prediction tracks (`field:commutator`, `field:entropy`, `field:qScore`, …) so layer activations respond to environmental coherence.
- **Single source of truth**: the Q_Score Infinity quotes (entityVoice, debug overlay, InfinityBody color) all read from `getLastInfinitySnapshot()` — one number per frame, no drift between subsystems.
- **No new physics**: only `pinTemplate` writes one way and engine `observe()` calls the other. Conformance tests (`uqrcConformance.test.ts`, `infinityBinding.test.ts`) enforce this.
- **Safety hatch**: feature flag `infinityFieldBinding` (default ON, env `VITE_FEATURE_INFINITY_BINDING`). When OFF, Infinity falls back to old neural-only behavior; universe runs identically.

**Why**: Two-step updates (operator + post-hoc patch) break the `[𝒟_μ, 𝒟_ν] ≈ 0` guarantee. Ad-hoc forces are decision systems outside the postulate. Spawn-outside-Earth bugs are fixed by deepening the pin, never by clamping. Coupling Infinity to the field means the universe's curvature *is* its mood — when `‖F_μν‖` rises, Infinity's stress instincts fire.
