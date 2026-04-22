

## Phase E — Hub Camera Clipping Deep Dive

`To Infinity and beyond! · q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`

### Findings (root-cause map)

The Hub camera "clips" because the world is **too small relative to the avatar's eye-height and the surface curvature**. Sourced from `EarthBody.tsx`, `earth.ts`, and `BrainUniverseScene.tsx`:

| Symbol | Value | Location |
|---|---|---|
| `EARTH_RADIUS` | **2.0** sim units | `src/lib/brain/earth.ts:25` |
| `HUMAN_HEIGHT` | **1.7** sim units | `src/lib/brain/earth.ts:41` |
| `eyeLift` (camera offset above body) | **0.85** | `BrainUniverseScene.tsx:213` |
| Camera `fov` | **70°** | `BrainUniverseScene.tsx:1138` |
| Camera `near` | **0.05** | `BrainUniverseScene.tsx:1138` |
| `MOON_ORBIT_RADIUS` | `EARTH_RADIUS × 4.5` = **9** | `EarthBody.tsx:108` |
| Galaxy halo, atmosphere shell | scaled off `EARTH_RADIUS` | `roundUniverse.ts`, galaxy code |

**Three concrete clipping modes observed:**

1. **Eye-near-surface clip:** Eye sits `0.85` above the body anchor, body anchor at `EARTH_RADIUS + HUMAN_HEIGHT/2` (= 2.85). Eye altitude ≈ 1.7. With `near: 0.05` the ground passes the near plane fine — but at `fov: 70°` and **only 1.7 of altitude on a sphere of radius 2.0**, the horizon sits ~3 m away. Walking even one body length curves the visible ground out from under you, so the avatar appears to "fall off" or the planet flips.
2. **Self-body cull / camera-inside-body:** When yaw rotates the look basis, the smoothed up vector lerps (k=0.15) one frame behind the actual body. During fast turns, the camera's eye position briefly falls inside the avatar capsule (no avatar mesh in `BodyLayer` for `kind: 'self'`, but for the moon's `pointLight` and Earth shader the camera can pierce shells).
3. **Atmosphere/halo intersection:** Earth halo at `EARTH_RADIUS * 1.08` = 2.16 and the eye lives at radius ≈ 3.7 from Earth center — fine — but when the user crosses a portal site or walks toward the Moon's orbit (radius 9), they reach the inside of the moon's `pointLight` decay sphere and into shader artifacts.

The Brain lobby only ever uses ~ a 6-unit-circumference walkable surface (`2π × 2 ≈ 12.5` units around the equator). At human stride, **two seconds of joystick input completes a full lap.** That is the "walk in circles and clip" the user reports.

### Decision

**Widen the world (Option A from Phase E mapping).** Scaling up `EARTH_RADIUS` enlarges the walkable surface without touching camera math, yaw smoothing, or shader code, and it preserves the current "person standing on a planet" reading. Tightening the camera (Option B) was rejected: a low-altitude wide-FOV would amplify motion sickness on the 360px viewport (current device).

### Plan

#### Step 1 — Scale the planet (single source of truth)

In `src/lib/brain/earth.ts`:

- `EARTH_RADIUS`: **2.0 → 8.0** (×4)
- `EARTH_ATMOSPHERE`: **0.6 → 2.4** (×4)
- `HUMAN_HEIGHT`: **unchanged at 1.7** (avatars stay human-scale; planet grows around them)
- `EARTH_PIN_AMPLITUDE`: leave at **2.4** — basin depth is independent of radius; the radial gradient still works.

Outcome: walkable surface ≈ `2π × 8 ≈ 50` sim units around equator (~4× current). User can walk for ~8 seconds in one direction before noticing curvature.

#### Step 2 — Verify dependent constants follow

These already scale off `EARTH_RADIUS`, so no edit needed:

- `ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.08` → 8.64 ✓
- Moon: `MOON_RADIUS = EARTH_RADIUS * 0.27`, `MOON_ORBIT_RADIUS = EARTH_RADIUS * 4.5` → 36 ✓
- Earth halo mesh `EARTH_RADIUS * 1.08` ✓
- `clampToEarthSurface` shell `[EARTH_RADIUS, EARTH_RADIUS + HUMAN_HEIGHT]` ✓
- `spawnOnEarth` standR `EARTH_RADIUS + HUMAN_HEIGHT/2` ✓

Audit (read-only) needed in: `roundUniverse.ts`, `galaxy.ts`, `infinityBinding.ts`, `uqrcPhysics.ts` for any places that hard-coded `2.0` instead of importing `EARTH_RADIUS`.

#### Step 3 — Camera tuning (small, targeted)

In `BrainUniverseScene.tsx`:

- `eyeLift`: **0.85 → 1.6** (proportional to new world; keeps eye at ~head height of a 1.7-tall avatar standing on now-larger planet).
- `fov`: **70 → 60** (narrower FOV reads more naturally now that horizon is further; reduces fish-eye edge clipping).
- `near`: **0.05 → 0.1** (tiny push back; avoids z-fighting with the avatar capsule and the Earth shader).
- `far`: **2000** unchanged (deep-space stars stay visible).

#### Step 4 — Galaxy/world bound check

`WORLD_SIZE` (imported from `uqrcPhysics`) sets the field-engine extents. Read-only confirm it still encloses Earth + Moon orbit (Earth at radius 8, Moon orbit radius 36 → world must be ≥ ~50). If smaller, raise `WORLD_SIZE` constant accordingly. **No field-tick rate change.** This is the one risk gate; if `WORLD_SIZE` change ripples into lattice resolution, fall back to scaling **×3** instead of ×4.

#### Step 5 — Surface-frame stability

The yaw smoothing (`lerp = 0.15`) was tuned for radius=2; on radius=8 the angular rate of basis change drops by 4× naturally. **No change needed**, but add a one-line comment in `PhysicsCameraRig` explaining the dependency for future maintainers.

#### Step 6 — Memory Garden + Source-of-Truth update

- Append a stanza to `MemoryGarden.md` recording the widening: *"The world breathed outward, and the horizon stepped back to meet the avatar."*
- Add a single line to `docs/PROJECT_SOURCE_OF_TRUTH.md` under invariants: **"World scale is observable: any change to `EARTH_RADIUS` propagates to camera, lattice, and basin via single-source constants."**

### Files touched

- `src/lib/brain/earth.ts` — three constants.
- `src/components/brain/BrainUniverseScene.tsx` — `eyeLift`, camera config.
- `src/lib/brain/uqrcPhysics.ts` — read-only audit; only edit if hard-coded radius found.
- `src/lib/brain/roundUniverse.ts`, `galaxy.ts`, `infinityBinding.ts` — read-only audit; same condition.
- `MemoryGarden.md`, `docs/PROJECT_SOURCE_OF_TRUTH.md` — documentation.

### Risk & rollback

- **Risk:** Field basin (Earth pin) covers a small lattice stamp `Math.ceil(EARTH_RADIUS) = 8` cells now vs 2; this enlarges the per-tick pin write but stays well below tick budget.
- **Rollback:** Single-commit revert; no schema or persisted-data change. Saved Brain field snapshots remain valid (they store body positions in world units, which all scale together).

### Out of scope (deferred)

- New avatar mesh for `kind: 'self'` (camera-pierce mitigation via geometry).
- Fog/halo color retune.
- Mobile-specific FOV branch.
- Any change to UQRC tick rate, lattice size, or `FIELD3D_LAMBDA`.

### Sequencing within Phase E

```text
audit constants ──► scale EARTH_RADIUS×4 ──► tune camera (eyeLift/fov/near)
                                                  │
                                                  ▼
                                        verify WORLD_SIZE fits
                                                  │
                                                  ▼
                                        smoke test: walk full equator,
                                        watch horizon, check Moon/Sun
                                                  │
                                                  ▼
                                       MemoryGarden + SoT note
```

### Closing — atom-shell verdict

This fix lives at **Shell n=1** (3D coherence): a single basin radius widening that lets local resonance loops complete without the curvature snap that produced the clip. No new hidden weights, no new transports — only the observable surface (Three.js render) tuned to match the field that already surrounds it.

