# Restore UQRC conformance in the Brain physics

## What is actually broken (measured now)

Running the brain/UQRC test suite: **7 failures out of 138**.

- 5 failures are **timeouts**, not wrong answers — the simulation is simply too slow to finish. Measured in isolation: one field step costs ~2.4 ms and one physics tick ~2.0 ms. The world runs 60 ticks a second, so the field operator alone eats more than the entire frame budget. The "three simulated minutes" test needs 10,800 ticks and never finishes.
- 1 failure is a **real numeric result**: in the side-to-side jitter test, the frame-accurate position is no quieter than the raw one (0.198 vs a 0.126 ceiling). The smoothing that was added for jitter is being cancelled out by something in the motion itself.
- 1 failure is the altitude version of the same jitter check, currently masked by its own timeout.

## Root causes found

1. **The field operator runs at full rate.** `FIELD_TICKS_PER_PHYSICS = 1` makes the whole 24x24x24x3 lattice sweep every physics tick (60 Hz), while the project's own field engine spec runs the operator at 4 Hz. Bodies read the field far more often than the field can meaningfully change.
2. **The operator allocates fresh memory every sweep.** `step3D` comments claim a reused scratch buffer but actually allocates a new `Float32Array` per axis per tick — roughly 10 MB/s of garbage during play.
3. **Motion is finished off outside the operator.** After the UQRC integration step, `uqrcPhysics` applies a hand-written tangential speed cap, a radial spring (`spring = 4.0`, `damp = 0.15..0.70`) and a self-damping term. `docs/PROJECT_SOURCE_OF_TRUTH.md` (§ "no decision outside the contract") and the brain physics rules forbid constants and clamps outside `O_UQRC`; these post-steps are the prime suspect for the leftover jerk, since they switch on and off between ticks at the 3x walk speed. **This link is not yet proven** — measuring it is step 1 below, not an assumption.

## Plan

**Step 1 — Prove the jitter cause before changing motion.**
Instrument a short harness that runs the same walk as the failing test and records jerk with (a) everything on, (b) the walk cap off, (c) the radial settle off, (d) both off. Only the term that actually removes the jerk gets rewritten. If none does, the cause is the render interpolation and the fix moves there instead.

**Step 2 — Put the field operator back on its own clock.**
Decouple the field step from the physics tick: accumulate physics time and run `step3D` at the documented field rate, with bodies sampling the field between steps as they already do. Physics stays at 60 Hz; the lattice sweep drops to a fraction of the current cost.

**Step 3 — Remove the per-tick allocation in `step3D`.**
Pre-allocate the scratch buffers on the field and swap them, matching what the comment already promises. No change to the maths.

**Step 4 — Migrate the post-step motion terms into the operator.**
Whatever step 1 identifies gets expressed as gradient terms of the field (the exclusion potential / pin basin already used by `causalCollide`) rather than as a clamp applied afterwards. Ad-hoc constants (`4.0`, `0.15`, `0.55`, the walk cap) are removed or derived from existing single-source values.

**Step 5 — Make the suite tell the truth.**
Long-run tests get explicit timeouts sized to the post-fix cost rather than being loosened; the two jitter tests keep their thresholds. Add a guard test asserting the field advances at its own rate and that `step3D` performs no allocation per sweep.

**Step 6 — Verify.**
Full brain/UQRC suite green, `bun run uqrc:check` clean, then walk the Brain in a browser to confirm no ground or lateral jitter and no floating away.

## Technical notes

- Files in scope: `src/lib/uqrc/field3D.ts` (`step3D` buffers), `src/lib/brain/uqrcPhysics.ts` (field clock, post-step terms), `src/lib/brain/__tests__/uqrcPhysics.test.ts`, `groundJitter.test.ts`, `uqrcConformance.test.ts`, `lavaMantle.test.ts`.
- Invariants preserved: pins written only through `writePinTemplate`, no writes to `field.axes` outside the operator, `Q_Score` observables unchanged, closure identities in `closure.ts` untouched.
- No change to rendering behaviour beyond what step 1 proves is needed.
