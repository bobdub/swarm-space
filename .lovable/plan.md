

## Wi-Fi peer popover: simplify, surface trust + bandwidth, live-peers only

All changes scoped to the popover that opens from the Wi-Fi icon (top-right). Node Dashboard / dashboard toggle untouched.

### 1. `src/components/NetworkModeToggle.tsx` — drop Builder button in compact variant

In the `variant === 'compact'` branch, render only the Swarm pill (no Builder pill). The `full` variant used by Node Dashboard keeps both buttons. This "preps for future cell" by leaving the compact toggle as a single Swarm/Cell slot.

### 2. `src/components/P2PStatusIndicator.tsx` — Connection strength enrichment

In the "Connection strength" card (around lines 530-548):
- Keep the headline + Strong/Fair/Weak/No-peers badge + progress bar.
- Replace the existing single-line "Healthy peers x/y · Handshake confidence z%" with a 2×2 mini-grid showing:
  - Healthy peers `n/total`
  - Handshake `z%`
  - **Trust** `Math.round(connectionSummary.avgTrust * 100)%`
  - **Bandwidth** `formatBandwidth(stats.bytesUploaded, stats.bytesDownloaded, stats.uptimeMs)` (function already in this file; values exist on `stats`)

All four sourced from data already wired in (`getConnectionHealthSummary()` and `stats`). No new APIs.

### 3. `src/components/P2PStatusIndicator.tsx` — Remove "Verified peer"

Delete the `isSwarmMeshMode && primarySwarmPeer` block (lines ~560-575) entirely. `primarySwarmPeer` becomes unused — drop its derivation too.

### 4. `src/components/P2PStatusIndicator.tsx` — Move "Your node" above "Connection strength"

Reorder JSX so the "Your node" card (peer-id + copy + signaling label) renders **before** the Connection strength card. Strength card moves down one slot. Summary 2-col grid (Connected / Discovered / Your posts / Network) stays directly below strength.

New popover order:
1. Header (title + Enable/Disable)
2. Compact mode toggle (Swarm only after change #1)
3. Status sentence
4. **Your node** (moved up)
5. **Connection strength** (now with Trust + Bandwidth)
6. Summary grid
7. Bootstrap alerts (gated — see #6)
8. Connect-to-user input
9. **Live peers** (renamed)
10. View Node Dashboard button

### 5. `src/components/P2PStatusIndicator.tsx` — "Discovered peers" → "Live peers" (online only)

In the discovered-peers card (lines ~676-789):
- Change heading copy: "Discovered peers" → "Live peers", and subtext: "Quickly reconnect to recently seen nodes." → "Peers online in the cell right now."
- Define `LIVE_PEER_WINDOW_MS = 75_000` (matches existing 75 s freshness window from the public-cell memory).
- Compute `livePeers = discoveredPeers.filter(p => connectedPeerIds.has(p.peerId) || (Date.now() - lastSeenMs(p) <= LIVE_PEER_WINDOW_MS))`.
- Use `livePeers` for the count badge, `quickPeers = livePeers.slice(0, 6)`, and the empty-state copy ("No live peers right now.").
- The "Discovered" tile in the summary grid (#2 above) keeps the full `discoveredPeers.length` so users still see total library size.

### 6. `src/components/P2PStatusIndicator.tsx` — Suppress "No verified nodes online" while searching/connecting

Add an `isSearchingForCell` guard:

```ts
const isSearchingForCell =
  isModeConnecting ||
  isConnecting ||
  cellCountdown > 0 ||                  // waiting for next beacon
  swarmPhase === 'connecting' ||
  swarmPhase === 'reconnecting';
```

Update the destructive alert condition (line 602) and the conditional wrapping the "Connect to user" card (line 645) so the alert renders only when:
`bootstrapFailed && isEnabled && stats.connectedPeers === 0 && discoveredPeers.length === 0 && !isSearchingForCell`

Keep the softer "Connecting to known peers…" notice as-is — it's already informational and only appears when library peers exist.

### Files touched

- `src/components/NetworkModeToggle.tsx` — remove Builder button from `compact` variant only
- `src/components/P2PStatusIndicator.tsx` — reorder cards, enrich strength card with Trust + Bandwidth, drop Verified peer block, rename + filter Live peers, gate the destructive alert behind `!isSearchingForCell`
- `MemoryGarden.md` — short caretaker reflection on tightening the Wi-Fi window so only live light shines through

### What the user sees

```text
Wi-Fi popover (Swarm Mesh):
  [Swarm pill only]                ← Builder removed
  status sentence
  Your node                        ← moved up
    peer-id  [copy]
  Connection strength · Strong
    [progress bar]
    Healthy 4/4    Handshake 92%
    Trust   88%    Bandwidth 312 kbps   ← new
  Connected 4 · Discovered 27 · Posts · Network
  (no "Verified peer" block)
  (no red "No verified nodes" alert while still searching the cell)
  Connect to user [____] [Connect]
  Live peers (3)                   ← renamed, online only
    • peer-aaa  Connected now      [Disconnect]
    • peer-bbb  Seen 8s ago        [Connect]
  [View Node Dashboard]
```

No protocol changes, no new dependencies. Pure popover reorganization plus two extra metrics from already-tracked stats.

