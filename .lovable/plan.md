
# High-end Starfield + Bloom/Anamorphic Streaks (scoped to /brain)

Note on stack: this project is React Three Fiber (not A-Frame), so `<a-sky>` and `aframe-effects` don't apply. Equivalent capability is delivered with `@react-three/postprocessing` + custom shader stars.

## Goal
Make the existing background starfield in the `/brain` scene look cinematic — high density, per-star magnitude variation, subtle flicker on some / steady on others, and a bloom pass that produces horizontal anamorphic streaks on the brightest stars, layered so the glow bleeds over foreground silhouettes (skyscrapers/bar/trees) while sitting behind the galaxy arms and nebula.

## Scope (what will and will not change)
Will change:
- `src/components/brain/StarField.tsx` — upgrade to shader points with per-star magnitude, twinkle flag, and HDR emissive color so bloom can select them.
- `src/components/brain/BrainUniverseScene.tsx` — add a single `<EffectComposer>` wrapping post passes (Bloom + custom anamorphic streak). Toggleable via a scene-local flag.
- `src/lib/brain/galaxy.ts` — extend `BgStar` with `magnitude: number` and `twinkle: boolean` (deterministic from the existing PRNG; no seed change → same layout, just richer metadata).
- `package.json` — add `@react-three/postprocessing` at the version compatible with R3F v8 / three 0.160 (`^2.16.x`) and its peer `postprocessing` (`^6.35.x`). No other dep changes.

Will NOT change: galaxy layout, seed, star count target for the named 120 stars, `GalaxyVisual`, `AtmosphereSky`, Earth, physics field, routes, or anything outside the files above.

## Design

### 1. Data (galaxy.ts)
- `BgStar` gains `magnitude: 0..1` (skewed so ~5% are bright ≥0.85, ~20% mid, rest dim) and `twinkle: boolean` (~30%). Deterministic via the existing `mulberry32` stream so nothing else shifts.
- Optionally bump `GALAXY_BG_STAR_COUNT` from 3000 to 6000 behind a `HIGH_DENSITY_STARS` constant so density is a one-line change and easy to revert.

### 2. StarField shader
Replace the current `PointsMaterial` with a small `ShaderMaterial` on `THREE.Points`:
- Attributes: `position`, `size`, `magnitude`, `twinklePhase` (0 for steady stars).
- Uniforms: `uTime`, `uPixelRatio`, `uBrightBoost`.
- Vertex: size = `size * pixelRatio * (1 + magnitude*2)`; brightness = `magnitude`, modulated by `sin(uTime*rate + phase)` only when `twinklePhase > 0` (so "some flickering, some steady").
- Fragment: soft round disc with a small radial core; output `vec4(color * intensity, alpha)`. Bright stars emit color >1.0 (HDR) so the Bloom threshold picks them cleanly; dim stars stay under threshold and don't bloom.
- Blending: `AdditiveBlending`, `depthWrite=false`. Parallax behavior (points follow camera x/z) preserved from current implementation.

### 3. Post pipeline (BrainUniverseScene.tsx)
Add once, near the end of the Canvas children (post passes must be siblings of the scene, inside Canvas):

```
<EffectComposer multisampling={0} disableNormalPass>
  <Bloom
    intensity={0.9}
    luminanceThreshold={0.85}
    luminanceSmoothing={0.2}
    mipmapBlur
    radius={0.6}
  />
  <AnamorphicStreak strength={0.7} length={0.35} threshold={0.9} />
</EffectComposer>
```

- `Bloom` gives the omnidirectional glow that bleeds over skyscraper/bar/tree edges (that's just how a screen-space bloom composites — no extra layering work).
- `AnamorphicStreak` is a tiny custom `Effect` (postprocessing's `Effect` class) implementing a horizontal-only blur of the bright-pass texture, added on top. This is the "anamorphic horizontal lens flare" look. Kept as one file: `src/components/brain/postfx/AnamorphicStreak.ts` (new file, isolated).

### 4. Layering ("composite" behind nebula, in front of skyscrapers)
Because Bloom is a screen-space post pass, glow naturally bleeds over foreground silhouettes — no compositing hack needed. The stars themselves are drawn first (`renderOrder = -2`) so they read as behind the galaxy visual and any nebula sprites (`renderOrder = -1`).

### 5. Perf guardrails
- Composer is created once; passes memoized. Threshold at 0.85 means only the brightest ~5% pixels contribute → cheap on mobile.
- `multisampling={0}` (post already anti-aliases via mipmapBlur).
- Feature-gate: `const ENABLE_POST_FX = !isMobile` (uses existing `useIsMobile`) so mobile keeps current fps.
- Star count bump lives behind `HIGH_DENSITY_STARS` — easy to dial back if fps regresses.

## Verification
1. `bun run build` and `tsgo` on the 3 touched files pass.
2. Visit `/brain`: bright stars show soft halos and horizontal streaks; dim stars remain crisp pinpricks; ~30% of stars gently flicker.
3. Move camera near a skyscraper against a bright star — halo bleeds over its silhouette.
4. Galaxy arms and nebula still render in front of the background starfield.
5. Toggle `ENABLE_POST_FX` off → scene matches current look exactly (safety fallback).

## Technical notes
- Package versions pinned for R3F v8 compatibility: `@react-three/postprocessing@^2.16.0`, `postprocessing@^6.35.0`. Any newer major requires R3F v9 / React 19 and must not be installed.
- No changes to physics, field pins, WORLD_SCALE, or `GalaxyVisual`. The bright named stars in `GalaxyVisual` will also bloom naturally because they use `MeshStandardMaterial` with `emissiveIntensity=1.4` — this is the intended "glow bleeds over skyscraper edges" behavior and requires no code there.

## Out of scope
Nebula assets, HDR skybox, lens dirt textures, screen-space god rays, and A-Frame-specific tooling. Can be follow-ups if you want them.
