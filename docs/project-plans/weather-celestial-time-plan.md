# Weather pacing & shared celestial time — plan

Status: **implemented 2026-11-17.** Captured 2026-10-20. See "Implementation
notes" at the end for the one decision taken during implementation.

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

## Implementation notes (2026-11-17)

- **Whole solar system orbits (decided by the project owner).** With the Sun
  fixed in the world and Earth circling the galactic core every 6 h, the
  Sun's direction swung ±40°, so game days varied 2.8–3.9 h and "one sunrise
  per day from rotation alone" could not hold. Nothing is static now: the
  Sun travels with Earth along the unchanged 6 h galactic orbit
  (`EARTH_ORBIT_PERIOD`), Earth revolves around the Sun once per in-game year
  (`GAME_YEAR_DAYS = 365`, constant Sun distance, same Sun as before at the
  epoch), and the Moon revolves around Earth.
- **Game time** lives in `src/lib/brain/earth.ts`: `GAME_DAY_SECONDS`
  (86 400 / 7), `GAME_HOUR_SECONDS`, `GAME_YEAR_DAYS`, `LUNAR_CYCLE_DAYS = 28`.
- **Sidereal periods.** Spin and Moon orbit are prograde, so their sidereal
  periods are `1/(1/day + 1/year)` and `1/(1/lunar cycle + 1/year)`. That keeps
  the solar day at exactly one game day and the phase cycle at 28 game days;
  the Moon rises ~27 times per 28 days, like the real one.
- **Live positions.** `EarthPose` now carries `sun` and `moon`; the scene
  light (`SunLight.tsx`), Earth/Moon/atmosphere shaders, minimap, spawn,
  lightspeed probes and weather read them. `SUN_POSITION` is the epoch value.
- **Weather pacing** (`src/lib/world/weather.ts`): rates are per in-game hour
  times `WEATHER_TICK_GAME_HOURS`; `NUCLEATION_SCORE` 0.06 → 0.6; clouds start
  dry and charge at `0.5 × min(1, score)` per game hour (≥ 2 game hours to
  rain), rain drains 1 charge per game hour, drift is 900 arc-metres per
  lattice gradient per game hour. Field injections are unchanged.
- **Tests:** `src/lib/brain/__tests__/celestial.test.ts` and the live-field
  pacing test in `src/lib/world/__tests__/weather.test.ts` (steps the real
  UQRC solver at 60 Hz between 1 Hz weather reads).
