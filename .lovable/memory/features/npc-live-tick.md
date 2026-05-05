---
name: npc-live-tick
description: Phase-2 wiring — 8 Hz NPC scheduler with field-derived drive signals, min-curvature tie-break, throttled IndexedDB roster snapshots, scaffoldBus kill-switch, BRAIN_TIME_SCALE×4
type: feature
---
The NPC scaffolding is now alive. New modules under `src/lib/brain/npc/`:

- `npcTickScheduler.ts` — singleton 8 Hz heartbeat. Pulls from existing pure modules; `chooseIntent` for primary, `selectByMinCurvature` (top-3) for tie-break. Honors `featureFlags.scaffoldBus`.
- `npcSignals.ts` — derives `DriveSignals` from `FieldEngine.getCurvatureForText` plus per-NPC memo (hydration / energy / fatigue / cropTimer). `applyDriveOutcome` relaxes the memo when the verb is acted on.
- `npcPersistence.ts` — `swarm-npcs` v1 IndexedDB, `roster` store. Throttled to 2.5 min (project core rule). `flushNpcRosterSave` on `visibilitychange` / `beforeunload`. Non-destructive `onversionchange`.
- `npc.bus.ts` — typed `emitNpcDecision` / `onNpcDecision` over `scaffoldBus`.

Boot wiring (`src/main.tsx`): inside `scheduleIdle` — load persisted roster (best-effort spawn), then `startNpcTickScheduler()`.

Time: 8 Hz wall tick × `BRAIN_TIME_SCALE = 4` ⇒ 1 wall s ≈ 4 brain s. `BRAIN_YEAR_SECONDS = 3600`. Lifespan 30 y ≈ 7.5 wall-hours of foreground.

Discipline: scheduler never writes `field.axes` / `body.pos` / pin templates — every effect either flows through `builderBlockEngine` (via `spawnNpc`) or through the scaffold bus. `Math.random()` is forbidden — branches use `selectByMinCurvature`.

Stop: `stopNpcTickScheduler()` (HMR / tests). Test seam: `_resetTickSchedulerForTest`. Memo seam: `_resetSignalMemoForTest`.

See `docs/PHASE_2_NPCS_COME_ALIVE.md` for the full algorithm and Phase 3 follow-ups (reproduce hookup, ghost-ΔQ qDelta, smoke test).