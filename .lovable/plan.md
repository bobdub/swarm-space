# Universe Improvement Plan — From Audit to Geodesics

`q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`

Sequenced, low-risk improvement program derived from the Infinity self-audit.
Each phase is independently shippable and requires its own atomic approval
before implementation. This document locks **sequence and scope only**.

---

## Phase 1 — Bridge Persistence
**Shell 3 cognition · highest user-visible win · Risk: Low**

- Persist last 32 conversation turns + `bridgeSite` / `Δq` metadata to IndexedDB
  under a new `brain_conversation_basin` store.
- Rehydrate on Brain mount so `selectBridgingToken` opens warm.
- Add "forget conversation" control in `BrainChatPanel`.
- Feature-flag for one release, then remove.

**Files:** `src/lib/uqrc/conversationAttraction.ts`, `src/lib/store.ts`,
`src/components/brain/BrainUniverseScene.tsx`, `src/components/brain/BrainChatPanel.tsx`.

---

## Phase 2 — Cold-Field Fallback for `selectBridgingToken`
**Shell 3 cognition · first-impression fix · Risk: Trivial**

- Replace `null` return path with nearest-site picker (pure geometry).
- Keep warm-field Δq-minimisation path unchanged.
- Unit test: cold field + 5 candidates → picked site distance ≤ min.

**Files:** `src/lib/uqrc/conversationAttraction.ts`,
`src/lib/uqrc/__tests__/conversationAttraction.test.ts`.

---

## Phase 3 — Tri-Axial Health Projection
**Shell 3 substrate clarity · Risk: Medium-low**

- Extend `healthBridge.ts` to emit `{ axis: 'token' | 'context' | 'reward', delta }`.
- Three rolling averages in `appHealth.ts`.
- Surface in `P2PDebugPanel` and as sparkline triple in `BrainChatPanel` badge.

**Files:** `src/lib/uqrc/healthBridge.ts`, `src/lib/uqrc/appHealth.ts`,
`src/components/p2p/P2PDebugPanel.tsx`, `src/components/brain/BrainChatPanel.tsx`,
`src/lib/uqrc/__tests__/appHealth.test.ts`.

---

## Phase 4 — UserCell Engine Interface
**Shell 1 hygiene · deprecation safety · Risk: Low**

- Define `UserCellEngine` interface (start, stop, getPeers, onPeerEvent, getMetrics).
- `LegacyBuilderUserCellEngine` adapter delegates to archived module.
- Switch all User Cell callers to the interface. No archived file edits.

**Files:** `src/lib/p2p/userCell.ts`,
`src/components/p2p/dashboard/UserCellsPanel.tsx`,
`src/components/p2p/dashboard/UserCellControls.tsx`.

---

## Phase 5 — `manager.ts` Refactor
**Shell 1 gravitational mass relief · Risk: Medium**

- Split into `src/lib/p2p/manager/{orchestrator,lifecycle,messageRouting}.ts`.
- Original `manager.ts` becomes barrel re-export — zero API change.
- Add `manager.routing.test.ts` covering dispatch table.
- Strict: file moves only, no behavior change.

**Files:** new `src/lib/p2p/manager/` folder, updated `src/lib/p2p/manager.ts`.

---

## Cross-cutting commitments

- Phase 1 is the only feature-flagged phase (one release, then removed).
- No edits to archived files; Phase 4 is the deprecation-safety net.
- Memory Garden stanza appended to `MemoryGarden.md` after each phase.
- Performance budget: no new always-on intervals; basin save debounced 5s.
- Security posture unchanged: no new secrets, transports, or signature relaxation.

## Sequencing

```
Phase 1 (basin) → Phase 2 (cold-field) → Phase 3 (tri-axial)
  → Phase 4 (UserCell iface) → Phase 5 (manager split)
```

## Out of scope

Field tick rate, lattice size, BrainPhysics perturbation, EntityVoice fallback,
voice synthesis, badge formatting (beyond Phase 3 sparkline), encryption pipeline,
blockchain, storage providers, new external dependencies.

## Approval model

Each phase will be re-presented as its own atomic plan. This document is the
**map**, not the journey.
