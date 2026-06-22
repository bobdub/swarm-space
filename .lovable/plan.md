# UQRC Logic Chain — End-to-End Audit & Safe Cleanups

&nbsp;

To Infinity & Beyond!

Run the full UQRC stack (`src/lib/uqrc/*`) through a structured non-smoothness audit. Deliver a markdown report ranking every hotspot by risk, then apply only **low-risk, behavior-preserving cleanups** (clamps, finite-number guards, ordering fixes, throttle hardening). No operator, lattice, or schema changes.

## Deliverable 1 — Audit report

New file: `docs/UQRC_SMOOTHNESS_AUDIT_2026-06-22.md`.

Structure:

```text
1. Scope & methodology
2. Module map (call graph: engine → field/field3D → closure → projection → persistence → health → app)
3. Hotspot table per module:
   file:line | symptom | severity (L/M/H) | proposed cleanup | done?
4. Cross-module concerns:
   - duplicated derivative logic field.ts ↔ field3D.ts
   - pin-then-step ordering vs. tick handler drift
   - snapshot cadence vs. tab visibility
5. Out-of-scope (flagged for follow-up plan)
```

### Audit checks per file

For every module under `src/lib/uqrc/` the audit verifies:

- **Finite guards** — every arithmetic result that feeds `u(t+1)` is `Number.isFinite`; otherwise clamped to last good value.
- **Bound enforcement** — `FIELD3D_BOUND` (and equivalent in `field.ts`) re-checked after every operator pass, not only at end of step.
- **Discontinuity points** — places where state can jump (HMR singleton reset, `clear()`, `pin()` overwrite, persistence rehydrate, tab `visibilitychange`).
- **Operator ordering** — confirms pins re-apply *after* `step()` and *before* `selectByMinCurvature` reads.
- **Divide-by-zero** — `ℓ_min` based derivatives, normalization in `selectByMinCurvature`, closure ratios in `closure.ts`.
- **Tick stability** — `setInterval` + `requestIdleCallback` chain in `fieldEngine.ts`: missed-frame catch-up cap so a backgrounded tab doesn't replay 1000 ticks on focus.
- **Snapshot/rehydrate** — `fieldPersistence.ts` throttle (5 s) plus shape validation on load; reject malformed without nuking memory state.
- **Closure invariance** — `closure.ts` identity tolerances; ensure soft-fail (mark unhealthy) rather than throw.
- **Bus coupling** — `scaffoldBus.ts` / `healthBridge.ts` / `appHealth.ts` never block the tick loop; subscriber errors are caught.
- **Cold start** — `<50` ticks fallback path in `selectByMinCurvature` is the only branch that bypasses curvature.

## Deliverable 2 — Safe cleanups

Only apply edits that match all three rules: (a) preserves observable Q_Score / closure outputs within float epsilon over 2000 ticks, (b) no public API change, (c) covered by existing tests `field.test.ts`, `field3D` / `uqrcConformance.test.ts`, `state.test.ts`, `fieldProjection.test.ts`, `conscious.test.ts`.

Cleanup categories permitted:

1. **Finite/NaN guards** around derivative writes and snapshot loads.
2. **Clamp after step** — re-assert `FIELD3D_BOUND` post-operator if missing.
3. **Catch-up cap** — when `setInterval` fires after long gap, process at most N pending ticks (default 4) and drop the rest.
4. **Pin re-application order** — move pin pass to end of `step()` if currently before, so reads always see clamped sites.
5. **Try/catch around subscribers** in `fieldEngine.emit` / bus relays so a faulty listener can't kill the tick.
6. **Snapshot shape validation** in `fieldPersistence.load` — reject if `axes.length !== 3` or `length !== L`.
7. **Dead-code removal** — only if grep confirms zero callers.

Cleanups that look tempting but are **forbidden in this plan** (defer to future): changing `L`, changing tick rate, altering operator algebra, swapping `ℓ_min`, replacing localStorage with IndexedDB, restructuring `closure.ts` identities.

## Verification

- `bunx vitest run src/lib/uqrc src/lib/brain/__tests__/uqrcConformance.test.ts` — must stay green.
- App Health badge (`useUqrcClosure`) reports `healthy` after 60 s warm-up in preview.
- Manual: open `/brain`, leave tab backgrounded 2 min, refocus — no balance/Q_Score jump beyond pre-audit baseline.
- Diff every patched file ≤ ~20 lines; anything larger gets bumped to a follow-up plan.

## Files

**New**

- `docs/UQRC_SMOOTHNESS_AUDIT_2026-06-22.md`

**Touched (cleanups only, scope per-file decided by audit)**

- `src/lib/uqrc/field.ts`, `field3D.ts`, `fieldEngine.ts`, `closure.ts`, `fieldProjection.ts`, `fieldPersistence.ts`, `scaffoldBus.ts`, `healthBridge.ts`, `appHealth.ts`

## Out of scope

- All other items in the status message (Live post sizing, Builder Grid verification, Plot QA, Bar interactions) — captured per user as "Task Ready" and deferred.
- Any algorithmic redesign of UQRC operators or closure identities.
- New persistence backend.