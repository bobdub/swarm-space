


# ✅ Completed: Delete & Re-seed Torrents + Gun.js Content Delivery Bridge

## What Was Implemented

### Part 1: Delete & Re-seed Controls
- **TorrentSwarm.remove(manifestId)** — Stops download timer, broadcasts `not-interested`, clears all in-memory state
- **TorrentSwarm.reseed(manifestId)** — Reassembles completed file, removes old torrent, re-seeds with current adaptive chunk sizing
- **SwarmMesh.deleteFile(fileId)** — Delegates to TorrentSwarm + deletes from IndexedDB via `deleteManifest()`
- **SwarmMesh.reseedFile(fileId)** — Delegates to TorrentSwarm reseed + emits alert
- **UI**: Delete (Trash2) button on all files with confirmation dialog; Re-seed (RefreshCw) button on completed/seeding files only

### Part 2: Gun.js Secondary Torrent Transport
- **GunRelayAdapter interface** — Typed interface for Gun relay integration
- **TorrentSwarm.attachGunRelay()** — Accepts a GunAdapter, listens for torrent messages via Gun, re-announces seeding manifests
- **Message deduplication** — `seenMsgIds` Set (capped at 500) prevents double-processing from dual transports
- **sendWithFallback()** — Tries primary mesh first, falls back to Gun relay on failure
- **SwarmMesh.attachGunRelayToTorrent()** — Auto-wires GunAdapter (Manhattan relay) to TorrentSwarm on startup

### Files Modified
- `src/lib/p2p/torrentSwarm.standalone.ts`
- `src/lib/p2p/swarmMesh.standalone.ts`
- `src/components/p2p/dashboard/TorrentSwarmPanel.tsx`
