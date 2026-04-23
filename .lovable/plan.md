

## Fix: "Standing in space / outer atmosphere" after planet scale-up

### Diagnosis

The `alt=1.70m` HUD readout proves your body is correctly on the surface. The issue is **camera clipping**, not spawn position. After scaling Earth from R=8 to R=1700 (×212.5):

| Thing | New distance from camera | Camera `far=2000`? |
|---|---|---|
| Earth surface (under feet) | 0 m | ✓ visible |
| Earth far horizon | ~76 m | ✓ visible |
| Earth opposite side | 3400 m | ✗ clipped |
| Moon | 7,650 m | ✗ clipped |
| Galactic core | 0–4,675 m from origin, but Earth is at (2550, 0, 956) → ~5,500 m away | ✗ clipped |
| Sun | ~12,750 m | ✗ clipped |
| Background stars (was 70–90 m sphere, NOT scaled) | inside the player | ✗ broken |

So you see the curved surface plus pure black void = "outer atmosphere of an asteroid in deep space" look.

### Changes

**1. `src/components/brain/BrainUniverseScene.tsx`** — Canvas camera
- `far: 2000` → `far: 50000` (covers Sun at 12.7k + comfortable margin)
- `near: 0.1` stays (preserves close-up surface detail)
- `fov: 60` stays

**2. `src/lib/brain/galaxy.ts`** — Background star sphere
- The `bgStars` loop uses radius `70..90` (unscaled). Multiply by `WORLD_SCALE` so background stars sit at ~15–19 km, outside Earth, inside the new far plane.

**3. `src/components/brain/GalaxyVisual.tsx`** — Galactic core glow
- Core sphere `args={[1.2, ...]}` and `pointLight distance={30}` are now sub-Earth-scale and invisible. Scale both by `WORLD_SCALE` (core radius → 255 m, light distance → 6,375 m) so the galactic core is a visible feature again.

**4. `src/components/brain/EarthBody.tsx`** — Earth label & near-detail shader
- `Text` label `position={[0, EARTH_RADIUS + 0.6, 0]}` with `fontSize={0.35}` is now a sub-millimetre label on a 1700 m sphere. Scale offset and fontSize by `WORLD_SCALE` (or hide entirely on the planet view).
- Earth shader's near-camera "ground detail" mix uses `smoothstep(2.0, 20.0, dist)` — those distances are still correct (player is metres from surface), so leave them.

**5. Sanity-check pass for any other hard-coded world-space distances**
- Sweep `BrainUniverseScene.tsx`, `StarField.tsx`, `InfinityBody.tsx`, `PortalDefect.tsx` for raw unit numbers (e.g. portal `orbitR = 4.0` at line 1091 — that's now a 4 m sub-surface portal; should scale or be re-anchored to surface tangent + small altitude).

### Acceptance

- Looking up from the surface: visible sky with Sun, Moon, galaxy spiral, background stars.
- Walking forward shows the proper curved horizon (~76 m) with land beyond it instead of an abrupt black cutoff.
- HUD still reads `alt ≈ 1.70m` when standing.
- No regression in the `/brain` chat panel, voice, or remote avatar rendering.

