

## Offline Bootstrap Fallback — Plan

### Problem
When all DEV bootstrap nodes are offline, SWARM Mesh silently fails to connect. The user has no way to join the network without switching to Builder Mode manually and knowing a Peer ID.

### Solution
Create a **standalone fallback script** (`src/lib/p2p/bootstrapFallback.ts`) that:

1. **Monitors bootstrap results** — After the mesh attempts to connect to all DEV nodes, waits ~15 seconds, then checks if any peers connected.
2. **If zero peers connected**, emits a fallback event that the UI catches.
3. **UI prompt** — A toast/banner appears: *"No verified nodes are online. Enter a Node or Peer ID to connect."* with an input field and connect button.
4. **Accepts both ID formats** — Uses the existing `idResolver.ts` to detect whether the input is a Node ID (hex) or Peer ID (`peer-xxx`).
5. **Auto-switches network mode** — If a Peer ID is entered (Builder format) while in SWARM mode, or a Node ID (SWARM format) while in Builder mode, the system uses `networkModeSwitcher.ts` to switch modes automatically before connecting.
6. **Connects** — Passes the resolved ID to the active mesh/builder connection method. SWARM Mesh will eventually catch the new node via PEX once online.

### Files to Create/Edit

**New file: `src/lib/p2p/bootstrapFallback.ts`** (standalone script)
- `BootstrapFallbackMonitor` class
- Takes a check function (`() => number` returning connected peer count) and a timeout (default 15s)
- Emits a custom event (`swarm-bootstrap-failed`) on `window` when no peers found
- Exposes `handleManualConnect(rawId: string)` that:
  - Calls `resolveNetworkId()` from idResolver
  - Detects mode mismatch (node ID in builder mode or peer ID in swarm mode)
  - Calls `switchNetworkMode()` if needed
  - Connects via the appropriate method
- Zero imports from mesh standalone scripts — uses callbacks for connect/mode-check

**Edit: `src/components/P2PStatusIndicator.tsx`**
- Listen for `swarm-bootstrap-failed` event
- Show an inline alert + input field in the WiFi popover when triggered
- Input accepts both Node IDs and Peer IDs, validated via `isValidNetworkId()`
- On submit, calls the fallback monitor's `handleManualConnect()`
- Alert dismisses once a peer connects

**Edit: `src/lib/p2p/swarmMesh.standalone.ts`**
- After `bootstrapFromDevList()` + `restoreKnownConnections()` in `start()`, set a 15s timeout that checks `connectedPeers` count and dispatches `swarm-bootstrap-failed` if zero
- Minimal addition (~5 lines), no structural changes

### Flow Diagram
```text
Mesh starts
  ├── ping DEV bootstrap nodes
  ├── restore known connections
  └── 15s timer
        └── connectedPeers === 0?
              ├── YES → dispatch "swarm-bootstrap-failed"
              │          └── UI shows: "No verified nodes online.
              │              Enter a Node or Peer ID."
              │                 └── User enters ID
              │                       ├── idResolver detects format
              │                       ├── auto-switch mode if needed
              │                       └── connect to peer
              └── NO → all good, dismiss
```

### What This Does NOT Touch
- PeerJS adapter / content serving layer
- Builder Mode standalone script
- Existing manual connect in WiFi popover (still works independently)

