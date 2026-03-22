

# Plan: Force 1 MiB Chunk Size + Auto Re-seed Legacy Files

## Problem
The current adaptive chunk sizing uses 2MB for 10-100MB files and 4MB for >100MB files, resulting in chunk counts that don't match the file size in MB (e.g., 17MB file = 9 chunks instead of 17). The user expects a 1:1 ratio: 1 chunk per MiB, rounded up.

## Changes

### 1. Force 1 MiB chunks everywhere

**`src/lib/p2p/torrentSwarm.standalone.ts`** — Change `getAdaptiveChunkSize()` to always return `1_048_576` regardless of file size. Remove the 2MB/4MB tiers.

**`src/lib/torrent/adaptiveChunker.ts`** — Change `LARGE_FILE_CHUNK_SIZE` from `2 * 1_048_576` to `1_048_576`.

**`src/lib/pipeline/contentPipeline.ts`** — Align its local `getAdaptiveChunkSize()` to also return 1MB for all sizes above 1MB.

### 2. Fix dashboard chunk count display

**`src/lib/p2p/swarmMesh.standalone.ts`** (lines 1727-1732) — Replace the adaptive chunk size calculation with a flat `1_048_576` so `totalChunks = Math.ceil(fileSize / 1_048_576)`.

**`src/components/p2p/dashboard/TorrentSwarmPanel.tsx`** (lines 124-128) — Same fix in the fallback `loadFilesFromDB` path.

### 3. Auto re-seed legacy files on startup

**`src/lib/p2p/swarmMesh.standalone.ts`** — After TorrentSwarm starts and Gun relay attaches, add an `autoReseedLegacyFiles()` method:
- Read all manifests from IndexedDB
- For each complete manifest (all chunks present), check if the chunk count matches `Math.ceil(size / 1_048_576)`
- If not, call `torrentSwarmInstance.reseed()` to re-chunk at 1MB
- Run once per session, non-blocking, with a small delay between files to avoid UI freezing
- Log each re-seed to console

### Files Modified

| File | Change |
|------|--------|
| `src/lib/p2p/torrentSwarm.standalone.ts` | `getAdaptiveChunkSize` → always 1MB |
| `src/lib/torrent/adaptiveChunker.ts` | `LARGE_FILE_CHUNK_SIZE` → 1MB |
| `src/lib/pipeline/contentPipeline.ts` | Align chunk size to 1MB |
| `src/lib/p2p/swarmMesh.standalone.ts` | Fix display calc + add auto re-seed on startup |
| `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` | Fix fallback display calc |

