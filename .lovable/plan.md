

## Plan: Fix SWARM Mesh Cross-Browser Content Sync and Enable Commenting

### Problem Summary

Two users online (nodes `060b87c837ef0ee4` and `685cb8ea430d21a3`) cannot see each other's posts in SWARM Mesh mode. The root cause is a **peer discovery deadlock**: each user's PeerJS ID is generated fresh each session (`peer-{nodeId[0:12]}-{timestamp}-{random}`), so when `connectToPeer` is called with a 16-char Node ID, `resolveConnectTarget` searches local inventories for a matching `peer-XXXX` prefix but finds nothing because neither user has discovered the other yet. The connection silently fails with "Node ID has no active PeerJS alias yet."

The `discoverPeersFromPeerServerInventory` method (which calls `peerjs.listAllPeers()` on the signaling server) would find these peers, but it only runs on the initial discovery pass and then every 30 seconds — and its results aren't used to resolve the deferred Node ID connections.

### Root Causes

1. **Node ID → Peer ID resolution fails on first connect**: `resolveConnectTarget` returns `null` for bootstrap Node IDs because no inventory has been fetched yet at that point.
2. **No retry after inventory fetch**: After `discoverPeersFromPeerServerInventory` populates `latestPeerInventory`, the system never re-attempts the deferred Node ID connections.
3. **PeerJS signaling timeout**: The `Lost connection to server` error suggests the PeerJS cloud server (`0.peerjs.com`) has intermittent availability, and there's no fallback signaling endpoint configured.

### Planned Changes

#### 1. Fix Node ID resolution with inventory pre-fetch (src/lib/p2p/manager.ts)

In the `start()` method, call `discoverPeersFromPeerServerInventory('initial')` **before** `connectToBootstrapPeers()` and `autoConnectKnownPeers()`, so the inventory is populated before any Node ID resolution is attempted.

#### 2. Add deferred connection retry after inventory discovery (src/lib/p2p/manager.ts)

- Track unresolved Node IDs in a `deferredNodeConnections` set when `resolveConnectTarget` returns `null` for a Node ID.
- After each successful `discoverPeersFromPeerServerInventory` call, iterate over `deferredNodeConnections` and re-attempt `connectToPeer` for each. Remove successfully resolved entries.

#### 3. Allow direct Node ID connection as PeerJS fallback (src/lib/p2p/manager.ts)

When `resolveConnectTarget` fails for a Node ID and no inventory match is found, attempt connection using a **generated candidate PeerJS ID** by querying `peerjs.listAllPeers()` inline and filtering for the Node ID prefix. This is a synchronous fallback that prevents silent connection drops.

#### 4. Add secondary PeerJS signaling endpoint (src/lib/p2p/peerjs-adapter.ts)

Add a second default signaling endpoint to `createDefaultPeerJSSignalingConfig()` to reduce `Lost connection to server` errors. The adapter already supports endpoint rotation — this just adds a fallback.

#### 5. Ensure auto-connect runs immediately on SWARM Mesh enable (src/hooks/useP2P.ts)

In the SWARM Mesh branch of `enableP2P`, after `p2pManager.start()`, explicitly call `discoverPeersFromPeerServerInventory` and then attempt connections to known nodes **after** inventory is populated, rather than the current approach of connecting with unresolved Node IDs.

### Technical Details

```text
Current flow (broken):
  enableP2P() → p2pManager.start()
    → start() calls autoConnectKnownPeers('startup')
      → connectToPeer('685cb8ea430d21a3')  // Node ID
        → resolveConnectTarget('685cb8ea430d21a3')
          → resolvePeerIdsForNode() → searches empty inventory → returns []
        → returns null → "Deferred connect" log → connection silently dropped

Fixed flow:
  enableP2P() → p2pManager.start()
    → start() calls discoverPeersFromPeerServerInventory('initial') FIRST
      → peerjs.listAllPeers() → populates latestPeerInventory
        → e.g. ['peer-685cb8ea430d-abc-xyz', 'peer-060b87c837ef-def-uvw']
    → THEN autoConnectKnownPeers('startup')
      → connectToPeer('685cb8ea430d21a3')
        → resolveConnectTarget('685cb8ea430d21a3')
          → resolvePeerIdsForNode() → finds 'peer-685cb8ea430d-abc-xyz' in inventory
        → connects successfully via PeerJS WebRTC
    → Post sync triggers → posts visible across users
```

### Files to Modify

- **src/lib/p2p/manager.ts** — Reorder startup sequence; add deferred connection tracking and retry; add inline inventory lookup fallback in `resolveConnectTarget`
- **src/lib/p2p/peerjs-adapter.ts** — Add secondary signaling endpoint
- **src/hooks/useP2P.ts** — Reorder SWARM Mesh auto-connect to run after manager's initial discovery completes

### Expected Outcome

After these changes, two users in SWARM Mesh mode will automatically discover each other via the PeerJS signaling server inventory, resolve Node IDs to active Peer IDs, establish WebRTC data channels, and sync posts/comments bidirectionally without requiring Builder Mode or manual peer ID exchange.

