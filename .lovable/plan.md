

## Fix spinning, drift, and drag-to-look in /brain

Three coupled bugs in `PhysicsCameraRig` and `uqrcPhysics`:

### Bug 1 — Drag-to-look does nothing
Each frame the rig adds `lookInput.yaw/pitch` to `camera.rotation`, then immediately calls `camera.lookAt(source + forward)`, which **overwrites** the rotation. Drag input is wiped before render.

**Fix**: Stop calling `camera.lookAt()` directly. Instead, maintain our own yaw/pitch state (`yawRef`, `pitchRef`) seeded once at spawn from the surface frame, accumulate drag deltas into it, and build the camera rotation as `surfaceFrame * (yaw, pitch)` quaternion composition each frame. The surface frame defines "up" and the default forward; yaw/pitch rotate the view *within* that frame.

```text
camera.up   = surfaceUp
basisQuat   = quatFromBasis(right, up, -forward)   // local→world
viewQuat    = quatFromEuler(pitch, yaw, 0, 'YXZ')  // user look
camera.quat = basisQuat * viewQuat
```

This keeps the horizon level when the user moves around the interior shell, but their look direction is preserved across frames.

### Bug 2 — Camera spins on spawn
The current code calls `lookAt(source + forward)` where `forward` is derived purely from the body's *current* surface frame. As the body drifts even a millimetre tangentially, the surface frame's arbitrary `forward` axis snaps around — producing the spinning. Bug 1's fix removes `lookAt` entirely, which removes the spin source.

Additionally, gate the camera basis update so the basis only re-derives from a slowly-smoothed body position (lerp the basis "up" with `0.1` factor per frame) instead of the raw jitter — keeps the horizon stable even if physics nudges the body.

### Bug 3 — Body moves on spawn without input
Two compounding causes:

a) `physics.setIntent(selfId, { fwd, right, yaw: camera.rotation.y })` is called **every frame** with the camera's world Y rotation as `yaw`. Even with `fwd=right=0` the call itself is harmless — but the **intent map keeps stale values** if a previous frame had nonzero input. More importantly, the *physics* applies `DRIFT_COUPLING * gradient` every tick. On the interior shell, the field gradient is non-zero (Earth pin pulls outward, street pins pull inward) and the body slides tangentially until equilibrium.

**Fix in `uqrcPhysics.ts`**:
- For `kind: 'self' | 'avatar'` with `meta.attachedTo === 'earth-interior'`, **suppress the field-gradient drift** when there is no player intent (`|fwd| + |right| < 0.05`). The interior surface clamp + tangential damping then keeps the body still.
- Increase tangential damping to `GAMMA_BASE * 3` for interior bodies so any residual tangential velocity bleeds off in <1s. Radial is already zeroed by the clamp.
- Keep ν·Δu and λ·∇∇S terms (they are quiescent — `λ ≈ 1e-100`).

This preserves UQRC: the body still samples the field; it just doesn't *move* unless the player pushes it. Standing still is the rest state, walking is the gradient-augmented state.

**Fix in `PhysicsCameraRig`**:
- Don't pass `yaw: camera.rotation.y` (camera Y is no longer meaningful in world frame on the interior shell). Pass `yaw: yawRef.current` — the user's local yaw within the surface frame. Then in physics, the intent transform uses the surface-tangent basis (passed alongside intent, see below) to convert `(fwd, right, yaw)` into a world push.

### Files touched

- `src/pages/BrainUniverse.tsx` — rewrite `PhysicsCameraRig` look/orientation as basis × user-yaw composition; remove `camera.lookAt`; track `yawRef/pitchRef`; pass local yaw to intent.
- `src/lib/brain/uqrcPhysics.ts` — gate gradient drift on intent magnitude for interior humanoid bodies; raise interior tangential damping; consume `intent.basis` (optional `{up, forward, right}`) when present so the intent push is along the local tangent plane instead of world XZ.
- `src/lib/brain/earth.ts` — export a small helper `composeSurfaceQuat(up, forward, right)` returning a `THREE`-compatible quaternion (or just the basis vectors for the rig to compose itself with three.js).

### Acceptance

```text
1. After spawn the camera is stationary — no spin, no pan, no drift.
2. The body does not translate while no key, joystick, or touch input is active. Position holds within ±2 cm over 30 s.
3. Mouse drag (desktop) and one-finger drag (touch) rotate the view smoothly. Releasing the mouse leaves the view where it was; the next frame does not snap back.
4. WASD / joystick moves the body forward/back/left/right relative to the current look direction. Movement stops within ~0.3 s of releasing input.
5. Horizon stays level relative to the interior surface as the body walks along the street; no roll or sudden flips.
6. Existing earth, street, and uqrcConformance tests still pass; new tests assert (a) intent=0 ⇒ Δpos < 1 cm over 1 s, (b) drag yaw persists across frames.
```

