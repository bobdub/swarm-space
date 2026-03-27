

## Flush Stuck Torrents

**Problem**: 192 files / 10,745 chunks are stuck seeding in the Content Distribution panel. The user removed the UI button previously but needs these flushed programmatically.

**Solution**: Call `flushAll()` automatically on TorrentSwarm initialization and purge all persisted torrent manifests from IndexedDB on startup.

### Changes

**1. `src/lib/p2p/torrentSwarm.standalone.ts`**
- In the `start()` method, call `this.flushAll()` immediately before setting up listeners. This clears any stale manifests, chunks, and timers inherited from previous sessions.
- Add a standalone `purgeAllPersistedTorrentManifests()` function that opens IndexedDB, iterates the `meta` store, and deletes every key with the `torrent-manifest:` prefix. Call this from `start()` as well.
- This ensures on every fresh connect, torrents start clean — no ghost seeds, no stuck downloads.

**2. `src/lib/p2p/torrentSwarm.standalone.ts` — singleton reset**
- In `destroyTorrentSwarm()`, also call `flushAll()` before nulling the instance, so disconnecting always cleans up.

**Result**: Every time the mesh connects, all prior torrent state is wiped. Users' content remains in their local posts/files — only the torrent distribution layer resets. Content will re-seed naturally when peers request it via the normal announce cycle.

