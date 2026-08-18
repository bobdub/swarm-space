# Personal Server: Persistent Connection and Server-First Storage

## Goal
Make a connected personal server receive encrypted post/media data as it is created, reconnect automatically on the same browser, and stop retaining completed bulk payloads in browser storage after the server has safely confirmed them.

## Confirmed current state
- New encrypted manifests/chunks are written directly to IndexedDB; the publish and upload paths do not call the personal-server provider.
- `personalServerPut` is currently used only by the connection probe, so linked servers do not receive posted content.
- Server credentials are sealed with a fresh in-memory key on every page load. The stored ciphertext cannot be reopened after leaving, which causes the forced delete/reconnect behavior.
- Existing media chunks are 1 MiB, below the provider's 20 MiB per-chunk limit.

## Implementation

### 1. Persist the server connection safely on this device
- Add a per-browser, non-exportable AES-256-GCM device key stored as a structured `CryptoKey` in IndexedDB.
- Encrypt each server's bearer/S3 credentials with that key and bind the ciphertext to both the active user ID and server ID.
- Keep plaintext credentials transient: decrypt only for an individual request, then discard the reference.
- Migrate newly entered credentials to this durable encrypted format; treat old session-only blobs as needing a one-time relink, without requiring users to delete server metadata.
- Add a direct **Relink credentials** action and clear the encrypted credential record when a server is removed.

### 2. Add a server-first replication queue
- Introduce a small persistent queue/index for encrypted manifests and chunks awaiting upload; do not create a second content format.
- After local encryption/chunking completes, enqueue the signed manifest and referenced encrypted chunks and start upload immediately when an eligible private server is healthy.
- Use bounded concurrency, idempotent content-addressed keys, retries with backoff, pause/cap/HTTPS checks, and the existing 20 MiB guard so posting remains responsive.
- On startup, reconnect the server and resume pending work; run a throttled one-time backfill for existing local manifests/chunks so current browser-only content is copied too.

### 3. Verify before evicting browser payloads
- Confirm every referenced chunk with server `HEAD`, then confirm the manifest; only then mark the upload complete.
- Remove completed bulk chunks from IndexedDB only after full remote verification. Keep critical post records, signed manifest/index metadata, retry state, and actively used cache entries locally.
- Never evict a chunk still needed by another pending manifest, active torrent/media-coin operation, or failed upload.
- If the server is unavailable, retain the encrypted local queue and retry later rather than losing or blocking the post.

### 4. Restore through the verified read path
- When a local chunk is absent, fetch it from the personal server before falling through to torrent/peer sync.
- Pass all returned bytes through the existing signature/hash verification gate before caching or rendering.
- Preserve the established resolution priority where applicable: Media Coin → personal server authoritative copy → torrent → peer sync.

### 5. Surface truthful connection and storage status
- Update Personal Servers UI to distinguish **Connected**, **Syncing**, **Offline—queued**, **Relink required**, and **Paused**.
- Show pending item count, last successful sync, remotely stored bytes, and a manual **Sync now** action.
- Replace the current warning that credentials are always lost on tab close with accurate same-device auto-connect language.

### 6. Validate the complete lifecycle
- Add focused tests for device-key persistence, user/server binding, credential removal, retry/resume, backfill, deduplication, cap handling, verified eviction, and remote read rejection on invalid bytes.
- Run the UQRC consistency check and targeted storage tests.
- Verify in-browser: link server → publish text/media → observe remote PUT/HEAD → reload/leave and return → confirm automatic reconnection → open content after local bulk eviction.
- Extend the MemoryGarden caretaker reflection after the repository is tended.

## Safety boundaries
- Plaintext content and raw credentials never enter localStorage or persistent records.
- Browser storage remains a crash/offline safety queue, not the authoritative completed bulk store.
- No local deletion occurs until the full remote object set is confirmed.
- Existing IndexedDB upgrades remain non-destructive and cross-tab safe.