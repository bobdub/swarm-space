# Fix Shared-File Downloads (root cause first, batch download after)

## What's actually broken

Verified by reading the code paths involved:

- `src/components/FilePreview.tsx` → calls `decryptAndReassembleFile(manifest, fileKey, …)`.
- `src/lib/fileEncryption.ts` line 307 — `decryptAndReassembleFile` does:
  ```ts
  const chunk = await get("chunks", ref);
  if (!chunk) throw new Error(`Chunk ${ref} not found`);
  ```
  It reads chunks **only from local IndexedDB** and throws the moment one is missing.
- `src/lib/torrent/streamingDecryptor.ts` line 214 does the exact same thing.
- On-demand chunk fetching over P2P **does** exist in `src/lib/p2p/manager.ts`:
  - `ensureChunksForManifest(manifest, sourcePeerId?)` (line 3201) walks `manifest.chunks`, and for any chunk not in the local store it calls `chunkProtocol.requestChunk(peerId, chunkRef)` against candidate peers.
  - But it's only invoked in two places: when a manifest arrives (line 1408) and during manifest-request completion (line 3158). **It is never called at download / preview time.**

So the failure mode a real user hits with a file *someone else shared*:

1. Manifest replicates to the local node.
2. One or more chunks fail to arrive (peer offline mid-sync, dropped packet, WebRTC teardown, join-after-broadcast).
3. User clicks Preview/Download → decrypt throws on the first missing chunk → toast "Failed to decrypt file" → no retry, no fetch attempt, no visibility into which chunk is missing.

`FilePreview.tsx` also catches the throw and reports a generic error; it never asks the mesh for the missing bytes.

## Fix (single-file first — the actual bug)

Small, surgical, no crypto changes.

### 1. Public helper: `ensureManifestChunks(manifest)`

Add to `src/lib/p2p/manager.ts` (and re-export from a small entrypoint like `src/lib/p2p/chunkFetch.ts` for UI callers):

```ts
export async function ensureManifestChunks(manifest: Manifest): Promise<{
  ok: boolean;
  missing: string[];
}>
```

Behavior:
- If `tryGetP2PManager()` returns null (offline / not connected), return `{ ok: false, missing: <all not-in-IDB chunks> }` — no throw.
- Otherwise call the existing private `ensureChunksForManifest` (promote it to `public` or wrap it). After the sweep, re-scan `manifest.chunks` against IndexedDB and return whichever chunk refs are still absent.
- Add a soft timeout per chunk request (e.g. 8 s) so a dead peer can't hang the UI. `chunkProtocol.requestChunk` already races — verify and, if not, wrap with `Promise.race`.

### 2. Wire it into the download path

`src/components/FilePreview.tsx`, in `loadAndDecrypt`, **before** calling `decryptAndReassembleFile` / `progressiveDecryptToBlob`:

```ts
setStatus('Fetching missing pieces from peers…');
const { ok, missing } = await ensureManifestChunks(manifest);
if (!ok && missing.length === manifest.chunks.length) {
  // Nothing local and no peers responded — surface clearly, don't just say "failed to decrypt".
  throw new Error(`This file isn't available yet. ${missing.length} pieces still need to sync from other users.`);
}
// Even if some are still missing, attempt decrypt — it will only fail on the first hole and we can retry.
```

On a decrypt failure, run one automatic retry via `ensureManifestChunks` before showing an error toast. Cap retries at 2 to avoid loops.

### 3. Better user-facing errors

Replace the blanket `"Failed to decrypt file"` in `FilePreview.tsx` with the thrown message when it's an availability error. Show a **Retry** button on the failure state that re-runs `loadAndDecrypt`. Show the seeder count for that `fileId` (already available in `Files.tsx` via `sm.getAllFileSeederCounts()`) so the user knows whether anyone is online to serve it.

### 4. Verification (the "foolproof" part)

Empirically prove the fix, not just typecheck:

- **Bench test**: two browser profiles. Profile A uploads a 5 MB image. Profile B opens `/files`, force-clears half the chunks from IndexedDB via devtools, clicks Preview → expect: "Fetching missing pieces…" progress, then successful preview + download.
- **Offline case**: Profile B with P2P disconnected → expect the new "isn't available yet — N pieces need to sync" message and a Retry button, not a silent "Failed to decrypt".
- **Log signal**: `[P2P] ✅ Retrieved chunk …` for each fetched piece confirms the round-trip through `chunkProtocol.requestChunk`.

Only when steps 1–4 are green do we proceed to step 5.

## Step 5. Batch download (once single-file is proven)

Same design as before, now safe because every file goes through `ensureManifestChunks` first:

- New `src/lib/utils/batchDownload.ts` calls `createAccountExportStream({ includePosts: false, includeMedia: true, manifestIds }, { dependencies: { loadPosts: async () => [] } })`. In a thin `resolveAttachment` override, call `ensureManifestChunks(manifest)` before `decryptAndReassembleFile` so a missing chunk in one file doesn't silently zero-byte it. Failed files land in the exporter's `warnings[]`.
- `src/pages/Files.tsx`: add per-row checkboxes, a "Select all filtered" toggle, and a Download-ZIP action bar with a progress bar. Cap batch at 200 files / ~2 GB combined `manifest.size`.
- Toast summary: `"Downloaded X files (Y skipped — try again once more peers are online)"`.

## Files touched

- **Edit**: `src/lib/p2p/manager.ts` — expose `ensureChunksForManifest` and add the wrapped helper (or add `src/lib/p2p/chunkFetch.ts` that imports the manager).
- **Edit**: `src/components/FilePreview.tsx` — pre-fetch pass, better error copy, Retry button.
- **New**: `src/lib/utils/batchDownload.ts` (step 5).
- **Edit**: `src/pages/Files.tsx` — selection UI + batch action bar (step 5).

## Out of scope

- No changes to encryption, key wrapping, chunk protocol wire format, or manifest schema.
- No server round-trips; everything stays offline-first / P2P.
- No changes to upload path.
