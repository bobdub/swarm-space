# Plan: Earth's Core + Tectonic Surface (Phased)

Goal: give Earth a living core, plates that ride on it, and the surface
features that emerge where plates meet — mountains (collision) and
volcanoes (subduction / hotspots). Each phase is independently shippable.

## Phase 1 — Core (this turn)

**New `src/lib/brain/earthCore.ts`**
- Constants: `EARTH_CORE_RADIUS = 0.35 * EARTH_RADIUS`, `MANTLE_RADIUS = 0.85 * EARTH_RADIUS`.
- `initEarthCore(field)`: writes a deep negative-curvature pin at Earth's centre (amplitude `EARTH_PIN_AMPLITUDE * 1.4`) so intent inside the body always slopes inward — the anchor that stops the "flip upside down" problem.
- `coreBreath(t)`: slow sinusoid (period ~30 s, amp ~0.04) — the heartbeat.
- `tectonicDamping(intent, t)`: low-pass filter that absorbs the breath at the surface so inhabitants don't feel nausea.
- Re-assertion every 240 ticks (matches `roundUniverse`).

**Edited**
- `src/lib/brain/uqrcPhysics.ts` — call core breath + damping in the Earth atmosphere branch.
- `src/components/brain/BrainUniverseScene.tsx` — `initEarthCore(field)` once on field init.

## Phase 2 — Plates

**New `src/lib/brain/tectonics.ts`**
- 7 deterministic plates seeded by hashing `EARTH_POSITION`. Each plate = a Voronoi cell on the unit sphere with a slow drift vector (~mm/s sim time).
- `plateAt(normal)` → `{ id, drift, boundaryDistance, boundaryKind }` where `boundaryKind ∈ 'convergent' | 'divergent' | 'transform'` (derived from neighbour drift dot product).
- Pure data — no rendering. Used by Phase 3/4 to decide where to grow mountains and volcanoes.

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

