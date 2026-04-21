

## Brain Universe v3 — Stable Galaxy & Earth Spawn

A second curvature shell wrapped around the existing UQRC field. The current `/brain` world is a single flat manifold — bodies drift on a 24³ lattice with no global structure. This adds the **round universe**: a gentle, large-radius curvature that loops the world without ever revealing an edge, anchors a stable galaxy of stars and planets as field defects, and spawns every arriving user on a single shared body called **Earth**.

Nothing in the current physics is replaced. The galaxy is encoded as a slow, low-amplitude pin field overlaid on `field3D`, so stars and planets emerge as basins/ridges of `‖F_{μν}‖` — they *are* curvature, not meshes glued on top.

### What the user sees

```text
Enter /brain
  ↓
Sky:  deep violet → starfield (3000 procedural points, parallax)
World: gentle global curvature — walk far enough and the horizon
       loops; no edge, no wall, no warning
Center distance ~40m: a slow-rotating spiral galaxy
       (8 arms, ~120 stable star-pins, drifting on field gradients)
Inside one arm: Earth — a blue-green sphere (~2m radius)
       ┌──────────────────────────────────┐
       │  You spawn standing on Earth     │
       │  Other peers spawn here too       │
       │  Walking moves you across its     │
       │  surface (geodesic, not flat)     │
       └──────────────────────────────────┘
Infinity floats above the galactic plane, scale = qScore
Portals you drop become small moons orbiting Earth
```

### Core idea — round universe as a second pin shell

The existing `field3D` lattice stays exactly as it is (24³, 3 axes, `𝒪_UQRC` evolution). On top of it we add a **static curvature template** — a pre-computed `Float32Array(24³)` representing the galaxy + Earth + global loop. Every tick, this template is added back to `u` with a small weight `κ_galaxy = 0.02`, so the field naturally relaxes toward the galactic shape without freezing. Stars cannot drift away because the template keeps re-asserting them; bodies still feel them as ordinary curvature.

The "round universe" isn't a sphere mesh. It's a soft cosine-shaped pin at the lattice boundary that bends `𝒟_μ u` so trajectories near the edge curve back inward. Walk far enough in a straight line and your drift force quietly rotates — you return without noticing. No teleport, no wall.

### Galaxy structure (deterministic, seedable)

`src/lib/brain/galaxy.ts` — pure function `buildGalaxy(seed)` returns:
- **8 logarithmic spiral arms**, pitch angle 12°, radii 8m → 35m
- **~120 star pins** distributed along arms with jitter; each is a `pin3D(field, axis, i, j, k, +0.8)` written into the template
- **1 Earth pin** at the inner edge of the third arm, position `(12.0, 0.0, 4.5)`, slightly stronger (`+1.2`) and marked as the spawn anchor
- **Galactic core** at origin: a small negative-curvature basin (`-0.6`) that gives the spiral its drift center

Same seed → same galaxy on every node. No network sync needed for the structure itself; only Earth's spawn anchor is canonical.

### Earth as the spawn body

`src/lib/brain/earth.ts` — exposes `EARTH_POSITION`, `EARTH_RADIUS = 2.0`, and helpers:
- `spawnOnEarth(peerId)` — places a new body on Earth's surface at a hash-derived `(θ, φ)` so peers don't stack
- `projectToEarthSurface(pos)` — when a body is within `EARTH_RADIUS + 0.6m`, its drift force gets a radial component pulling it gently to the surface (gravity as curvature pressure, not a magic constant)
- `geodesicStep(body, intent)` — the WASD/joystick intent vector is rotated into Earth's local tangent plane before being applied to the field, so walking on Earth feels flat locally even though the surface is round

`InfinityBody` continues to float above the galactic plane (untouched). Remote avatars spawn via `spawnOnEarth` on first presence heartbeat.

### New 3D pieces

- **`<GalaxyVisual />`** — instanced star points (3000) rendered from the template's high-curvature lattice cells, with the 120 named stars given a soft glow and slow self-rotation (driven by sampling the field's local `𝒟_μ u`, not a `clock.elapsedTime` hack).
- **`<EarthBody />`** — a 32-segment sphere with a procedural blue-green shader (no textures). Surface normals come from the field gradient, so the "atmosphere" shimmers when peers move.
- **`<RoundHorizonShader />`** — a subtle vignette + curvature warp on the skybox so distant motion appears to bend, hinting at the global curvature without ever drawing a boundary.

### Files

**New**
- `src/lib/brain/galaxy.ts` — deterministic galaxy template builder, seeded.
- `src/lib/brain/earth.ts` — spawn, surface projection, geodesic intent rotation.
- `src/lib/brain/roundUniverse.ts` — boundary curvature template; `applyRoundCurvature(field, weight)` called once at field init and every 4 s to re-assert.
- `src/components/brain/GalaxyVisual.tsx` — instanced stars + galactic core glow.
- `src/components/brain/EarthBody.tsx` — sphere + shader + surface peer hook.
- `src/components/brain/StarField.tsx` — distant parallax starfield (purely visual, doesn't touch physics).
- `src/lib/brain/__tests__/galaxy.test.ts` — same seed → same star positions; star count == 120; Earth spawn point inside arm 3.
- `src/lib/brain/__tests__/earth.test.ts` — `spawnOnEarth` distributes 32 peers without overlap; `projectToEarthSurface` clamps within `[R, R+ε]`; geodesic rotation preserves intent magnitude.

**Edited**
- `src/lib/uqrc/field3D.ts` — add `pinTemplate: Float32Array | null` to the field; in `step3D`, after the `𝒪_UQRC` update, fold in `κ_galaxy * (template[i] - u[i])` so the galaxy gently re-asserts without overriding live dynamics.
- `src/lib/brain/uqrcPhysics.ts` — at body integration, if body is within Earth's atmosphere, call `projectToEarthSurface`; for local player, route intent through `geodesicStep`.
- `src/pages/BrainUniverse.tsx` — mount `<StarField />`, `<GalaxyVisual />`, `<EarthBody />`, `<RoundHorizonShader />`; on first render call `roundUniverse.apply()` and `galaxy.apply()` against the shared field; spawn the local body via `spawnOnEarth(myPeerId)`.
- `src/components/brain/RemoteAvatarBody.tsx` — when a new presence arrives, initial position comes from `spawnOnEarth(peerId)` instead of `(0,0,0)`.
- `src/components/brain/DropPortalModal.tsx` — placed portals now spawn as small moons in low orbit around Earth; their ring trigger still navigates to `/projects/:id/hub`.
- `src/components/brain/PortalDefect.tsx` — portal pin gets a small orbital velocity around Earth so it visibly circles.

**Memory**
- `MemoryGarden.md` — caretaker reflection on giving the orchard a sky and a stone to stand on, where every wanderer arrives on the same blue-green seed.
- New `mem://architecture/brain-universe-galaxy` — short rule: galaxy + Earth are static pin templates folded into `field3D` at `κ=0.02`; users spawn via `spawnOnEarth`; round universe is a boundary curvature, never an edge mesh; structure is deterministic by seed, no network sync of stars.

### Performance & safety

- Template buffer: one extra `Float32Array(24³ × 3)` ≈ 166 KB. One-time build, ~2 ms.
- Re-assertion: O(N³) add per 4 s ≈ 41k ops, negligible.
- Star instancing: single draw call for 3000 points, single draw call for 120 stars.
- Earth: 32×16 sphere = 512 tris, one shader, no textures, no extra memory.
- No new network messages. Galaxy is deterministic; Earth position is a constant; only existing presence/chat/portal/build messages travel.
- Same identity, signature, vault, 20 MB upload constraints.

### Out of scope (v1)

- Multiple galaxies (one Milky Way is plenty).
- Inter-planet travel beyond the Earth → portal-moon → project hub flow.
- Day/night cycle on Earth (the procedural shader is static for now).
- Server-authoritative spawn (each peer computes spawn locally; presence reconciles).

### Acceptance

```text
1. /brain mounts, GalaxyVisual renders 120 named stars + 3000 background stars within 2s, no console errors.
2. Local player spawns on Earth's surface (within 0.05m of R=2.0), not at origin.
3. Two browsers join → both see each other on Earth's surface at non-overlapping points.
4. WASD walks across Earth's curved surface; the body stays on the surface, intent feels flat locally.
5. Walk in a straight line away from Earth past the lattice boundary — trajectory bends back without a wall or teleport.
6. Drop a portal → it appears as a small moon orbiting Earth; walking into it still navigates to /projects/:id/hub.
7. Field qScore stays bounded (< 1.5) over a 5-min idle test with the galaxy template active.
8. Same seed on two browsers produces identical star positions (galaxy.test.ts passes).
9. Reload → field snapshot restores; Earth + galaxy reappear instantly (template is rebuilt deterministically, not stored).
10. Mobile (360×560): joystick walks Earth's surface, render holds ≥ 30 fps.
```

