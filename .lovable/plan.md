## Fix Chunk Sizing + Transfer Stall

### Problem 1: Chunk size not applied
The adaptive chunk sizing was added to `torrentSwarm.standalone.ts` and `contentPipeline.ts` but **missed the actual encryption path**. Two locations still hardcode 64KB:

- `src/components/FileUpload.tsx` line 93: explicitly passes `64 * 1024` to `chunkAndEncryptFile`
- `src/lib/fileEncryption.ts` line 83: default parameter `chunkSize = 64 * 1024`

This is why a 1.8MB upload produces 29 chunks (1.8MB / 64KB ≈ 29).

### Problem 2: Transfer stalls at 80%
The rarest-first loop runs every 2s but only sends one request per chunk per cycle. If the seeding peer briefly drops or a request times out (15s), remaining chunks stall because in-flight slots stay occupied until the timeout fires. With only one seeder, the last few chunks can deadlock.

### Plan

**1. Fix chunk sizing in FileUpload.tsx**
- Remove the hardcoded `64 * 1024` argument
- Import `getAdaptiveChunkSize` from `torrentSwarm.standalone.ts`
- Pass `getAdaptiveChunkSize(file.size)` instead

**2. Fix default in fileEncryption.ts**
- Change default parameter from `64 * 1024` to use adaptive sizing
- Import and call `getAdaptiveChunkSize(file.size)` as the default

**3. Fix transfer stall in torrentSwarm.standalone.ts**
- Reduce `REQUEST_TIMEOUT_MS` from 15s to 8s — stale requests clear faster
- In `requestRarestChunks`, remove the `break` after the first request so multiple missing chunks can be requested in a single poll cycle (up to `MAX_REQUESTS_PER_PEER` per peer)
- Add a re-request mechanism: if a chunk has been in-flight for more than half the timeout, re-request it from a different peer if available

### Expected result
- 1.8MB file: 29 chunks → 7 chunks (256KB each)
- Transfers no longer stall — timed-out requests clear in 8s and chunks are re-requested from alternate peers

### Files to modify
- `src/components/FileUpload.tsx` — remove hardcoded chunk size
- `src/lib/fileEncryption.ts` — adaptive default chunk size
- `src/lib/p2p/torrentSwarm.standalone.ts` — fix stall with faster timeouts and multi-request per cycle

## Fix Profile Navigation from PostCard — DONE

### Changes Made
1. **`src/types/index.ts`** — Added `authorPeerId?: string` to `Post` interface
2. **`src/components/PostComposer.tsx`** — Stamps `authorPeerId` from `connection-state` localStorage on new posts
3. **`src/pages/Profile.tsx`** — Fallback profile construction from post metadata when user record is missing, 3s retry grace period, "Profile not synced or connected" message instead of "Profile not found"
