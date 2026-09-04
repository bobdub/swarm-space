# Run 𝒞_light against the remaining Brain jerk

The isolated light-speed, basin-relax, and ground-jitter tests currently pass (17/17), so the remaining problem must be tested through the **live causal cadence**, not only as separate functions.

## What the code confirms

- `sunEarthRoundTrip` is described as a pure observer, but the physics tick calls `relaxSurfaceBasin` whenever the probe reports `saturated`.
- `relaxSurfaceBasin` directly subtracts a Gaussian from every field axis. That is an abrupt field mutation inside the diagnostic path, while the project specification says relaxation should temporarily reduce pin stiffness for one field step and let diffusion smooth the basin.
- The current tests prove closure arithmetic and isolated relaxation, but do not correlate a causal-state transition or relaxation event with avatar acceleration in the running Brain.

## Plan

1. **Run the light-speed probe alongside movement**
   - Add a deterministic runtime harness that records, per fixed physics step: causal state, delay, surface refractive index, gradient, field-step/relax events, avatar radial acceleration, and lateral acceleration.
   - Reproduce sustained walking long enough to cross at least one 30-field-tick probe boundary.
   - Assert whether the visible acceleration spike lands on the same step as the causal relaxation. If it does not, keep tracing before changing motion.

2. **Make the causal probe observer-only**
   - Remove direct field-array mutation from the probe/diagnostic path.
   - Keep `sunEarthRoundTrip` and `classifyCausalState` read-only, with no network reconnect or transport effects.

3. **Implement the documented one-step basin relaxation**
   - On `creep` or `saturated`, schedule a field-engine relaxation for exactly one field step.
   - During that step, reduce the surface pin stiffness and let the existing diffusion operator smooth the plateau; restore normal stiffness on the following step.
   - Preserve `ℓ_min`, `c`, field bounds, Q-Score observables, and the single operator write path.

4. **Test the cadence, not just the formula**
   - Extend light-speed tests to prove the observer never writes the field.
   - Add a sustained-walk regression proving causal transitions and relaxation do not create radial or lateral acceleration spikes above the established jerk ceilings.
   - Verify `dead`, `live`, `creep`, and `saturated` transitions, including repeated probe intervals.

5. **Verify in the actual Brain**
   - Run the full Brain/UQRC suite and `uqrc:check`.
   - Walk continuously in the live Brain across several probe intervals and compare the on-screen motion with the recorded causal timeline.
   - Only declare the jerk resolved when both the numeric trace and visible movement remain stable.

## Technical boundaries

- Files in scope: `src/lib/brain/lightspeed.ts`, `src/lib/brain/uqrcPhysics.ts`, the field/pin operator that owns `step3D`, and focused Brain light-speed/jitter tests.
- No WebRTC, swarm, content, wallet, or unrelated visual changes.
- The causal classifier remains per-tab and local; it must never trigger reconnects or peer resets.
