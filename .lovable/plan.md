# Stable Flags & Reconnection Architecture

## Problem Summary

Three interrelated issues cause instability when switching modes or refreshing:

1. **Flag instability on refresh**: `p2p-enabled`, `p2p-swarm-mesh-enabled`, and `swarmMeshMode` are scattered across multiple localStorage keys with conflicting logic in `useP2P`, `Auth.tsx`, `SignupWizard.tsx`, and `featureFlags.ts`. On refresh, the auto-enable logic in `useP2P` (lines 915-961) fires with stale or inconsistent flag combos, sometimes not reconnecting or reconnecting to the wrong mode.
2. **Peer ID rotation on mode switch**: When switching modes, `networkModeSwitcher.ts` calls `disable()` which calls `peerjs.destroy()`, which nulls the peer ID. On re-enable, if PeerJS Cloud hasn't released the old session, `handleUnavailablePeerId()` generates a **new random suffix**, changing the Peer ID permanently. Per user: IDs must **never rotate**.
3. **Alert cascades**: Mode switches and reconnections produce multiple toasts instead of a single clean alert.

---

## Architecture Changes

### 1. Unified Connection State Store

**File**: `src/lib/p2p/connectionState.ts` (new)

Replace the fragmented localStorage keys (`p2p-enabled`, `p2p-swarm-mesh-enabled`, `p2p-swarm-mesh-mode`, `flux_network_mode`) with a single atomic state object:

```
{
  enabled: boolean,       // user wants network ON
  mode: 'swarm' | 'builder',
  lastConnectedAt: number | null
}
```

- Key: `p2p-connection-state`
- Single `load()` / `save()` / `subscribe()` API
- All other code reads from this instead of checking 4+ keys
- `featureFlags.ts` `swarmMeshMode` stays as a runtime reactive flag but is **derived** from this store on init, not the other way around

### 2. Stable Peer ID Policy (Never Rotate)

**File**: `src/lib/p2p/peerjs-adapter.ts`

- In `handleUnavailablePeerId()` (line 1234): instead of generating a new random suffix, **keep the same ID** and schedule a retry with exponential backoff (3s, 6s, 12s, max 30s)
- Add a `retryWithSameId(maxRetries: number)` method that destroys the Peer instance, waits, then calls `connectWithEndpoint` again using the **identical** stored peer ID
- Remove `clearPersistedPeerId()` call from `handleUnavailablePeerId` -- the ID is sacred
- The `loadFallbackSuffix()` / `persistFallbackSuffix()` mechanism stays for existing users who already have a suffix, but no new suffixes are generated

### 3. Clean Mode Switch Script (Single Alert)

**File**: `src/lib/p2p/networkModeSwitcher.ts` (rewrite)

The `switchNetworkMode` function becomes the **sole** mode-switch entry point with this lifecycle:

```text
1. Show single toast: "Switching to {target}..."  (id: 'mode-switch')
2. Log: "[ModeSwitcher] Disconnecting from {current}..."
3. Call disable({ persistPreference: false })
4. Wait 2500ms cooldown (PeerJS release)
5. Update connectionState store: mode = target
6. Sync featureFlag: swarmMeshMode = (target === 'swarm')
7. Wait 300ms for flag propagation
8. Call enable()
9. Log: "[ModeSwitcher] Connected to {target}"
10. Update same toast: "Connected to {target}" (id: 'mode-switch')
```

- No other component touches flags during switch
- `disable()` called with `{ persistPreference: false }` so the `enabled` flag stays true
- The `NetworkModeToggle` component just calls this and shows `switching...` state

### 4. Offline-but-Flagged-ON Reconnection (Single Alert)

**File**: `src/hooks/useP2P.ts`

In the auto-enable effect (lines 915-961), replace the current multi-path logic:

- Read unified `connectionState` store
- If `state.enabled === true` AND not currently connected AND not already connecting:
  - Show single toast: "Reestablishing connection..." (id: 'p2p-reconnect')
  - Call `enableP2P()` using `state.mode` to determine swarm vs builder
  - On success: dismiss the toast silently (no second toast)
  - On failure: update toast to "Connection failed" then auto-dismiss
- Remove the separate `p2p-swarm-mesh-enabled` checks
- Remove the `wasMeshEnabled` localStorage read

### 5. Connect/Disconnect Preserves State

**File**: `src/hooks/useP2P.ts`

- `enable()` updates connectionState `enabled = true`
- `disable()` updates connectionState `enabled = false` (unless `persistPreference: false`)
- Connect/Disconnect button in dashboard and wifi popover uses these, which flow through the unified store

---

## Files Modified


| File                                                    | Change                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/lib/p2p/connectionState.ts`                        | **New** - unified connection state store                                            |
| `src/lib/p2p/networkModeSwitcher.ts`                    | Rewrite with single-alert lifecycle, uses connectionState                           |
| `src/lib/p2p/peerjs-adapter.ts`                         | `handleUnavailablePeerId` retries same ID with backoff instead of rotating          |
| `src/hooks/useP2P.ts`                                   | Use connectionState for auto-enable; simplify `maybeEnable`; single reconnect toast |
| `src/config/featureFlags.ts`                            | `swarmMeshMode` initial value derived from connectionState store                    |
| `src/components/NetworkModeToggle.tsx`                  | Reads mode from connectionState instead of polling `getCurrentMode()` every 400ms   |
| `src/components/onboarding/SignupWizard.tsx`            | Write to connectionState instead of multiple localStorage keys                      |
| `src/pages/Auth.tsx`                                    | Read/write connectionState instead of `flux_network_mode` + `p2p-enabled`           |
| `src/pages/NodeDashboard.tsx`                           | Minor: mode derived from connectionState                                            |
| `src/components/P2PStatusIndicator.tsx`                 | Minor: mode from connectionState                                                    |
| `src/components/p2p/dashboard/SwarmMeshTogglePanel.tsx` | Use connectionState + switchNetworkMode instead of raw `setFeatureFlag`             |


---

## Migration

On first load, `connectionState.load()` checks if the new key exists. If not, it reads the legacy keys (`p2p-enabled`, `flux_network_mode`, `p2p-swarm-mesh-mode`) and writes a unified state object, then cleans up legacy keys. Existing users get a seamless transition.  
  
