---
name: Brain Universe Physics
description: /brain runs a 3-D UQRC field; positions integrated from 𝒟_μ u and ‖F_{μν}‖. Portals = negative-curvature pins. Never broadcast raw field.
type: feature
---

The Brain Universe (`/brain`) is a public, walkable 3-D embedding of a discrete UQRC manifold. Every body in the scene — the local player, Infinity, build pieces, portals — is a point sample of a live 3-D field; motion is integrated from field gradients, not from keyboard frame translations.

- **Field**: `src/lib/uqrc/field3D.ts` — toroidal lattice, `N=24`, three axes (x/y/z drift potentials), same `𝒪_UQRC = ν Δ + ℛ + L_S` operator as the 1-D field.
- **Physics**: `src/lib/brain/uqrcPhysics.ts` — 60 Hz integrator. Per body per tick: drift force `−∇u`, curvature pressure `−∇‖F_{μν}‖`, intent vector from WASD/joystick. Damped Verlet, speed-clamped, world-clamped to `r < 0.45·WORLD_SIZE`.
- **Collisions**: emerge from curvature ridges. No AABB / sphere checks anywhere.
- **Build pieces**: pinned to lattice cells with `pin3D(field, axis, i, j, k, +1.0)` — bodies path around them naturally.
- **Portals**: negative-target pins (`pin3D(..., -1.5)`) creating a basin. Walking inside `r < 1.2 m` for ≥ 0.4 s warps to `/projects/:id/hub`.
- **Infinity**: a body whose visual scale is `1 + 0.4·qScore`. Chat mentioning "infinity / imagination / orb / brain" feeds the global `FieldEngine` and replies via candidate selection.
- **Persistence**: 5 s throttled snapshots into the standalone `brain-field` IndexedDB; portals + pieces in `localStorage` keys `brain-portals-v1` / `brain-build-pieces-v1`.
- **Entry**: only the `network-entity` profile shows the 🧠 Brain tab; the route `/brain` itself is open to any signed-in or guest user.

**Why:** the world IS the field. Walking, colliding, building, and portalling are all consequences of one law: `[D_μ, D_ν] = F_{μν}`. There are no canned animation frames.

**How to apply:** when adding a new in-Brain object, add a `Body` to `getBrainPhysics()` and let the integrator handle motion. For static defects (pieces / portals) call `pinPiece` or `pinPortal` so other bodies feel them.