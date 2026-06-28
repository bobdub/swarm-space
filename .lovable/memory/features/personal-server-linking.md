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
- HTTPS-only. `http://` is rejected at save time except
  `http://localhost` / `127.0.0.1` for dev.
- Stage 4 signature gate on EVERY read. `personalServerGet` takes a
  `verify(bytes)` callback and discards bytes that fail.
- Public pinning opt-in; default cap 1 GiB, per-chunk cap 20 MiB (Core rule),
  local-only deny list keyed by content hash, LRU eviction.
- All wizard/panel buttons are `type="button"`; the wizard uses
  `<div role="form">` (Core rule, no native `<form>`).
- Usage writeback is throttled at 2.5m (Core rule) via `shouldWriteback`.

## Adapters
- `adapters/httpsBlob.ts` — `PUT/GET/HEAD/DELETE /chunks/:hash`,
  `GET /health`. Bearer auth. CORS required from app origin.
- `adapters/s3Compatible.ts` — direct SigV4 (Web Crypto, no node polyfill);
  object key `imagination/<userId>/chunks/<hash>`. Bucket stays private.

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
- `docs/runbooks/personal-server-reference.md`