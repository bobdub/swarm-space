

# Plan: Delete & Re-seed Torrents + Gun.js Content Delivery Bridge

## What You Asked For

1. **Delete & re-seed**: Like torrent clients, let users delete incoming/incomplete files and re-seed existing files with fresh chunks
2. **Gun.js content delivery**: Use the existing GunAdapter as a secondary transport for torrent chunk delivery

---

## Part 1: Delete & Re-seed Controls

### Current State
- Files have Pause, Ignore, and Host First buttons
- `deleteManifest()` exists in `fileEncryption.ts` (deletes from IndexedDB) but is not exposed in the Content Distribution panel
- TorrentSwarm tracks in-memory state but has no `remove()` or `reseed()` methods

### Changes

**A. `torrentSwarm.standalone.ts` — Add `remove()` and `reseed()` methods**

- `remove(manifestId)`: Stops the download timer, clears in-memory chunks/peer maps/state, and calls `deleteManifest()` to purge IndexedDB. Broadcasts a `not-interested` message to peers.
- `reseed(manifestId)`: Reads the completed file from IndexedDB chunks, re-splits with current adaptive chunk sizing, creates a new manifest, deletes the old one, and announces the new manifest. This lets users benefit from updated 1MB chunk sizes on legacy files.

**B. `swarmMesh.standalone.ts` — Expose delete/reseed to dashboard**

- Add `deleteFile(fileId)` and `reseedFile(fileId)` methods that delegate to TorrentSwarm and clean up file prefs.

**C. `TorrentSwarmPanel.tsx` — Add Delete and Re-seed buttons per file**

- **Delete** (Trash icon): Appears on all files. Confirms, then removes manifest + chunks from IndexedDB and torrent state. File disappears from the list.
- **Re-seed** (RefreshCw icon): Appears only on completed/seeding files. Re-chunks the file with current adaptive sizing and re-announces to the mesh.

---

## Part 2: Gun.js as Secondary Torrent Transport

### Current State
- `GunAdapter` exists and can send/receive messages on arbitrary channels via a GUN graph
- TorrentSwarm uses a `MeshTransportAdapter` interface with `send`, `broadcast`, `onMessage`, `getConnectedPeerIds`
- The GunAdapter is already initialized in the P2P manager but not wired to TorrentSwarm

### Approach: Gun Relay Bridge in TorrentSwarm

Rather than replacing the transport adapter, we add an **optional secondary relay** inside TorrentSwarm that forwards manifest announcements and chunk requests/responses through Gun.js. This helps when direct PeerJS connections are flaky but both peers can see the same Gun relay.

**A. `torrentSwarm.standalone.ts` — Add optional Gun relay**

- New `attachGunRelay(gunAdapter)` method on TorrentSwarm
- When attached, `announce` messages are also published to the Gun graph
- `interested`, `have`, `request`, and `piece` messages are relayed through Gun when the primary mesh send fails (fallback pattern)
- Gun message listener feeds into the same `handleMessage` pipeline with deduplication via message IDs

**B. `swarmMesh.standalone.ts` — Wire Gun relay on startup**

- After TorrentSwarm starts, dynamically import GunAdapter, initialize with the Manhattan relay peers, and call `torrentSwarmInstance.attachGunRelay(gunAdapter)`
- This makes chunk discovery and delivery work even when peers can't establish direct WebRTC connections

**C. Deduplication**

- Each torrent message gets a `msgId` field (already partially exists as message IDs in GunAdapter)
- TorrentSwarm maintains a `seenMsgIds` Set (capped at 500) to prevent processing the same chunk request/piece twice from both transports

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/p2p/torrentSwarm.standalone.ts` | Add `remove()`, `reseed()`, `attachGunRelay()`, message dedup |
| `src/lib/p2p/swarmMesh.standalone.ts` | Add `deleteFile()`, `reseedFile()`, wire Gun relay on startup |
| `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` | Add Delete and Re-seed buttons to FileRow |
| `src/lib/fileEncryption.ts` | Export helper to read assembled file data for re-seed |

