

## Deep Dive Corrections: Connection Stability & Avatar Sync

Two distinct root causes identified through code analysis.

---

### Issue 1: Connection Drops After a Few Moments

**Root cause**: The heartbeat loop runs every 8 seconds and evicts peers that haven't sent data in 30 seconds (`PEER_STALE_THRESHOLD`). This is only ~3 missed heartbeats. On mobile networks, behind NATs, or during brief network hiccups, this threshold is too aggressive and causes premature disconnections.

Additionally, when the PeerJS signaling WebSocket fires a `disconnected` event (which happens independently of WebRTC data channels), `handleLost()` tears down ALL active data connections and clears all peer data — even though WebRTC data channels can survive signaling loss. This causes a full reconnect cycle (15s+ delay) when only the signaling socket had a momentary issue.

**Fixes in `src/lib/p2p/swarmMesh.standalone.ts`:**

1. **Increase stale thresholds**: Change `PEER_STALE_THRESHOLD` from 30s to 60s, and `PEER_STALE_THRESHOLD_MINING` from 60s to 120s. This gives peers ~7 missed heartbeats before eviction.

2. **Preserve data channels on signaling loss**: In `setupPeerHandlers`, the `disconnected` handler currently calls `handleLost()` if `peer.reconnect()` fails. Change this to attempt reconnect up to 3 times with 5s intervals before calling `handleLost()`. During this time, keep existing WebRTC data connections alive — they don't need signaling to function once established.

3. **Soft reconnect in handleLost**: Instead of clearing all connections immediately, check which data channels are still open (via `conn.open` property) and preserve them. Only remove truly dead connections.

4. **Reset reconnectAttempt on partial recovery**: If the PeerJS reconnect succeeds, reset the reconnect counter so the system doesn't cascade into a `failed` state prematurely.

---

### Issue 2: Avatars Stopped Saving and Syncing

**Root cause**: The `ensureManifest` function in `useP2P.ts` (line 1421) requires `p2pManager` to exist. In SWARM Mesh mode, the hook returns early at line 687 without creating a `P2PManager`, so `p2pManager` is always null. This means `ensureManifest()` always returns null, silently breaking avatar loading for any peer whose avatar manifest isn't already in the local IndexedDB.

The avatar data itself saves correctly to the user object and localStorage. The profile-exchange protocol correctly sends `avatarRef` to peers. But when the receiving peer's Avatar component calls `ensureManifest(avatarRef)`, it gets null back because the SWARM mesh's own `ensureManifestAndChunks` method is never invoked.

**Fixes:**

**A. `src/hooks/useP2P.ts` — Route ensureManifest through swarm mesh:**

Update the `ensureManifest` callback to check the active mode. In SWARM mode, call `getSwarmMeshStandalone().ensureManifestAndChunks()` instead of `p2pManager.ensureManifest()`. Similarly for Builder mode, route through `getStandaloneBuilderMode()`.

```
const ensureManifest = useCallback(async (manifestId, options) => {
  const connState = loadConnectionState();
  if (connState.mode === 'swarm') {
    const sm = getSwarmMeshStandalone();
    // Call the standalone's ensure method and return the manifest from DB
    await sm.ensureManifestAndChunks(manifestId);
    return await get('manifests', manifestId);
  }
  if (connState.mode === 'builder') {
    // similar for builder mode
  }
  if (!p2pManager) return null;
  return p2pManager.ensureManifest(manifestId, options);
}, []);
```

**B. `src/lib/p2p/swarmMesh.standalone.ts` — Make ensureManifestAndChunks public:**

Change `private async ensureManifestAndChunks(...)` to `public async ensureManifestAndChunks(...)` so the hook can invoke it.

**C. `src/components/ProfileEditor.tsx` — Broadcast profile update to mesh:**

After saving the profile, dispatch a window event (e.g., `profile-updated`) so the swarm mesh can re-send the profile-exchange to all connected peers with the new `avatarRef`. This ensures avatar changes propagate immediately rather than waiting for the next connection cycle.

**D. `src/lib/p2p/swarmMesh.standalone.ts` — Listen for profile updates:**

In the constructor or `start()`, add a `window.addEventListener('profile-updated', ...)` that calls `sendProfileExchange` to all current connections, ensuring avatar ref changes propagate in real-time.

---

### Files Modified

| File | Change |
|---|---|
| `src/lib/p2p/swarmMesh.standalone.ts` | Increase stale thresholds, soft reconnect on signaling loss, make `ensureManifestAndChunks` public, listen for profile-updated events |
| `src/hooks/useP2P.ts` | Route `ensureManifest` through swarm/builder standalone when legacy manager is null |
| `src/components/ProfileEditor.tsx` | Dispatch `profile-updated` event after save |

