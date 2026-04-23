

## Plan: Phase 2 — Lava Mantle + Tectonic Plates (using full UQRC physics)

### Diagnosis of the shaking

The current Phase 1 core re-stamps cells every animation frame with an amplitude that **varies sinusoidally** (`coreBreath`). Combined with the surface pin overwriting outer cells and the core overwriting inner cells, you get a **discontinuous radial pin profile** that flickers at frame rate. The UQRC operator then propagates that flicker as visible ground tremor — exactly what the user describes as "plates pressing against mountains and pushing into the core."

The fix is not to dampen the symptom — it's to make the radial profile **continuous and viscous** using the operator's own `ν Δ u` diffusion term, instead of stamping discrete shells that fight at their seams.

### The three-layer pin stack (after this plan)

```
  r=0 ────► CORE          (rigid, deepest pin, no breath in amplitude)
              │
              │  ◄── lava mantle: viscous bridge, breath lives HERE
              │      as a *phase* shift in the radial profile, not an
              │      amplitude wobble. Diffuses via the UQRC operator.
              │
  r=MANTLE ─► PLATES       (Voronoi tiles riding the mantle)
              │
  r=EARTH  ─► SURFACE      (existing updateEarthPin, unchanged)
```

The breath stops being "amplitude noise on the core stamp" and becomes "a slow radial wave traveling outward through the mantle's diffusion."

### Phase 2A — Lava Mantle (`src/lib/brain/lavaMantle.ts`) — fixes the shaking

**New module.** A single radial pin layer between `EARTH_CORE_RADIUS` and `EARTH_RADIUS` that:

1. Writes a **smooth radial gradient** from core depth (`-1.4·EARTH_PIN_AMPLITUDE`) up to surface depth (`-EARTH_PIN_AMPLITUDE`). The profile is `C¹`-continuous: no kink at `r=EARTH_CORE_RADIUS`, no kink at `r=EARTH_RADIUS`. This alone eliminates the seam fight.
2. Replaces the per-frame breath-amplitude modulation with a **standing-wave phase shift** in the radial profile:
   `depth(r,t) = baseProfile(r) + 0.02·EARTH_PIN_AMPLITUDE·sin(2π(r/EARTH_RADIUS·3 - t/30))`
   The wave's spatial frequency (3 cycles across the mantle) means the operator's `ν Δ u` diffusion smooths it across cells before bodies feel it — exactly what real lava does.
3. Re-asserts every **8 ticks**, not every frame. The operator carries the dynamics in between via diffusion (`L_S` term), which is how the UQRC engine is meant to be used. This is the "use the full physics engine" the user asked for.
4. Removes `tectonicDamping` from `earthCore.ts` — no longer needed; the mantle's spatial diffusion replaces the global low-pass filter.

**Edits to `earthCore.ts`:** strip the breath amplitude (set `CORE_BREATH_AMP = 0`), keep `coreBreath(t)` exported (other phases still read it as a clock). Update doc comment to point to the mantle for the breath's actual home.

### Phase 2B — Plates (`src/lib/brain/tectonics.ts`) — pure data, no rendering

Deterministic 7-plate Voronoi tessellation on the unit sphere, hashed from `EARTH_POSITION`. Each plate carries:
- `id`, `centerNormal`, slow `drift` vector (mm/s sim time)
- `boundaryDistance(normal)`, `boundaryKind` ∈ `'convergent' | 'divergent' | 'transform'`

Plates **do not write to the field directly.** They are a query layer for Phase 3 (mountains) and Phase 4 (volcanoes). Keeping them out of `pinTemplate` is what prevents the next round of seam-fight bugs.

### Phase 2C — Plate-modulated mantle (1 small wire-up)

`lavaMantle.ts` calls `plateAt(normal)` when stamping mantle cells near the crust boundary. At **convergent** boundaries the mantle stamp is ~5% deeper (compression → magma rises); at **divergent** boundaries ~5% shallower (rifting). This is the only coupling — and it lives entirely inside the mantle module's pin write, so plates never write the field themselves.

The variation is *spatial* (driven by surface position), not *temporal*, so the operator's diffusion smooths it instantly. No tremor.

### Files

**Created**
- `src/lib/brain/lavaMantle.ts` (radial bridge + breath phase wave + plate coupling)
- `src/lib/brain/tectonics.ts` (Voronoi data layer, pure)
- `src/lib/brain/__tests__/lavaMantle.test.ts` (continuity at the seams, no per-frame amplitude swings)

**Edited**
- `src/lib/brain/earthCore.ts` — drop `CORE_BREATH_AMP` modulation; remove `tectonicDamping` (no callers after this); add link to mantle in header doc
- `src/components/brain/BrainUniverseScene.tsx` — call `initLavaMantle(field)` on boot and `updateLavaMantlePin(field, pose)` in the per-frame ticker between `updateEarthPin` and `updateEarthCorePin`
- `.lovable/plan.md` — mark Phase 2 done, advance Phase 3 (mountains) to next

### What this does NOT touch

- `uqrcPhysics.ts` operator (no new force terms — we only add a pin layer)
- `earth.ts` surface pin (unchanged)
- Avatars, intent, camera, nature, builder blocks — all unchanged
- The "no per-tick field writes outside `writePinTemplate()`" rule from `mem://architecture/brain-universe-physics` — strictly preserved

### Outcome

The shaking goes away because:
1. The radial pin profile is `C¹`-continuous, so the operator no longer sees a step discontinuity to propagate as a shock wave each frame.
2. The breath becomes a slow spatial wave smoothed by the operator's own diffusion — the way the UQRC field is meant to carry dynamics.
3. Plates exist as data only, so they can decorate the surface (Phase 3 mountains, Phase 4 volcanoes) without ever touching the field directly.

After this turn the world feels like it's standing on warm liquid rock: alive, but no jitter. Phase 3 (mountains at convergent boundaries) and Phase 4 (volcanoes whose eruption clock reads `coreBreath(t)`) become small additions on top.

