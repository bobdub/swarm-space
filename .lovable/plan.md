

## Complete Corrections

Fix four remaining issues from the UX/UI restructure.

---

### 1. Fix inflated Content Distribution counts

**`src/components/p2p/dashboard/TorrentSwarmPanel.tsx`**

Replace `countStore('manifests')` and `countStore('chunks')` with a new `countActiveStore` function that opens a cursor on the `manifests` store, skipping entries where `seedingPaused === true`, and only counting chunks that belong to active manifests.

Simpler approach: replace `dbCounts.manifests` with `files.length` in the StatBox (since `files` already filters paused manifests at line 124). For chunks, sum `file.totalChunks` from the active `files` array. This avoids a new IndexedDB query entirely.

Lines ~362-363: change from `dbCounts.manifests` / `dbCounts.chunks` to `files.length` / `files.reduce((s, f) => s + f.totalChunks, 0)`.

Can remove the `countStore` function and `dbCounts` state entirely since they're no longer used, along with the `dbPoll` interval at line 225.

---

### 2. Fix "Waiting for attachments" on paused manifests

**`src/components/PostCard.tsx`**

In `loadFiles` (~line 248-254), after retrieving the manifest from IndexedDB, the current code adds to `missingManifests` if `!manifest`. Add a condition: if the manifest exists and has `seedingPaused: true` but also has a valid `fileKey` and `chunks` array, treat it as a normal manifest and proceed with decryption. The `seedingPaused` flag only affects mesh distribution — local data is intact.

No change needed to the decryption path itself — just don't skip paused manifests that have their data.

---

### 3. Add per-peer unavailable cooldown

**`src/lib/p2p/swarmMesh.standalone.ts`**

Currently `unavailablePeers` is a `Set<string>` (line 313) that only tracks peers during a single cascade connect cycle, then gets cleared. The library reconnect loop (line 962-989) doesn't check it at all, causing repeated `peer-unavailable` errors every 30 seconds.

Changes:
- Replace `unavailablePeers: Set<string>` with `peerCooldowns: Map<string, number>` (peerId → timestamp of last unavailable error).
- In the `peer-unavailable` error handler (line 1231-1237), set `this.peerCooldowns.set(peerId, Date.now())`.
- In `startLibraryReconnectLoop` filter (line 969), add: `!this.isPeerCoolingDown(peerId)`.
- In cascade connect Phase 1b (line 853), use the cooldown map instead of the set.
- Add helper: `isPeerCoolingDown(id)` returns `true` if cooldown timestamp is within last 5 minutes.
- On successful connection, clear cooldown: `this.peerCooldowns.delete(peerId)`.

---

### 4. Delete orphaned Trending page

**Delete `src/pages/Trending.tsx`** — the route was removed from `App.tsx` but the file still exists.

---

### Files

| File | Action |
|---|---|
| `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` | Use `files.length` for counts, remove `countStore`/`dbCounts` |
| `src/components/PostCard.tsx` | Don't skip paused manifests that have fileKey + chunks |
| `src/lib/p2p/swarmMesh.standalone.ts` | Replace `unavailablePeers` Set with 5-min cooldown Map |
| `src/pages/Trending.tsx` | Delete |

