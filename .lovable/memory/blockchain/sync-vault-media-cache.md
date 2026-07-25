---
name: Sync Vault Media Cache
description: Per-peer local cache backed by sealed SWARM coins; vaultLookup short-circuits torrent fetches. Feature-flagged, no new gossip topic.
type: feature
---
Sync Vaults are per-peer IndexedDB records (`syncVaults` store, DB v26)
that reuse sealed SWARM coins as containers for received media.

Modules (additive, no transport changes):
- `syncVault.ts` — CRUD + allocation, 100 MiB per coin, rollover at 80% fill.
- `vaultIngest.ts` — subscribes to `onMediaCustody`, writes into sender's vault.
- `vaultLookup.ts` — `resolveFromVaults(hash)` runs BEFORE torrents; miss falls through.
- `vaultSeeder.ts` — read-only `has()` / `inventory()`; NO new gossip topic.
- `vaultConfig.ts` — soft flag, default ON, `?vaults=0` disables, Settings toggle.

Vault-usable = `status==='wallet' && fillState!=='spent'` (spend guard doesn't apply — vaults don't consume the coin).

UI: `SyncVaultsPanel` in `/storage-diagnostics` (purge + hit-rate).
Boot: `startVaultIngest` scheduled after guardrails chain in `main.tsx`.