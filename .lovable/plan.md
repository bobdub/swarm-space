

## Land/street alignment fix — render the ground where the avatar's feet actually are

### Root cause

Two mismatches between the **render** and the **physics**:

1. **Vertical offset.** `spawnOnStreet` puts the body *center* at `INTERIOR_RADIUS − HUMAN_HEIGHT/2` from `pose.center` — feet at `INTERIOR_RADIUS − HUMAN_HEIGHT` (≈ 1.7 m **below** the inner shell), not on it. Meanwhile `StreetMesh` renders the road at the patch center (`y = 0` in the local frame) which corresponds to radius ≈ `INTERIOR_RADIUS`. Result: the avatar stands ~1.7 m below the road slab → "lands above ground" / "drifts" because the road floats overhead.

2. **Flat road vs. curved shell.** `StreetMesh` is a flat `planeGeometry` tangent to the shell at the patch center. The interior clamp keeps the body on the *sphere* of radius `INTERIOR_RADIUS − HUMAN_HEIGHT/2`. As the body moves tangentially, the curved shell pulls feet away from the flat slab — visible as drift even when stationary because of small co-rotational residuals.

### Fix

**Single principle:** the road and land are rendered exactly where the feet are — on the *standing sphere* of radius `STANDING_R = INTERIOR_RADIUS − HUMAN_HEIGHT`, curved to match.

#### A. Make `street.ts` expose the standing radius

- **EDIT** `src/lib/brain/street.ts`:
  - Export `STANDING_RADIUS = INTERIOR_RADIUS − HUMAN_HEIGHT` (import `HUMAN_HEIGHT` from `earth.ts`).
  - In `buildStreet`, project particles onto `STANDING_RADIUS` instead of `INTERIOR_RADIUS` so the UQRC pin grid matches what the player walks on.
  - Recompute `centerLocal` to live on `STANDING_RADIUS` as well.

#### B. Curve the rendered road + land to the shell

- **EDIT** `src/components/brain/StreetMesh.tsx`:
  - Replace the flat `planeGeometry`/`circleGeometry` with a **tessellated patch** built from `street.particles`: for each cell, place a small quad (or use `BufferGeometry` triangulating the (u,v) grid) with vertices projected onto the standing sphere — i.e. exactly the `local` coords already produced by `buildStreet` (since they now live on `STANDING_RADIUS`).
  - Two materials: cells with `kind === 'road'` → grey; `kind === 'land'` → green. Centerline dashes become small quads laid on top of road cells along the tangent axis.
  - Lift each vertex outward (away from cavity, i.e. along `+normalLocal`) by a tiny `0.005` so z-fighting with the shell doesn't flicker.

#### C. Fix the spawn / clamp to land *on* the road, not below it

- **EDIT** `src/lib/brain/earth.ts` `spawnOnStreet`:
  - Body center should sit `HUMAN_HEIGHT/2` **inward of the road surface**, where the road surface is now at `STANDING_RADIUS`. That gives `bodyCenterR = STANDING_RADIUS − HUMAN_HEIGHT/2`. Feet (at `bodyCenterR + HUMAN_HEIGHT/2 = STANDING_RADIUS`) coincide with the road. (Currently it computes `shellR − HUMAN_HEIGHT/2` which puts feet on the wrong sphere.)

- **EDIT** `src/lib/brain/uqrcPhysics.ts` interior clamp (~437):
  - Change `minR`/`maxR`/`target` to use `STANDING_RADIUS` rather than `INTERIOR_RADIUS`. New target body-center radius: `STANDING_RADIUS − HUMAN_HEIGHT/2`. Same radial-velocity zeroing logic preserved.

- **EDIT** `BrainUniverseScene.tsx` boot anchor (~757):
  - `target = STANDING_RADIUS − HUMAN_HEIGHT/2` for interior bodies.

#### D. Tests

- **EDIT** `src/lib/brain/__tests__/street.test.ts`:
  - Update the radius assertion: spawned body is in `[STANDING_RADIUS − HUMAN_HEIGHT, STANDING_RADIUS]`, with center at `STANDING_RADIUS − HUMAN_HEIGHT/2` (±ε).
  - New test: every `street.particles[i].local` has `‖local‖ ≈ STANDING_RADIUS` (not `INTERIOR_RADIUS`), so the road and the body share the same sphere.

### Files touched

- **EDIT** `src/lib/brain/street.ts` — new `STANDING_RADIUS`, particles project to it, `centerLocal` on it.
- **EDIT** `src/lib/brain/earth.ts` — `spawnOnStreet` uses `STANDING_RADIUS`.
- **EDIT** `src/lib/brain/uqrcPhysics.ts` — interior clamp uses `STANDING_RADIUS`.
- **EDIT** `src/components/brain/StreetMesh.tsx` — curved tessellated patch driven by `street.particles`, road/land colors per cell, dashes as small quads.
- **EDIT** `src/components/brain/BrainUniverseScene.tsx` — boot anchor target uses `STANDING_RADIUS`.
- **EDIT** `src/lib/brain/__tests__/street.test.ts` — updated radius expectations + new "particles lie on standing sphere" case.

### Acceptance

```text
1. On entering /brain, the avatar's feet visibly rest on the road slab —
   no gap between body and ground, no clipping into shell.
2. Walking tangentially keeps feet on the road across the entire patch
   (the road curves with the inner shell instead of going flat-tangent).
3. Standing still with no input: position is bit-exact stable across
   ≥ 10 s (the existing tangential-rest bleed continues to work, but
   there is no longer a render-vs-physics offset to perceive as "drift").
4. UQRC pins for road/land cells fall on the same sphere the body
   integrates on, so injectAt at the body's position lands on a pinned
   cell (verifiable by snapshotting field values after one tick).
5. Existing street/earth tests pass with the new radius constants;
   new "particles on standing sphere" test passes.
```

