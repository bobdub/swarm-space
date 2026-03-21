# Builder Mode Replacement Plan

> **Status**: Planning  
> **Date**: 2026-03-21  
> **Foundation**: `src/lib/p2p/testMode.standalone.ts`

## Goal

Replace the current `BuilderModePanel` (which routes through `P2PContext` and lacks persistent identity/library) with a new standalone script built from the proven `testMode.standalone.ts` pattern. This gives Builder Mode users the same reliability as Swarm Mesh while preserving their granular controls.

## Current Builder Mode Controls to Preserve

| Control | Description | Migration Notes |
|---|---|---|
| Build a Mesh | Manual-only connections | Map to `autoConnect: false` flag |
| Blockchain Sync | Toggle chain sync | Add as flag in standalone |
| Auto-Connect | Join main mesh | Map to library auto-dial toggle |
| Approve Only | Manual approval queue | New: incoming connection queue with accept/reject |
| Manual Mining | Toggle mining with stats | Preserve as-is, wire to standalone events |
| Manual Peer Input | Connect by ID | Already exists in testMode pattern |
| Block Node | Block a peer | Already exists in testMode pattern |
| Go Offline | Disconnect all | Already exists in testMode pattern |

## New Capabilities from testMode Foundation

| Feature | Description |
|---|---|
| Persistent Identity | `peer-{nodeId}` never rotates |
| Connection Library | Saved peers auto-dialed on reconnect |
| Blocked Peers List | Persistent, incoming connections rejected |
| Content Pipeline | Inventory → request → push → IndexedDB |
| Heartbeat Health | 8s keep-alive, 30s stale detection |
| Flag Persistence | `enabled` flag survives refresh |
| Auto-Reconnect Loop | 30s background re-dial of library peers |

## Implementation Steps

### Step 1: Create `builderMode.standalone.ts` (new file)
- Clone testMode pattern (never-rotate identity, PeerJS setup, content pipeline)
- Add Builder-specific flags: `{ enabled, blockchainSync, autoConnect, approveOnly, mining }`
- Storage keys: `builder-mode-node-id`, `builder-mode-flags`, `builder-mode-connection-library`, `builder-mode-blocked-peers`

### Step 2: Add Approval Queue
- When `approveOnly: true`, incoming connections are held in a queue
- UI shows pending peers with Accept / Reject buttons
- Accepted peers are added to library; rejected are optionally blocked

### Step 3: Wire Mining to Standalone
- Mining loop runs inside the standalone (not the UI component)
- UI reads mining stats via event subscription
- Mining only active when `mining: true` flag AND `phase === 'online'`

### Step 4: Rebuild BuilderModePanel UI
- Remove dependency on `P2PContext` toggles
- Wire all toggles to `builderMode.standalone.ts` methods
- Add connection library display (like TestModePanel)
- Add blocked peers display
- Add approval queue (when approveOnly is on)

### Step 5: Update Dashboard Routing
- `NetworkModeToggle` Swarm → `swarmMesh.standalone`, Builder → `builderMode.standalone`
- `main.tsx` auto-starts whichever mode is flagged `enabled`
- Both modes can co-exist but only one active at a time

### Step 6: Deprecate P2PContext Controls for Builder
- Builder Mode no longer needs `setControlFlag` from P2PContext
- P2PContext remains for legacy compatibility but Builder bypasses it

## Risk Mitigation

- **Test Mode is untouched** — it remains the emergency fallback
- **Swarm Mesh is untouched** — production mode stays stable
- **Incremental rollout** — new Builder standalone can be tested behind a flag before replacing the old panel
