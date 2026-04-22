

## Universe Improvement Plan — From Audit to Geodesics

`To Infinity and beyond! · q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`

This plan converts the five geodesics from the self-audit into a **sequenced, low-risk improvement program** for the entire application. Each phase is independently shippable, leaves the field in a stable state, and respects Ember 0.4 ("Does this honor life?" — i.e., no user data loss, no regressions to P2P stability).

---

### Phase 1 — Bridge Persistence (Shell 3 cognition, highest user-visible win)

**Why first:** The physics-driven reply loop now works, but `bridgeSite` is recomputed from zero on every page reload. Conversations lose their basin. This is the cheapest intervention with the largest perceived improvement in Infinity's continuity.

**What:**
- Persist the last N (default 32) conversation turns + their `bridgeSite` / `Δq` metadata to IndexedDB under a new `brain_conversation_basin` store.
- On Brain mount, rehydrate the ring so `selectBridgingToken` opens with a warm context, not a cold one.
- Add a "forget conversation" control in `BrainChatPanel` so users retain agency.

**Files:** `src/lib/uqrc/conversationAttraction.ts`, `src/lib/store.ts` (new store), `src/components/brain/BrainUniverseScene.tsx`, `src/components/brain/BrainChatPanel.tsx`.

**Risk:** Low. Additive store, gated behind feature flag for one release.

---

### Phase 2 — Cold-Field Fallback for `selectBridgingToken`

**Why:** When the field has not warmed up (fresh install, first turn ever), the selector returns `null` and we fall back to `candidates[0]` — i.e., back to weight-guessing for the first ~30 seconds of every session. Users disproportionately judge the entity by its first reply.

**What:**
- Replace the `null` return path with a **nearest-site** picker: among candidates, choose the one whose hashed lattice site is closest to `bridgeSite` (pure geometry, no field needed).
- Keep the warm-field Δq-minimisation path unchanged.
- Add a unit test: cold field + 5 candidates → picked token's site distance to `bridgeSite` is `≤ min(distances)`.

**Files:** `src/lib/uqrc/conversationAttraction.ts`, `src/lib/uqrc/__tests__/conversationAttraction.test.ts`.

**Risk:** Trivial. Pure function change, fully tested.

---

### Phase 3 — Tri-Axial Health Projection (Shell 3 substrate clarity)

**Why:** `appHealth` events currently land on a single curvature axis, which makes the badge informative but the diagnostics drawer noisy. Splitting into **token / context / reward** axes lets `NodeDashboard` and the Brain badge tell three different stories from the same field.

**What:**
- Extend `src/lib/uqrc/healthBridge.ts` to emit `{ axis: 'token' | 'context' | 'reward', delta }` instead of a scalar.
- Update `src/lib/uqrc/appHealth.ts` aggregator to maintain three rolling averages.
- Surface the three axes in `P2PDebugPanel` and as a sparkline triple in `BrainChatPanel`'s badge.
- Tests: extend `appHealth.test.ts` with axis-routing cases.

**Files:** `src/lib/uqrc/healthBridge.ts`, `src/lib/uqrc/appHealth.ts`, `src/components/p2p/P2PDebugPanel.tsx`, `src/components/brain/BrainChatPanel.tsx`, `src/lib/uqrc/__tests__/appHealth.test.ts`.

**Risk:** Medium-low. Event shape change is internal; UI gets richer, no API contract leaves the app.

---

### Phase 4 — UserCell Engine Interface (Shell 1 hygiene, deprecation safety)

**Why:** `src/lib/p2p/builderMode.standalone-archived.ts` is archived in name only — `userCell.ts` still depends on its concrete exports. Wrapping it in a thin `UserCellEngine` interface lets us swap or shrink it later without touching every caller. Honors the **Stability Priority** Core rule.

**What:**
- Define `UserCellEngine` interface in `src/lib/p2p/userCell.ts` covering: `start`, `stop`, `getPeers`, `onPeerEvent`, `getMetrics`.
- Implement `LegacyBuilderUserCellEngine` adapter that delegates to the archived module.
- Switch all User Cell callers to the interface.
- No behavior change, no archived file edits.

**Files:** `src/lib/p2p/userCell.ts`, `src/components/p2p/dashboard/UserCellsPanel.tsx`, `src/components/p2p/dashboard/UserCellControls.tsx`.

**Risk:** Low. Pure indirection; tests already cover behavior.

---

### Phase 5 — `manager.ts` Refactor (Shell 1, gravitational mass relief)

**Why last:** Largest file in the stack (~3.2k lines), highest blast radius. Worth doing, but only after Phases 1–4 reduce risk elsewhere so a regression here is isolated.

**What:**
- Split into three siblings under `src/lib/p2p/manager/`:
  - `orchestrator.ts` — bootstrap, lifecycle, mode switching.
  - `lifecycle.ts` — connect/disconnect, reconnect, backoff.
  - `messageRouting.ts` — payload dispatch, channel routing.
- Re-export the original `manager.ts` API verbatim so no caller changes.
- Add a `manager.routing.test.ts` covering the dispatch table.
- Strict: no behavioral changes in this PR. Only file moves + barrel re-export.

**Files:** new `src/lib/p2p/manager/` folder, updated `src/lib/p2p/manager.ts` as barrel.

**Risk:** Medium. Mitigated by zero-behavior-change rule and existing P2P E2E tests.

---

### Cross-cutting commitments

- **Each phase ships behind no feature flag except Phase 1** (which gets one for one release, then removed).
- **No edits to archived files.** Phase 4 is the deprecation-safety net.
- **Memory Garden stanza** appended to `MemoryGarden.md` after each phase, per the project-knowledge contract.
- **Performance budget:** no new always-on intervals, no new IndexedDB writes outside throttled (2.5m) windows except Phase 1's basin save (debounced at 5s after last turn).
- **Security posture:** unchanged. No new secrets, no new transports, no relaxation of signature enforcement.

---

### Sequencing rationale

```text
Phase 1 (basin) ──► visible UX win, isolated
   │
   ▼
Phase 2 (cold-field) ──► first-impression fix, trivial
   │
   ▼
Phase 3 (tri-axial) ──► diagnostic clarity for everything that follows
   │
   ▼
Phase 4 (UserCell iface) ──► deprecation safety before touching manager
   │
   ▼
Phase 5 (manager split) ──► structural relief, lowest user-visible risk
```

### Out of scope (explicitly deferred)

- Field engine tick rate, lattice size, BrainPhysics orb perturbation.
- EntityVoice fallback path.
- Voice synthesis, badge formatting beyond the tri-axial sparkline.
- Any change to encryption pipeline, blockchain, or storage providers.
- Any new external dependencies.

### Approval model

Each phase will be re-presented as its own atomic plan when you're ready to execute it. This document is the **map**, not the journey. Approving this plan does **not** auto-approve the per-phase plans — it only locks the sequence and scope.

