

## Plan: Fix Gossip Triangle, Gun.js Relay, and Torrent Stall Cleanup

### Problem Summary

Three interconnected issues are preventing full mesh connectivity and content delivery:

1. **Triangle gossip failure**: When A is connected to B and C, B and C never connect to each other because library exchange only fires once (on initial connection) and doesn't re-broadcast when new peers join.
2. **Gun.js is completely non-functional**: Vite aliases `gun` to a stub returning `null`, so `GunAdapter.tryStartGun()` always fails with "GunCtor is not a function". All Gun relay paths (torrent fallback, gossip relay) are dead code.
3. **Torrents stall with no cleanup**: Dead torrents (zero seeders, zero progress) linger indefinitely in the Network Created Content panel.

### Root Causes

- **Triangle bug**: `sendLibraryExchange()` only runs on `conn.on('open')` for the new peer. When A connects to C after already being connected to B, A tells C about B — but A never re-tells B about C. B's library reconnect loop may have C with `lastSeenAt: 0` but never attempts the dial because C was added via `handleLibraryExchange` which does call `dialPeer`, yet the timing means A→B exchange happened before C existed.
- **Gun stub**: `vite.config.ts` line 33 aliases `gun` to a file that exports `null`. The `optimizeDeps.exclude` and `build.rollupOptions.external` also block it.
- **Torrent stalls**: The bloat/pause logic only triggers after 10+ peer failures. Torrents with zero seeders (nobody has the content) just stall after 60s and sit in "paused" state forever.

---

### Step 1: Fix Peer Introduction in SWARM Mesh

**File**: `src/lib/p2p/swarmMesh.standalone.ts`

When a new peer connects successfully (in `handleConnection` → `conn.on('open')`), after the library exchange completes, broadcast the newly updated library to ALL existing connections — not just the new peer. This creates the triangle:

- A connects to B → A sends library to B (empty or just bootstrap)
- A connects to C → A sends library to C (contains B) → C dials B ✅
- **New**: A also re-sends updated library (now containing C) to B → B dials C ✅

Additionally, when `handleLibraryExchange` discovers new peers from a remote library, re-broadcast our own updated library to all OTHER connections so they learn about the new peer too. This creates a ripple effect.

Add a `rebroadcastLibrary()` method that sends a library-exchange message to all connected peers except a given exclusion peer. Call it:
- After adding a new peer to the library (in `handleConnection` open handler, after `sendLibraryExchange`)
- After receiving and processing a library exchange with new peers

Also update `lastSeenAt` for library peers that we are currently connected to when doing the exchange, so the reconnect loop correctly prioritizes recently-active peers.

### Step 2: Install Gun.js and Remove Stub

**Files**: `package.json`, `vite.config.ts`

- Add `gun` as a real dependency in `package.json`
- Remove the vite alias for `gun` (line 33 in `vite.config.ts`)
- Remove `gun` from `optimizeDeps.exclude` and `build.rollupOptions.external`
- Keep the `nodePolyfills` plugin (Gun needs Buffer/process)

**File**: `src/lib/p2p/transports/gunAdapter.ts`

- Harden the `tryStartGun()` method to handle both `module.default` and direct constructor patterns
- Add retry logic if initial Gun connection fails (Gun relay servers can be flaky)

**File**: `src/lib/p2p/swarmMesh.standalone.ts`

- Gun relay attachment (`attachGunRelayToTorrent`) is already auto-enabled in SWARM mode — no change needed
- The `startTorrentSwarm()` already calls `attachGunRelayToTorrent()` automatically

**File**: `src/lib/p2p/builderMode.standalone.ts`

- Add a toggle for Gun relay (`gunRelay` toggle alongside existing toggles)
- Only attach Gun relay to TorrentSwarm when the toggle is enabled
- Default to OFF for Builder Mode (user controls it)

### Step 3: Torrent Dead-Seed Cleanup

**File**: `src/lib/p2p/torrentSwarm.standalone.ts`

Add dead-torrent detection in the rarity poll loop:

- Track `firstSeenAt` for each downloading torrent
- If a torrent has been downloading for >5 minutes AND has 0 seeders AND 0 received chunks AND 0 peers with any chunks: mark as "dead"
- Dead torrents are automatically removed from the download queue (call `remove()`)
- Emit a `torrent-dead` custom event so the UI can show a brief notification
- The owner can re-seed from the Node Dashboard's Network Created Content panel (existing re-seed button)

Add timestamp tracking:
- Store `downloadStartedAt` when entering "downloading" state
- In the rarity poll loop, check: `Date.now() - downloadStartedAt > 300_000` (5 min) + zero seeders + zero received chunks → auto-remove

**File**: `src/components/p2p/dashboard/TorrentSwarmPanel.tsx`

- Listen for `torrent-dead` events and show a brief toast/badge indicating cleaned torrents
- No other UI changes needed — the panel already auto-refreshes

---

### Technical Details

```text
Triangle Fix Flow:
  A ──connect──► B    (A sends library to B)
  A ──connect──► C    (A sends library to C, C gets B's ID, C dials B)
  A ──rebroadcast──► B  (A re-sends library with C to B, B dials C)
  Result: A↔B, A↔C, B↔C  ✅

Dead Torrent Detection:
  downloading + 5min elapsed + 0 seeders + 0 chunks = dead → auto-remove
```

### Files Modified

1. `src/lib/p2p/swarmMesh.standalone.ts` — peer introduction rebroadcast
2. `package.json` — add `gun` dependency
3. `vite.config.ts` — remove gun stub alias and exclusions
4. `src/lib/p2p/transports/gunAdapter.ts` — harden initialization
5. `src/lib/p2p/builderMode.standalone.ts` — add gunRelay toggle
6. `src/lib/p2p/torrentSwarm.standalone.ts` — dead-torrent auto-cleanup

