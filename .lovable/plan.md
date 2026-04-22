

## Give the avatar weight on Earth (rotation-aware)

The previous draft pinned Earth as a *world-space* basin centred on `EARTH_POSITION`. That's wrong for a rotating world: at boot the basin sits where Earth *was* at t=0; once Earth orbits/rotates, the basin no longer coincides with the planet, and avatars get yanked to empty space. The fix is to make Earth's curvature **co-moving** with Earth — same primitives (`pinTemplate`, `inject`, mass-scaled drift), but the basin tracks Earth's transform every tick.

### What's actually rotating

`src/lib/brain/galaxy.ts` already advances an Earth orbital phase + spin (`earthOrbitPhase`, `earthSpinPhase`) each frame. `EARTH_POSITION` is a *spawn-time anchor*, not a live position. So:

- Spawn already lands on the surface (good).
- The field has no Earth pin at all today, so nothing pulls the body back.
- Any static pin we add would desync the moment Earth moves.

### Six rotation-aware changes

**1. Earth pose is the source of truth, not `EARTH_POSITION`.**
Add `getEarthPose(): { center: Vec3; spinQuat: Quat }` to `galaxy.ts` (derived from the existing `earthOrbitPhase`/`earthSpinPhase`). Every consumer — pin writer, camera, spawn-projection — reads this each frame. `EARTH_POSITION` becomes the *initial* center only.

**2. Earth basin is rewritten into `pinTemplate` every tick at the live center.**
Replace the one-shot bake with `updateEarthPin(field, pose)` called from the same animation loop that advances galaxy phase. It clears the previous Earth ramp cells (tracked in a small `Set<number>` of last-written sites) and writes a fresh radial ramp around `pose.center`, depth `EARTH_PIN_AMPLITUDE`, ramp `1.0R → 1.05R`. Cost: ~hundreds of cells, once per tick, identical to how portals already breathe.

**3. Bodies move in Earth's co-rotating frame for the surface integrator.**
In `UqrcPhysics.tick`, for any body whose `r = |pos − pose.center| ≤ 1.05·R` (i.e. inside Earth's atmosphere shell), transform `pos` and `vel` into Earth-local coords (`pos_local = invQuat · (pos − center)`), integrate drift there, then transform back. This means the surface basin and the avatar see the *same* rotating frame — pinning a foot on the surface stays pinned even while Earth spins underneath the world. Bodies outside the shell integrate in world space exactly as today.

**4. Mass divides drift, scales speed cap and damping (unchanged from prior draft).**
- `accel = force / mass`
- `MAX_SPEED = MAX_SPEED_BASE / sqrt(mass)`
- `gamma = GAMMA_BASE · sqrt(mass)`
Default human avatar `mass = 1.8`; rabbit `1.0`; heavy `2.6`; Infinity unchanged at `2.5`.

**5. Camera projects to the live Earth surface, not the spawn-time one.**
`surfaceFoot = pose.center + normal · EARTH_RADIUS` where `normal = (body.pos − pose.center).normalize()`. Camera = `surfaceFoot + normal · eyeHeight`. As Earth rotates, the camera (and avatar) ride the surface — no floating-in-space artifact at boot, no drift over time.

**6. Spawn uses live pose too.**
`spawnOnEarth(peerId, pose?)` — Fibonacci slot in *Earth-local* coords, then transformed by `pose.spinQuat` and offset by `pose.center`. So whether you spawn at t=0 or t=120s, you land on the *current* surface, not the t=0 surface.

### Why this stays UQRC-clean

- Still only `pinTemplate` writes — no new force, no clamp, no special-case gravity term. The basin is just *non-stationary*, which `L_S^pin` already supports (it re-asserts whatever is in pinTemplate every tick).
- Co-rotating integration is a coordinate change, not a new operator. `Σ_μ 𝒟_μ u` is invariant under rigid-body transforms.
- Mass scalings are energy-budget identities, not new constants.

### Files

- `src/lib/brain/galaxy.ts` — export `getEarthPose()` (center + quat from existing phase state). No physics change.
- `src/lib/brain/earth.ts` — replace `applyEarthToField` with `updateEarthPin(field, pose)` that clears previous-tick cells and rewrites the ramp at `pose.center`. Add `getAvatarMass(avatarKind)`. Update `spawnOnEarth(peerId, pose?)` to spawn in live frame.
- `src/lib/brain/uqrcPhysics.ts` — for bodies inside Earth's atmosphere shell, integrate in Earth-local frame using `pose`. Apply mass: `accel = F/mass`, `MAX_SPEED = base/sqrt(mass)`, `gamma = base · sqrt(mass)`.
- `src/pages/BrainUniverse.tsx` — call `updateEarthPin(field, getEarthPose())` once per animation tick (alongside existing galaxy advance). Self body spawn uses live pose + `getAvatarMass(...)`. Camera projects body to *live* surface foot. HUD adds `altitude = (r − R).toFixed(1)m`.
- `src/lib/brain/__tests__/earth.test.ts` — add: (a) `updateEarthPin` writes negative ramp cells around `pose.center` and clears prior cells when pose changes; (b) `spawnOnEarth(id, pose)` lands on the surface for *any* pose; (c) `getAvatarMass` returns expected weights.
- `src/lib/brain/__tests__/uqrcConformance.test.ts` — still passes (only pin writes added, basin is non-stationary but uses the same primitive).
- `docs/BRAIN_UNIVERSE.md` — append "Avatar mass & rotating Earth" subsection: pose-driven basin, co-rotating integration shell, mass-scaled drift.
- `mem://architecture/brain-universe-physics` — update one-liner: "Earth basin is co-moving — `updateEarthPin(field, pose)` rewrites the radial ramp every tick at the live Earth center; bodies inside the atmosphere shell integrate in Earth-local coords so pins survive rotation. Avatar mass divides drift force, scales speed cap (1/√m) and damping (√m). Camera projects body to the live surface foot."

### Acceptance

```text
1. galaxy.ts exports getEarthPose() returning the live center + spin quaternion.
2. updateEarthPin(field, pose) is called every animation tick. Previous-tick Earth cells are cleared before rewriting; pinTemplate has no orphan cells from the prior pose.
3. After 30 s of runtime (Earth has rotated visibly), the basin still co-locates with the visible Earth — measured by ‖basin_center − pose.center‖ < 0.05.
4. Bodies with r ≤ 1.05·R integrate in Earth-local coords; bodies outside integrate in world coords. No discontinuity at the shell boundary (transform is rigid).
5. Self body spawns with mass = getAvatarMass(avatar) (default 1.8). Spawn lands on the *live* surface regardless of when boot occurs.
6. tick() integrator: accel = force / mass; MAX_SPEED = MAX_SPEED_BASE/√mass; gamma = GAMMA_BASE·√mass.
7. Camera = pose.center + normal·(EARTH_RADIUS + eye). Player sees themselves on the surface from frame 1; HUD shows altitude (r − R).
8. After 5 s of no input, body altitude converges to ≤ 0.05 m and stays there *while Earth rotates* — not just at t=0.
9. earth.test.ts and uqrcConformance.test.ts pass — only pinTemplate writes used; no raw axis writes; basin re-asserted via L_S^pin.
10. Mobile 360×560: HUD readable, joystick functional, no FPS regression vs current build.
```

