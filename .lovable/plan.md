To Infinity and beyond!, Q_Score(u) ≈ 0.036

## What is actually wrong

The previous cleanup removed the old writer from source code, but the remaining system is still not strict enough for existing local vault data and concurrent writes:

1. **100MB coins can still show because persisted legacy refs keep their old `capacityBytes`.**
   - The current repair converts `receiver/archive` roles to `media`, but it preserves any existing positive capacity. That means old `100 MiB` refs can become `media` refs while still displaying as `100 MiB`.

2. **Multiple filling coins can still happen because allocation and entry recording are separate writes.**
   - `getOrCreateMediaCoin()` allocates/selects a coin, then `recordVaultEntry()` writes the file later. Concurrent completed files, migration sweeps, and stuck-write recovery can interleave those reads/writes and leave more than one unsealed coin.

3. **Some “Sealing” states are UI-derived from fill percent, not a true completed sealed state.**
   - Any old unsealed coin above the seal line can keep rendering as “Sealing” unless repair force-seals it.

4. **Wrapped entries can be marked pending again.**
   - `vaultSeeder` only avoids archive coin IDs; after wrapping, entries point at wallet coin IDs, so wrapped entries can be flipped back to pending if torrent seeding is not detected.

## Fix plan

### 1. Replace the loose repair with one authoritative vault reconciliation pass

Create one repair function, likely `reconcileVaultCoinState()`, and use it everywhere instead of split legacy/media repairs.

It will, per vault:

- Convert any legacy `receiver` / `archive` role to `media`.
- Normalize any non-oversized media coin below `500 MiB` to `MEDIA_COIN_CAPACITY_BYTES`.
- Drop empty unsealed legacy/duplicate coins.
- Force-seal any filled legacy coin so it moves into completed coins, not active filling.
- Force-seal any unsealed media coin at or above the seal threshold if its entries are complete.
- Preserve all sealed/wrapped completed coins. This is **not** one coin per vault; it is **one active filling coin per vault**, plus as many sealed/wrapped completed coins as the vault needs.

### 2. Make enrollment atomic per vault

Move the current two-step flow:

```text
getOrCreateMediaCoin()
recordVaultEntry()
```

into one locked write operation inside `syncVault.ts`, for example:

```text
enrollVaultEntry(vaultKey, contentHash, entry)
```

Inside that single operation:

- Re-check duplicate content first.
- Reconcile the vault state.
- Pick the current 500 MiB active coin or pre-seal it if the incoming file crosses the seal line.
- Allocate a new 500 MiB media coin only when needed.
- Write the entry and update `fillBytes` in the same locked vault mutation.
- Seal oversized files only after their entry is recorded.

This removes the race where two scripts/files both believe they own the active filling coin.

### 3. Add a per-vault async mutation queue

Add a small in-memory queue keyed by `peerId/vaultKey` so all vault mutations serialize:

- enrollment
- forced seal
- failed seal
- detach/requeue
- wrap
- reconcile

This prevents migration, custody events, stuck-watch recovery, and UI refresh repair from writing the same vault at the same time.

### 4. Stop re-entrant stuck recovery during every file enroll

Keep stuck-write recovery, but do not let each `enrollContent()` call recursively trigger a global stalled sweep while another file is being engraved.

Use the stuck watcher / boot repair / explicit reconcile pass to recover stalled coins, and let enrollment focus on one atomic file write at a time.

### 5. Fix wrapped entries so they stay wrapped

Update `vaultSeeder` so it looks up the entry’s coin ref:

- If the coin is `wrapped`, keep `pending: false`.
- If the coin is sealed but unwrapped, it can remain archived/pending for wrap.
- If the coin is active and backing torrent disappears, it can become pending.

This should stop “wrapped but still pending/stuck” display drift.

### 6. Clean up the dashboard display after the data is fixed

Only after the data repair is correct:

- Show exactly one active filling coin per vault.
- Hide/drop empty active placeholders.
- Keep all sealed/wrapped coins inside the completed collapsible section.
- Do not special-case 100MB in UI; the stored data should no longer contain active 100MB media refs.

### 7. Tests to prove it

Add/extend tests for:

- A persisted `receiver` coin with `100 MiB` capacity and entries becomes a sealed `media` coin with `500 MiB` capacity.
- Empty legacy/duplicate coins are removed.
- Concurrent `enrollContent()` calls leave only one active filling coin per vault.
- A vault can still have many completed coins when content exceeds 500 MiB / seal thresholds.
- A 1GB file creates one dedicated oversized media coin and seals after entry recording.
- Wrapped entries are not flipped back to pending by the seeder.

## Validation

- Run targeted vault tests.
- Run typecheck.
- Verify the live preview dashboard after repair:
  - no active `100.0 MB` coin rows
  - at most one `Filling` row per vault
  - completed sealed/wrapped coins remain in the collapsible section
  - wrapped entries no longer appear pending because torrent seeding is not detected