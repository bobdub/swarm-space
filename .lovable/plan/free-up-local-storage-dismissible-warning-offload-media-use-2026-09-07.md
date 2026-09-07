# Free up local storage: dismissible warning, offload media, use your own server

Three fixes for the "9.9 GB / 10 GB full" situation.

## 1. The full-storage warning can be closed

Today the red bar is fixed to the top of every page with no way to remove it, so it covers page content.

- Add a close (X) button. Dismissing hides it for the rest of the session, and again for 24 hours once storage drops back below the danger level.
- Add a "Free up space" button that takes you straight to Settings → Storage.
- Make the bar part of the page flow (content shifts down instead of being covered) so nothing is hidden behind it.
- The bar still returns on a new session while storage is critical — it is a warning, not something to permanently silence.

## 2. Download your media and posts, then clear the local copy

New "Free up space" section in Settings → Storage (and mirrored on the Storage Diagnostics page):

1. Shows what is taking space: media pieces vs posts vs account data, with sizes.
2. **Download everything** — one file containing your posts, media and file records (the existing archive export, extended to include posts).
3. **Clear downloaded media** — only runs after a successful download in the same visit. It removes the bulky media pieces and file records, and keeps account, identity, keys, wallet/coins, posts and settings untouched.
4. Confirmation dialog naming exactly what is removed and what is kept, plus a note that anything still held by other people on the network can be re-fetched later.
5. Progress and the freed amount are reported when it finishes.

Safety: the clear step never touches the protected stores (account, keys, blockchain, tokens, posts), and is blocked if the download step failed.

## 3. A personal server should actually absorb the bulk data

Verified in the code: the personal-server storage backend exists, but it is never registered as a place the app routes data to — only an external device (folder on disk) is. Result: even with a linked personal server that has free space, all media pieces are still written into the browser, which is why the browser fills up.

Fix:

- When a linked personal server is healthy and has room, register it as the destination for bulk data (media pieces and file records) and for replicas, preferring it over the browser.
- Reads check the browser first, then fall back to the server, so nothing breaks if the server is offline.
- If the server is paused, unreachable, or over its cap, writes fall back to the browser as they do today.
- Settings → Storage shows which destination is currently active ("Personal server — 1.2 GB used of 50 GB") so it is obvious where new uploads land.
- A "Move existing media to my server" action uploads what is already in the browser to the server and clears the local copies as each one is confirmed.

## Technical notes

- `StorageFullBanner.tsx`: add dismiss state (`sessionStorage` + 24h `localStorage` key), a `Link` to `/settings?tab=storage`, and swap `fixed` for a layout-level slot in `App.tsx`.
- New `src/lib/storage/offload.ts`: `estimateLocalUsage()` (per-store byte estimate), `exportUserData()` (reuses `archiveFallback.exportArchive` plus the `posts` store), `clearBulkLocal()` which deletes only `manifests`, `chunks`, `replicas` — never a `critical` tier store from `STORE_TIER_MAP`.
- New UI section in `StorageTargetsPanel.tsx` + `StorageDiagnostics.tsx`, `role="form"` and `type="button"` per project rules.
- Registration gap: `setTierOverride` is currently called only by `StorageTargetsPanel` for `ExternalDeviceProvider`. Add a `StorageProvider` wrapper around `personalServerProvider` (get/put/remove/getAll/getCapacity from `capBytes - usedBytes`, health from `PersonalServerHealth`) and register it on boot when a healthy server exists, with `bulk` and `replica` tier overrides and a browser read-through fallback.
- Respect existing constraints: 20 MiB per chunk cap, 2.5-minute throttled writeback, credentials unsealed per call from the in-memory vault.

## Verification

Users will test and verify.