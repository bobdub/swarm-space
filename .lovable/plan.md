

## Adaptive Chunk Sizing + Rarest-First Confirmation

### Problem
Two hardcoded chunk sizes are far too small:
- **`torrentSwarm.standalone.ts`**: 64 KB default
- **`contentPipeline.ts`**: 32 KB default

A 3 MB file produces ~60 chunks at 50 KB each — excessive overhead per chunk (hashing, request/response, retries).

### What's Already Done
**Rarest-first** is already fully implemented in `torrentSwarm.standalone.ts` (lines 426-483). It counts chunk availability across peers, sorts by fewest sources, and requests the rarest chunks first. No changes needed here.

### Plan

**1. Add adaptive chunk size function** (new helper in `torrentSwarm.standalone.ts`)

Calculates chunk size based on file size:
- **< 1 MB**: 256 KB (few chunks, minimal overhead)
- **1–10 MB**: 512 KB
- **10–100 MB**: 1 MB
- **> 100 MB**: 2 MB (keeps chunk count manageable for very large files)

```text
getAdaptiveChunkSize(fileSize: number): number
```

**2. Update `torrentSwarm.standalone.ts`**
- Replace `DEFAULT_CHUNK_SIZE = 64 * 1024` with `DEFAULT_CHUNK_SIZE = 256 * 1024` as the floor
- In `seed()`, call `getAdaptiveChunkSize(data.byteLength)` instead of using the static default when no explicit chunkSize is passed

**3. Update `contentPipeline.ts`**
- Change default from `32 * 1024` to use the same adaptive function (imported or inlined)
- Default parameter: `chunkSize = getAdaptiveChunkSize(payload.length)` or similar

**4. Update `chunkProtocol.ts`** (if it has its own default)
- Ensure any chunk creation in the encrypted chunk protocol also uses adaptive sizing rather than a small hardcoded value

### Impact
- A 3 MB file: ~60 chunks → ~6 chunks (512 KB each) — 10x fewer round-trips
- A 300 KB file: ~5 chunks → ~2 chunks (256 KB each)
- Rarest-first already ensures optimal distribution across peers

### Files to modify
- `src/lib/p2p/torrentSwarm.standalone.ts` — adaptive chunk size + updated default
- `src/lib/pipeline/contentPipeline.ts` — updated default chunk size

