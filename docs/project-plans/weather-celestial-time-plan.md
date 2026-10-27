# Weather pacing & shared celestial time — plan (doc only, not scheduled)

Status: **planned, not started.** Captured 2026-10-20. Game-paced polish, not a
correctness emergency — implement when a world-systems pass is scheduled.

## Problem statement

Users observe the weather changing drastically second-to-second in the Brain.
Investigation found two root causes:

1. **The Moon is not synced.** `src/components/brain/EarthBody.tsx` drives the
   lunar orbit from *local elapsed shader time* with a 40-second orbit. Earth's
   spin uses a shared UTC epoch, so two peers see the same Earth but different
   Moons. Any future space exploration inherits this divergence.
2. **Weather timescales are wall-clock fast.** `src/lib/world/weather.ts` ticks
   at 1 Hz; clouds nucleate at a low threshold (`NUCLEATION_SCORE = 0.06`),
   charge to rain within seconds (`charge += score`, raining at `charge >= 1`),
   and drain in ~11 ticks (`charge -= 0.09`). The field-readout design is
   sound — the pacing constants are not.

## Design decisions (agreed)

- **One shared sky.** Sun and Moon positions derive from the same UTC-epoch
  clock Earth already uses, so every peer computes an identical sky. This is
  the foundation for shared space exploration later.
- **Game week = real day.** 7 in-game days per real 24 hours → one in-game day
  is 24 / 7 ≈ 3.4286 hours (12,342.857 s). Long enough to feel like a day,
  short enough that players see the moon without waiting a real day.
- **One sunrise, one sunset per in-game day.** The Sun's apparent motion comes
  from Earth rotation alone.
- **One moonrise, one moonset per in-game day.** The Moon orbits slowly (a
  ~28 in-game-day lunar cycle for phases); Earth's rotation carries each
  location through a single lunar rise/set daily.

## Implementation outline (when scheduled)

1. **Shared celestial epoch** — extend `src/lib/brain/earth.ts` with
   epoch-derived Sun and Moon direction helpers; remove the local-time 40 s
   orbit from `EarthBody.tsx` and render the Moon from the shared helpers.
2. **Game-time constant** — define the in-game day length (12,342.857 s) in
   one place; sky, and later weather, scale from it.
3. **Weather pacing** — keep the UQRC field-readout architecture (no
   `Math.random`, all quantities read from `u`). Slow the loop: raise
   `NUCLEATION_SCORE`, scale charge/drain and drift deltas by game time rather
   than wall-clock seconds, so clouds take in-game hours to form and rain.
4. **Tests** — extend `src/lib/brain/__tests__/earth.test.ts` and
   `src/lib/world/__tests__/weather.test.ts`: two "peers" with different local
   runtimes agree on sky position for a fixed epoch; day-length constant
   holds; cloud lifetimes are minutes-scale, not seconds-scale.

## Verification & scope

- Automated tests only; no live multi-peer sky verification (standing
  preference).
- Out of scope: space exploration itself, weather rendering/visual changes,
  any change to the field-readout physics model.
