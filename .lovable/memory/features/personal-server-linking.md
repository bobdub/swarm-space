---
name: Personal Server Linking
description: Bring-your-own encrypted storage. Users link HTTPS-blob or S3-compatible servers as private replicas or public-pin seeders. Plaintext/keys never leave the device.
type: feature
---

## Hard rules
- Encrypt-before-upload through V2 pipeline. ALL writes route through
  `src/lib/storage/providers/personalServerProvider.ts` — no new code path
  may bypass.
- Credentials live in `src/lib/crypto/memoryVault.ts` (in-memory AES-256-GCM,
  non-exportable). Persisted form is only the sealed blob; raw bytes never
  hit localStorage/IndexedDB plaintext.
- HTTPS for public addresses. `http://` is accepted for loopback, `*.local`
  and private IPv4 ranges (10.x, 172.16–31.x, 192.168.x) so desktop-hosted
  servers can link; `isLocalServerUrl()` flags these in the UI. Local servers
  need `Access-Control-Allow-Private-Network: true` on the OPTIONS preflight.
- The connection probe keys the object by the SHA-256 of the probe payload —
  servers reject a PUT whose body hash differs from the hash in the URL.
- Stage 4 signature gate on EVERY read. `personalServerGet` takes a
  `verify(bytes)` callback and discards bytes that fail.
- Public pinning opt-in; default cap 1 GiB, per-chunk cap 20 MiB (Core rule),
  local-only deny list keyed by content hash, LRU eviction.
- All wizard/panel buttons are `type="button"`; the wizard uses
  `<div role="form">` (Core rule, no native `<form>`).
- Usage writeback is throttled at 2.5m (Core rule) via `shouldWriteback`.
- Credentials persist per device in IndexedDB under a non-exportable AES-256-GCM
  `CryptoKey`, authenticated to both user ID and server ID. Raw credentials never
  enter localStorage; legacy session-only records use an in-place relink action.
- New manifests/chunks enter `personalServerSync`; private replicas upload and
  HEAD-verify every object before bulk chunks may be evicted locally. Offline or
  failed writes remain queued and resume on reconnect/startup.
- Read priority is Media Coin → verified personal server → local torrent/chunk →
  peer fallback. Remote JSON chunks are content-address verified before caching.
- Media chunks are NOT the whole replica. `personalServerRecords.ts` replicates
  the whole device: IndexedDB stores (posts, projects, users, comments, tasks,
  milestones, notifications, entanglements, connections, replicas, manifests,
  blockchain, tokenBalances, nfts, credit*, achievementProgress, miningSessions,
  meta) plus app localStorage state, batched, encrypted with a browser-bound
  AES-256-GCM replica key, keyed deterministically so updates overwrite and
  unchanged batches are skipped by plaintext digest.
- Every non-paused server (private AND public-pin) receives the owner's record
  replica. Sync re-drives on identity appearing, on any server-list change, on
  `online`, and every 60s.
- `getPersonalServerDiagnostics()/subscribePersonalServerDiagnostics()` expose
  state, objectsWritten, recordsWritten, recordsSkipped, queued, failed,
  lastObjectKey and the verbatim server error; the Personal Servers panel shows
  them under "Storage sync" with Sync now / Test write. Never replace a server
  error string with a generic message.

## Adapters
- `adapters/httpsBlob.ts` — `PUT/GET/HEAD/DELETE /chunks/:hash`,
  `GET /health`. Bearer auth. CORS required from app origin.
- `adapters/s3Compatible.ts` — direct SigV4 (Web Crypto, no node polyfill);
  object key `imagination/<userId>/chunks/<hash>`. Bucket stays private.

## Public mirror (peer downloads)
- Opt-in per server (`sharePublic`). Ciphertext is additionally written to a
  credential-free prefix `imagination/public/chunks/<hash>` (S3) or the plain
  `/chunks/:hash` route (HTTPS blob). Private replicas keep the per-user prefix.
- Mirrors are advertised as unsigned `mirrors` hints on outgoing manifests
  (`personalServerMirrors.ts`), remembered on receipt, and tried after the
  owner's own servers via `fetchChunkFromPublicMirrors`. Only public HTTPS
  mirrors are ever advertised or contacted — a LAN address cannot serve peers.
- Anonymous reads still pass the content-hash + Stage 4 verify gate before
  caching; a hostile mirror can only fail, never inject.
- MinIO/S3 owners grant anonymous read scoped to `imagination/public/*` only.

## Redundancy hook
- `getPublicPinServers()` returns eligible servers for the existing
  Redundancy Sweep. We do NOT add a new gossip path; public-pin servers
  register as another seeder candidate.
- `denyAndPurgeChunk(hash)` is the local-only abuse-report path.

## Q_Score integration
- Every I/O wrapped in `withHealth('storage', 'personal-server.{put|get|del}', …)`.
- `creds-missing` and `bad-chunk` spike the badge directly.

## Files
- `src/lib/storage/providers/personalServerProvider.ts`
- `src/lib/storage/providers/personalServerStore.ts`
- `src/lib/storage/providers/adapters/httpsBlob.ts`
- `src/lib/storage/providers/adapters/s3Compatible.ts`
- `src/components/settings/PersonalServersPanel.tsx`
- `src/components/settings/AddPersonalServerWizard.tsx`
- `src/lib/storage/providers/personalServerMirrors.ts`
- `src/lib/storage/providers/personalServerSync.ts`
- `docs/runbooks/personal-server-reference.md`
- `src/pages/PersonalServerGuide.tsx`