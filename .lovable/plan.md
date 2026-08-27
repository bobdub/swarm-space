# Fix the ground jitter in /brain

The ground appears to jump up and down because the simulation clock and the render clock are two different clocks, and nothing bridges them.

## What the code shows

- `UqrcPhysics.start()` drives the whole simulation from `setInterval(tick, 1000/60)` with a **fixed** `dt = 1/60` (`src/lib/brain/uqrcPhysics.ts:118, 243`). Browser timers are not phase-locked to the display; some animation frames see two ticks, some see none.
- The camera rig reads the raw body position every animation frame with **no interpolation** — `physics.getBody(selfId)` → `camera.position.set(...)` (`BrainUniverseScene.tsx:301, 406-409`). Uneven tick delivery therefore lands directly on the eye position.
- Camera, Earth mesh, weather, pits and every other layer each call `getEarthPose()` **separately** inside their own `useFrame` (`BrainUniverseScene.tsx:300`, `EarthBody.tsx:305`, `WeatherLayer.tsx:66`, `CarvedCellsLayer.tsx:92`), while the body was integrated against the *tick-time* pose (`uqrcPhysics.ts:452`). Earth's centre moves ~2.6 m/s along its orbit, so a 16-33 ms clock gap puts the avatar several centimetres out of register with the ground it is standing on — and the gap changes every frame.
- The radial settle spring only engages when the player is idle (`intentMag < 0.05`, `uqrcPhysics.ts:764`). While walking, residual radial velocity from the tanh mantle spring is undamped, so vertical wobble is largest exactly when moving.

Together these produce a per-frame vertical offset that reads as the ground bouncing.

## Changes

### 1. One clock per frame
Sample `getEarthPose()` **once** per animation frame into a frame-scoped cache in `earth.ts` (`beginFrame(t)` / `getEarthPose()` returns the cached pose for that frame), and drive that cache from a single top-level ticker component that runs before all other `useFrame` consumers (negative render priority). Physics keeps its own tick-time pose; every renderer shares one pose. No call sites change signature.

### 2. Render-time interpolation of body pose
Physics keeps its fixed-step integrator (determinism preserved), but each body records `prevPos` and the tick timestamp. Add `physics.getBodyRenderPos(id, nowMs)` that lerps `prevPos → pos` by the fractional tick alpha (clamped to [0,1]). The camera rig, `RemoteAvatarBody`, and the avatar mesh read the interpolated pose instead of `body.pos`. Collision, tools and world mutation keep reading `body.pos` — visual smoothing only.

### 3. Accumulator instead of raw interval
Replace the naked `setInterval` with a `requestAnimationFrame`-driven accumulator that runs whole fixed `dt` steps (max ~4 per frame to avoid spirals) and falls back to `setInterval` when the tab is hidden. This phase-locks simulation to the display and removes the beat between the two clocks.

### 4. Damp radial wobble while walking
Apply the radial settle (damping + basin spring) whenever the body is within the settle band, scaling the damping down — not off — with intent magnitude, so walking no longer leaves vertical velocity unconstrained. Vertical response to real terrain (slopes, digging, falling) is unchanged.

## Verification

- Instrument `?debug=physics` with a live "eye altitude above basin" readout plus its per-second peak-to-peak range; capture it before and after via Playwright at the reporting viewport (1458×1150), standing idle and walking. Target: idle range under ~1 cm, walking range under ~3 cm.
- Capture short frame sequences of the horizon to confirm the ground line is stable between frames.
- Existing physics/UQRC tests must stay green, plus a new test that fixed-step integration output is unchanged by the accumulator (same tick count in, same positions out) and that interpolation never overshoots.

## Technical notes

Nothing in the operator changes — no new forces, no writes to `field.axes`. Items 1-3 are timing and presentation; item 4 tightens an existing damping term that was already present for idle bodies.
