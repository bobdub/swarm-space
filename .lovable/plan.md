# Private server: make it actually receive data

Nothing is landing in the `swarmspace` bucket. The current pipeline can only ever push media chunks, and when it fails it fails silently. This plan makes the failure visible first, fixes the silent-failure paths, then widens replication to a full encrypted device replica.

## What the code shows today (verified)

- Only two things are ever queued for a server: encrypted media manifests (`chunkAndEncryptFile`, `adaptiveChunker`) and pipeline content (`runContentPipeline`). Posts, profiles, world builds, wall placements and ledger data are never enqueued — so a text-only or world-only session writes nothing.
- `eligibleServers()` filters to `scope === 'private'`. A server linked as **Public pin** receives nothing at all, with no message saying so.
- Every failure is written into the queue record's `error` field. Nothing logs it, nothing shows it. The panel only shows a count of queued items, so "0 objects" and "silently erroring" look identical.
- Credentials live in an IndexedDB device key. If they can't be unsealed, each attempt throws "credentials missing — relink" into the same invisible field.
- The startup backfill runs once at idle; if it runs before the server list is usable, it enqueues nothing and the 60s tick only re-drives records that already exist.
- Cap accounting (`usedBytes`) is written back at most every 2.5 minutes, so a cap-exceeded stop can also happen quietly.

## 1. Make the failure visible (do this first)

- Add a **Storage sync** diagnostics section to the Personal Servers panel: queue counts by status (pending / syncing / complete / failed), the last error text per server, the last attempted object key, and the time of the last attempt.
- Make **Sync now** run the queue immediately and report the outcome in a toast: objects written, objects verified, and the first error verbatim (status code and server body).
- Add `[PersonalServerSync]` console logging around each step: enqueue, HEAD, PUT, verify, complete, evict — with the server id, object key and byte length.
- Add a **Test write** action that PUTs one small encrypted object and reports the exact HTTP status/body, so a MinIO CORS or policy rejection is named instead of guessed.

## 2. Fix the silent-failure paths

- Sync for every non-paused linked server regardless of `scope`; public-pin servers still receive the owner's own replica.
- Drive the queue on demand: re-run the backfill once the server list and identity are both ready, and after any server is added, relinked, resumed or edited.
- Surface `credentials missing`, `cap exceeded` and `paused` as first-class server states in the panel, not as queue errors.
- Update `usedBytes` from the actual writes on each completed record instead of only on the throttled writeback, and use the server's reported usage after a probe when available.
- Keep retries bounded, but stop marking a record `failed` without a visible reason attached to the server row.

## 3. Replicate everything on this device (encrypted)

Add a record replication track alongside the existing chunk track. Each record is serialised, encrypted with the existing device/content keys, and stored content-addressed under a per-user prefix:

```text
imagination/<userId>/chunks/<hash>      media chunks (today)
imagination/<userId>/records/<hash>     posts, profile, world, ledger (new)
imagination/<userId>/index/<epoch>.json signed index of record hashes
```

- Enqueue on write for: posts and blog entries, comments, profile/identity metadata, project and wall placements, world/builder objects, land plots, and blockchain/vault snapshots.
- Batch small records (throttled, coalesced) so a busy mesh session doesn't produce thousands of tiny PUTs; the periodic index object lists what the epoch contains.
- Plaintext never leaves the device; only ciphertext plus content hashes go to the server, and reads pass the existing hash + Stage 4 signature gate before use.
- Restore path: when a record is missing locally, resolve it from the server index before falling through to torrent/peer sync.

## 4. Verify

- Unit tests: record enqueue coverage per content type, queue state transitions, cap/paused/credential branches, and index integrity.
- Browser check against the running app: link the MinIO server, publish a text post, place a world object, upload media — then confirm objects under `imagination/<userId>/records/` and `/chunks/` and a growing bucket size.
- MinIO-side checklist in the runbook: bucket CORS for the app origin (PUT, GET, HEAD, DELETE + `ETag` exposed), access key permissions, and the `Access-Control-Allow-Private-Network` note for LAN hosting.
- Run the UQRC consistency check and extend the MemoryGarden caretaker reflection.

## Notes

- If the diagnostics in step 1 reveal a CORS or credential rejection, that is the whole cause of "nothing at all" and steps 2–3 still stand: without them the server would only ever hold media.
