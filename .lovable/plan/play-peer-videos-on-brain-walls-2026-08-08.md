# Play peer videos on Brain walls

Right now a wall poster only renders media if the viewer's own device already holds the encrypted manifest and every chunk of that file. For a video another user pinned to a wall, the visitor usually has the post (posts gossip fine) but not the manifest/chunks, so the wall silently sits on "media syncing…" forever — it never asks the mesh for the pieces.

## What changes

`src/components/world/WallPostBillboard.tsx` gets the same fetch-then-decrypt path the feed's file preview already uses:

1. If the manifest is missing locally, request it from peers before giving up.
2. Before decrypting, pull any missing chunks from peers.
3. If the first decrypt still fails (a piece landed late), sweep once more and retry.
4. While that happens the poster shows a clear status ("fetching from peers…"), and retries automatically when new content arrives instead of only on post updates.
5. If the mesh has nothing (offline / no seeder), the wall shows "media unavailable — no seeder online" with tap-to-retry, rather than an endless spinner.

Nothing about how walls are placed, scoped (global vs project), or gossiped changes. Walled/NSFW lockouts stay exactly as they are.

## Technical detail

- Use `tryGetP2PManager()?.ensureManifest(fileId, { includeChunks: true })` (`src/lib/p2p/manager.ts:1394`) when `get('manifests', fileId)` returns nothing.
- Use `ensureManifestChunks(manifest)` (`src/lib/p2p/chunkFetch.ts`) before `decryptAndReassembleFile` / `progressiveDecryptToBlob`, mirroring `src/components/FilePreview.tsx:37-74`.
- Add a bounded retry loop (3 attempts with backoff, cancel-safe via the existing `cancelled` flag) plus listeners on existing content-arrival events so late chunks trigger a re-render.
- Extend the `MediaState` union with a `syncing` status message; keep the `locked` / walled / NSFW branches untouched.

## Verification

- Typecheck.
- Drive two browser sessions against the preview: user A pins a video post to a wall in the Brain, user B walks up and the video element appears and plays. Screenshot both sides before reporting success.