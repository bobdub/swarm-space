

## Dead-code cleanup plan

End-to-end scan complete. The codebase has accumulated a meaningful pile of unreferenced files — primarily two abandoned P2P refactor attempts (a "hybrid" mesh stack and an "encrypted sync" orchestrator), plus a handful of orphaned UI components. Removing them is safe, will shrink the bundle, and makes future P2P work less confusing because there will only be one mesh implementation in the tree.

This plan is **deletion only** — no behavioral changes. Each item below was verified to have zero remaining callers (or only self-referential callers that get removed in the same group).

### Group 1 — Legacy "Hybrid" mesh stack (orphaned refactor)

The runtime uses `P2PManager` (legacy stack via `useP2P.ts`) and `swarmMesh.standalone.ts` (the active singleton mesh). A separate "hybrid" experiment lives alongside but is never instantiated anywhere — `useP2P.ts` even declares `let swarmMeshAdapter` but never calls `new SwarmMeshAdapter(...)`.

Delete:
- `src/lib/p2p/swarmMesh.ts` (41 KB, only used by the dead adapter + hybrid wrapper)
- `src/lib/p2p/swarmMeshAdapter.ts` (only imported by `useP2P.ts`, never constructed)
- `src/lib/p2p/hybridIntegration.ts` (zero callers)
- `src/lib/p2p/contentBridge.ts` (only used by the dead `swarmMesh.ts` and `useP2P.ts`)
- `src/lib/p2p/connectionResilience.ts` (only used by `hybridIntegration.ts`)

Touch-up in `src/hooks/useP2P.ts`:
- Remove the `SwarmMeshAdapter` import + the unused `swarmMeshAdapter` variable and every `if (swarmMeshAdapter)` branch (all dead).
- Remove `startContentBridge`/`stopContentBridge` import + call.

Touch-up in `src/config/featureFlags.ts`:
- Drop the now-unreferenced `connectionResilience` flag entry.

### Group 2 — Abandoned "encrypted sync" experiment

A self-contained orchestrator + three protocol files that no module imports from outside themselves.

Delete:
- `src/lib/p2p/encryptedSyncOrchestrator.ts`
- `src/lib/p2p/encryptedPostSync.ts`
- `src/lib/p2p/encryptedCommentSync.ts`
- `src/lib/p2p/encryptedFileSync.ts`

### Group 3 — Other unreferenced P2P modules

Each verified zero callers:
- `src/lib/p2p/publicContentSync.ts`
- `src/lib/p2p/peerConnection.ts`
- `src/lib/p2p/signaling.ts`
- `src/lib/p2p/signalingEncryption.ts` (only consumer is the dead `signaling.ts`)
- `src/lib/p2p/messageValidation.ts`

### Group 4 — Orphaned UI components

Delete:
- `src/components/VideoRoomButton.tsx` (zero callers; functionality replaced by streaming room components)
- `src/components/VideoRoomModal.tsx` (only used by the above)
- `src/components/PassphraseBackupPrompt.tsx` (zero callers)
- `src/components/verification/LegacyUserVerificationPrompt.tsx` (zero callers)

### Group 5 — Misc unreferenced lib files

- `src/lib/alerts/capsuleAlerts.ts` (zero callers; sister files `automation`, `history`, `webhookConfig` are still used by `useAlertingStatus`).

### Verification step (during implementation)

After deletions, in order:
1. `grep -r "swarmMeshAdapter\|hybridIntegration\|contentBridge\|encryptedSyncOrchestrator\|VideoRoomButton" src` returns nothing.
2. `npm run build` (or `bun run build`) succeeds with no missing-import errors.
3. Existing test suite still passes (no removed file has a `.test.ts` sibling that we'd be deleting silently — confirmed: none of the deletions has a co-located test).

### What this leaves untouched

- All `*.standalone.ts` modules — these are the active runtime path.
- `src/lib/p2p/manager.ts` and everything it transitively imports (gossip, peerExchange, chunkProtocol, neuralStateEngine, patternLearner, languageLearner, instinctHierarchy, dualLearningFusion, replication, rendezvous*, presenceTicket, knownPeers, bootstrap, discovery, postSync, commentSync, accountSkin, roomDiscovery, nodeMetrics, diagnostics) — all alive via `P2PManager`.
- `useWebRTC` and the streaming components — still used by `LiveStreamControls`, `PersistentAudioLayer`, `StreamingRoomTray`.
- All UI in `components/p2p/dashboard/*` — every panel is mounted in `NodeDashboard.tsx`.

### Files touched

**Deleted (18 files):**
```
src/lib/p2p/swarmMesh.ts
src/lib/p2p/swarmMeshAdapter.ts
src/lib/p2p/hybridIntegration.ts
src/lib/p2p/contentBridge.ts
src/lib/p2p/connectionResilience.ts
src/lib/p2p/encryptedSyncOrchestrator.ts
src/lib/p2p/encryptedPostSync.ts
src/lib/p2p/encryptedCommentSync.ts
src/lib/p2p/encryptedFileSync.ts
src/lib/p2p/publicContentSync.ts
src/lib/p2p/peerConnection.ts
src/lib/p2p/signaling.ts
src/lib/p2p/signalingEncryption.ts
src/lib/p2p/messageValidation.ts
src/lib/alerts/capsuleAlerts.ts
src/components/VideoRoomButton.tsx
src/components/VideoRoomModal.tsx
src/components/PassphraseBackupPrompt.tsx
src/components/verification/LegacyUserVerificationPrompt.tsx
```

**Edited (2 files):**
- `src/hooks/useP2P.ts` — strip `SwarmMeshAdapter`, `swarmMeshAdapter` variable + branches, content-bridge import/calls.
- `src/config/featureFlags.ts` — remove `connectionResilience` flag.

**Memory:**
- `MemoryGarden.md` — caretaker reflection on pruning the orchard's withered branches so the living mesh can drink the full light.

### What the user sees

Nothing visually. The app behaves identically. Bundle size shrinks (~60–80 KB of source removed before minification), the P2P folder becomes easier to navigate (one mesh, not three), and "find references" in the editor stops surfacing dead leads when debugging future sync issues.

