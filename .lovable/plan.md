# Weather & celestial-time fixes + documentation cleanup

Two workstreams, done in one pass. Weather/time is game-paced and not urgent, so the cleanup comes first and the weather fix lands behind it.

## Part 1 — Documentation cleanup (fresh start)

1. **Create `docs/CURRENT_STATE.md`** — the single source of truth for where the project truly is: what works, what is built but awaiting live peer testing (wall viewer controls, NPC embodiment, companion pairing, screen sharing), what is planned, and what is retired.
2. **Classify every doc in `docs/`** into current / resolved / superseded / idea-only:
   - Move resolved or superseded items into `docs/archive/` (e.g. old audits, phase plans whose direction changed, `ROADMAP_PROJECTION.md`, stale UQRC audit, old streaming assessment if superseded).
   - Delete nothing outright at first — archive so history is preserved.
3. **Deduplicate**: `PROJECT_OVERVIEW.md` / `PROJECT_SOURCE_OF_TRUTH.md` / `Unified_Source_of_Truth.md` / `PROJECT_SPEC.md` overlap heavily — merge into `CURRENT_STATE.md` and archive the rest. Same for the neural-content plan trio in `docs/project-plans/`.
4. **Trim `docs/KNOWN_ISSUES.md`** to only genuinely open issues (NPC embodiment stays; resolved cleanup log entries move to archive).
5. **Update `roadmap.md`**: collapse completed sections into a short "recently shipped" list, keep open deferred items, and add the weather/celestial entry below as planned-not-started.
6. Leave `.lovable/plan/` archives and `mem://` memory alone — those are history, not active docs.

## Part 2 — Weather & celestial time fixes

Root causes found earlier: the Moon orbits on **local elapsed shader time** (40 s orbit) instead of the shared UTC epoch Earth uses, so peers see different lunar positions; weather ticks at 1 Hz with a low nucleation threshold and fast charge/drain, so clouds form and dump rain within seconds.

1. **Shared celestial epoch in `src/lib/brain/earth.ts`**: drive Sun and Moon from the same UTC-epoch clock the Earth spin uses, so every peer computes identical sky positions (foundation for future space exploration).
2. **Game-time cadence**: 7 in-game days per real 24 h → one in-game day = 12,342.857 s (3.4286 h). The Sun rises and sets exactly once per in-game day.
3. **Moon**: deterministic orbit from the shared epoch with a longer lunar cycle (28 in-game days), so each location still sees one moonrise/moonset per game day; remove the 40 s local-time orbit in `src/components/brain/EarthBody.tsx`.
4. **Weather pacing in `src/lib/world/weather.ts`**: keep the field-readout design (no `Math.random`, all quantities from `u`) but slow the loop — raise `NUCLEATION_SCORE`, lengthen charge/drain rates so clouds take minutes (game-time) to form and rain, and consider a longer tick interval or time-scaled deltas tied to game time rather than wall-clock seconds.
5. **Tests**: extend `src/lib/world/__tests__/weather.test.ts` and `src/lib/brain/__tests__/earth.test.ts` — deterministic sky position from a fixed epoch (two "peers" at different local runtimes agree), day length constant, cloud lifetime no longer seconds-scale.

## Verification
- `docs/CURRENT_STATE.md` reviewed against roadmap/memory; build OK.
- Weather/celestial changes verified with automated tests only — no live peer testing, per standing preference.

## Deferred / out of scope
- Space exploration itself, weather rendering changes, live multi-peer sky verification.
