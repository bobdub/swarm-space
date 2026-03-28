

## Fix: Connection Reliability — Unified Phone Book, Smart Dialing, and Neural Health Wiring

### Problems Identified

1. **Duplicate contact systems**: `knownPeers.ts` (KnownPeers/phone book) and the swarm mesh `library` (connection library) store overlapping peer lists with different formats and storage keys, causing confusion and wasted dials.

2. **No online-awareness in library exchange**: Library exchange shares `{ peerId, nodeId, alias }` but NOT `lastSeenAt`. Receiving nodes import peers with `lastSeenAt: 0` and then dial everyone blindly — including peers offline for days.

3. **Dev bootstrap peers over-prioritized**: Cascade connect always tries dev peers first (Phase 1), waits 8s, then Phase 1b retries cooled-down devs, waits another 8s — burning 16s before trying library peers. If devs are offline, the user waits a long time for nothing.

4. **Handshake failures not tracked**: When a peer says "online" in the library but fails the PeerJS handshake, there's no failure counter or trust penalty — the reconnect loop keeps dialing them every 30s.

5. **Neural engine not monitoring connection health**: The instinct hierarchy has a `connectionIntegrity` layer but the swarm mesh never feeds connection metrics into it.

---

### Plan

#### 1. Merge KnownPeers into Swarm Library (eliminate dual system)

**`src/lib/p2p/knownPeers.ts`** — Deprecate as a wrapper that reads/writes to the swarm library storage key (`swarm-mesh-connection-library`) instead of its own `p2p:knownPeers` key. On first load, migrate any unique entries from the old key into the library format, then delete the old key.

**`src/lib/p2p/swarmMesh.standalone.ts`** — No changes needed since library is already the primary store. The constructor already seeds `DEV_BOOTSTRAP_PEERS` into the library.

#### 2. Share `lastSeenAt` in library exchange; only import recently-active peers

**`src/lib/p2p/swarmMesh.standalone.ts`** — In `sendLibraryExchange()`, include `lastSeenAt` in each shared peer entry. In `handleLibraryExchange()`, only import peers whose `lastSeenAt` is within the last 3 days (259,200,000 ms). Skip peers with `lastSeenAt: 0` or older than 3 days — they're likely offline and not worth dialing.

#### 3. Give dev peers a trust boost, not a cascade priority

**`src/lib/p2p/swarmMesh.standalone.ts`** — Change cascade connect to dial ALL candidates (dev + library) simultaneously, sorted by a priority score:
- Dev peers get a +0.8 trust boost when currently connected (online)
- Recently-seen peers (< 1 hour) get higher priority  
- Peers with failed handshakes get deprioritized
- Remove the sequential Phase 1 → wait 8s → Phase 2 pattern; instead dial top-N candidates at once and wait once

#### 4. Track handshake failures per peer; skip repeat offenders

**`src/lib/p2p/swarmMesh.standalone.ts`** — Add a `handshakeFailures` map (peerId → count). On `conn.on('error')` or connection timeout, increment the failure count. On `conn.on('open')`, reset to 0. In the reconnect loop, skip peers with 3+ consecutive failures for 15 minutes (separate from the 5-min `peer-unavailable` cooldown). This prevents hammering peers that are "online" on signaling but reject WebRTC handshakes.

#### 5. After importing a peer's phone book, dial online users first

**`src/lib/p2p/swarmMesh.standalone.ts`** — In `handleLibraryExchange()`, after importing new peers, sort them by `lastSeenAt` descending before dialing. Only dial peers seen within the last 3 days. Skip peers already in cooldown or with high failure counts.

#### 6. Wire neural engine to monitor connection health as "cells"

**`src/lib/p2p/swarmMesh.standalone.ts`** — After connection open/close/error events, feed the shared neural engine:
- On `conn.on('open')`: call `engine.onInteraction(peerId, { kind: 'connection', success: true })`
- On `conn.on('error')` / `conn.on('close')`: call `engine.onInteraction(peerId, { kind: 'connection', success: false })`
- In the heartbeat loop, compute a `connectionIntegrity` signal: `health = connectedPeers / max(librarySize, 1)` clamped to 0–1, and feed it into the instinct hierarchy layer 3

**`src/lib/p2p/instinctHierarchy.ts`** — Add a `connectionHealth` input to `LayerSignals['connectionIntegrity']` that accepts a 0–1 ratio. When health drops below 0.3, the layer reports unstable, suppressing upper layers (exploration, creativity, meaning).

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/p2p/knownPeers.ts` | Migrate to wrapper around swarm library; one-time data migration |
| `src/lib/p2p/swarmMesh.standalone.ts` | Unified dialing priority; share lastSeenAt in exchange; 3-day import filter; handshake failure tracking; neural engine connection health feed; remove sequential cascade phases |
| `src/lib/p2p/instinctHierarchy.ts` | Accept connectionHealth ratio for layer 3 signals |

