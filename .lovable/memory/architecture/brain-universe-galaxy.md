---
name: Brain Universe Galaxy & Earth
description: /brain wraps the 3-D UQRC field in a deterministic galaxy + round-universe shell. Earth is the spawn body; structure is local-only, never gossiped.
type: feature
---

The Brain Universe (`/brain`) sits inside a **deterministic galaxy** built from a fixed seed (`GALAXY_SEED`) and folded into the existing 3-D field as static **pin templates** — not extra meshes glued on top. The world is also wrapped in a **round-universe** boundary: a soft cosine curvature ramp that bends `𝒟_μ u` at the lattice edge, so trajectories loop back without ever revealing a wall.

- **Galaxy** (`src/lib/brain/galaxy.ts`): 8 logarithmic spiral arms (pitch 12°), 120 named star pins, 3000 background stars. Galactic core at the origin is a small negative-curvature basin. `applyGalaxyToField(field, galaxy)` writes the pins on field init.
- **Earth** (`src/lib/brain/earth.ts`): constant position `(12.0, 0.0, 4.5)`, `EARTH_RADIUS = 2.0`. Anchored as a strong pin (`+1.2`). Helpers: `spawnOnEarth(peerId)` (Fibonacci-sphere slot from a `djb2` hash), `earthGravityForce` (radial pull inside the atmosphere; gravity-as-curvature, not a magic constant), `geodesicStep` (rotates intent into the local tangent plane so walking feels flat), `projectToEarthSurface` (last-resort interior clamp).
- **Round universe** (`src/lib/brain/roundUniverse.ts`): `applyRoundCurvature(field, weight)` writes a cosine ramp into the outer 22% of the lattice on each axis, biased radially outward. Re-asserted occasionally so live dynamics don't erode it.
- **Spawn**: every arriving peer (local self + remote avatars) starts at `spawnOnEarth(peerId)`. Same id → same slot across reloads. No network sync of stars or Earth — structure is deterministic by seed.
- **Physics** (`uqrcPhysics.ts`): if a body is inside Earth's atmosphere, intent is routed through `geodesicStep` and `earthGravityForce` is added; Y motion is allowed and clamped to the surface. Otherwise the legacy plane behaviour applies.
- **Visuals**: `<StarField />` (3000 instanced points), `<GalaxyVisual />` (instanced star spheres + glowing core), `<EarthBody />` (procedural blue-green shader, no textures).
- **Portals as moons**: dropped portals spawn at `r=4 m` above Earth's surface; the existing 1.2 m dwell trigger still navigates to `/projects/:id/hub`.

**Why:** the galaxy must look round, feel round, and yet never reveal a boundary. Encoding it as field pins keeps it consistent with the UQRC physics already running — stars repel via curvature, Earth grips via gravity-as-curvature, the edge bends back via cosine ramp. No mesh, no skybox sphere, no teleport.

**How to apply:** when adding new astronomical bodies, write them as pins (`pin3D`) into the field on init; never as standalone meshes only. When adding new spawn behaviour, route through `spawnOnEarth` so peers don't stack and the position is deterministic per id.