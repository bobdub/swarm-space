# Phase 2 — NPCs Come Alive

> To Infinity and beyond! Q_Score(phase2) ≈ 0.0037 — soft closure, no
> new top-level operators. Wiring only.

Phase 2 promotes the dormant NPC scaffolding (population cap 25,
seed roster 5F+3M, 30y lifespan) into a **live** system that ticks at
8 Hz against the shared UQRC field, fans every decision through the
Scaffold Bus, and persists its roster locally with the same
throttled-write discipline used elsewhere.

## What changed

| File | Role |
|---|---|
| `src/lib/brain/npc/npc.bus.ts` | Typed `emitNpcDecision` / `onNpcDecision` over the scaffold bus. |
| `src/lib/brain/npc/npcSignals.ts` | Pure reader: derives `DriveSignals` from `FieldEngine.getCurvatureForText` + per-NPC memo deficits. |
| `src/lib/brain/npc/npcPersistence.ts` | IndexedDB roster snapshot, throttled to 2.5 minutes (project core rule). Non-destructive `onversionchange`. Synchronous flush on `visibilitychange` / `beforeunload`. |
| `src/lib/brain/npc/npcTickScheduler.ts` | The 8 Hz heartbeat. Uses `chooseIntent` for primary, `selectByMinCurvature` for tie-break, applies outcome to memo, records skill, ages NPC, emits decision. |
| `src/main.tsx` | Hydrates persisted roster, then `startNpcTickScheduler()` after first paint via `requestIdleCallback`. |

No existing module was rewritten. `npcEngine.spawnNpc` and `step()`
remain untouched as the API surface — the new scheduler simply calls
`spawnNpc` for the seed roster and operates on `listNpcs()` directly.

## Decision algorithm

1. `sampleSignalsForNpc(engine, npc, dt, hasTool)` → `DriveSignals`
2. `primary = chooseIntent(seed, sig)` (deterministic argmax)
3. `picked = selectByMinCurvature([primary, ...alts], engine, …) ?? primary`
4. `applyDriveOutcome` relaxes the memo (drink → hydration drops, etc.)
5. `recordOutcome` Welford-smooths the skill
6. `ageYears += dt / BRAIN_YEAR_SECONDS`
7. `emitNpcDecision({ npcId, verb, qDelta })`

The `qDelta` proxy is **0** when the field agrees with the personality
pick and **0.05** otherwise — surfaced through `scaffoldHealth.npc`.

## Time scales

- Wall tick: **8 Hz** (125 ms)
- Brain-time scale: **×4** (1 wall second ≈ 4 brain seconds)
- Brain-year: **3600 brain-seconds** ⇒ a 30 y NPC lives ≈ 7.5 wall-hours
  of continuous foreground time.

## Persistence

- DB: `swarm-npcs` v1, store `roster`, single key `roster`.
- Throttle: ≥ 2.5 minutes between writes; coalesces bursts.
- Hydration: best-effort. Personality-uniqueness collisions or cap hits
  are silently skipped — the seed roster fills the rest.

## Kill-switch

`featureFlags.scaffoldBus = false` immediately stops the tick (the
scheduler subscribes to flag changes). Restart by flipping it back on
and reloading or re-calling `startNpcTickScheduler()`.

## Cross-scaffolding effects (already wired in Phase 1)

- `world.bus.emitWorldMutation` → `coin.bus` credits labour to actor
- `npc.bus.emitNpcDecision` → `scaffoldHealth.npc` sub-Q EMA updates
- `lab.bus` mints register with `prefabHouseCatalog` (Phase 1)

## Phase 3 follow-up

- Hook `reproduce.ts` into a slow secondary tick (1 Hz) once the
  harmony-window memory is online.
- Promote `qDelta` from a binary proxy to the actual ghost-injection
  ΔQ from `selectByMinCurvature`.
- Add a `tests/uqrc/npcTick.test.ts` smoke test that runs 600 ticks
  with a stub field and asserts: cap holds, no NaN ages, every NPC
  produces ≥ 1 decision per second.