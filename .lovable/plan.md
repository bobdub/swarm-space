# Plan: Earth's Core + Tectonic Surface (Phased)

Goal: give Earth a living core, plates that ride on it, and the surface
features that emerge where plates meet — mountains (collision) and
volcanoes (subduction / hotspots). Each phase is independently shippable.

## Phase 1 — Core ✅ DONE

**New `src/lib/brain/earthCore.ts`**
- Constants: `EARTH_CORE_RADIUS = 0.35 * EARTH_RADIUS`, `MANTLE_RADIUS = 0.85 * EARTH_RADIUS`.
- `initEarthCore(field)`: writes a deep negative-curvature pin at Earth's centre (amplitude `EARTH_PIN_AMPLITUDE * 1.4`) so intent inside the body always slopes inward — the anchor that stops the "flip upside down" problem.
- `coreBreath(t)`: slow sinusoid (period ~30 s, amp ~0.04) — the heartbeat.
- `tectonicDamping(intent, t)`: low-pass filter that absorbs the breath at the surface so inhabitants don't feel nausea.
- Re-assertion every 240 ticks (matches `roundUniverse`).

**Edited**
- `src/lib/brain/uqrcPhysics.ts` — call core breath + damping in the Earth atmosphere branch.
- `src/components/brain/BrainUniverseScene.tsx` — `initEarthCore(field)` once on field init.

## Phase 2 — Lava Mantle + Plates ✅ DONE

- `src/lib/brain/lavaMantle.ts` — C¹-continuous radial pin bridges core ↔ surface. Breath is now a *spatial* standing wave (`sin(2π(rNorm·3 − t/30))`), smoothed by the operator's `ν Δ u` diffusion. Re-stamps every 8 ticks; operator carries dynamics in between. Eliminates the per-frame ground tremor.
- `src/lib/brain/tectonics.ts` — 7-plate Voronoi tessellation hashed from `EARTH_POSITION`. Pure data: `plateAt(normal)`, `boundaryInfo(normal)` → `{ plateId, neighbourId, boundaryDistance, boundaryKind }`. Plates never write the field.
- Mantle consults `boundaryInfo` spatially: ±5% pin-depth bias at convergent / divergent seams. No temporal coupling → no jitter.
- `earthCore.ts`: `CORE_BREATH_AMP = 0` (rigid core), `tectonicDamping` removed.

## Phase 3 — Mountains (convergent boundaries)

**New `src/components/brain/SurfaceMountain.tsx`** + `src/lib/brain/nature/mountainSeed.ts`
- Seed mountains along convergent plate boundaries. Height ∝ relative drift magnitude.
- Uses the existing `pinPiece` / `builderBlockEngine` so they integrate with the field, not just visuals.
- Registers with `natureCatalog` so they participate in the existing nature pipeline.

## Phase 4 — Volcanoes (subduction + hotspots)

**New `src/components/brain/SurfaceVolcano.tsx`** + `src/lib/brain/nature/volcanoSeed.ts`
- Place at convergent boundaries with downward drift (subduction) plus a few hash-deterministic hotspots inside plate interiors.
- Volcano "pulse" timing modulated by `coreBreath(t)` — eruptions happen on the core's heartbeat. This is the first visible expression of the core for inhabitants.

## Phase 5 — Polish

- Optional debug overlay (`?debugCore=1`) showing plate boundaries, drift arrows, and core pulse.
- Tune amplitudes so the surface feels alive but never disorienting.

---

**This turn implements Phase 1 only.** Phases 2–5 are queued.

