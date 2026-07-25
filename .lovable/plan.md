## Torrents ↔ Coins: two-way enforcement + Archive vault

Root cause of the "267 seeding but only 1 file/1 coin in a vault" mismatch:

- Nothing emits `MediaCustody` events, so `vaultIngest` never fires. The only enrolment path is the one-time migration in `TorrentSwarmPanel`, which is gated by `sessionStorage['vault-migration-v1-done']` and bails out entirely when there is no unused wallet coin.
- The migration records torrents as `name: manifestId.slice(0,16)+'…'`, `mime: 'video/torrent'`, so even the one enrolled entry has no real filename.
- There is no coin→torrent enforcement: a sealed coin that is a vault container has no signal that its indexed hashes must remain seeded.

### Fix, in three surgical changes

**1. Archive role in Sync Vaults (no-coin fallback)**

`src/lib/blockchain/syncVault.ts`

- Extend `VaultCoinRole` with `"archive"`.
- Add `ensureArchiveCoin(peerId)` → creates a synthetic `VaultCoinRef` with `coinId: 'archive:<peerId>'`, `role: 'archive'`, `capacityBytes: Infinity`. Not backed by a real SWARM coin, does not appear in `taken` set, never blocks real allocation.
- Add `VaultIndexEntry.name?: string` and `VaultIndexEntry.pending?: boolean` (true when stored in archive).
- Add `promoteArchivedEntries(peerId, walletCoins)`: for every entry whose `coinId` starts with `archive:`, allocate/rollover a real receiver coin and rewrite the entry's `coinId` + clear `pending`. Returns count promoted.

**2. Enrolment on completion (torrents → coins)**

Emit MediaCustody + write to vault at the moments content actually becomes "seeding/complete", so new content is enrolled without waiting for migration.

- `src/lib/blockchain/vaultEnroll.ts` (new, ~60 lines): `enrollSelfContent({ contentHash, name, mime, size, ref, ownerPeerId? })` — resolves target peer, tries `getOrRolloverReceiverCoin`; if none, falls back to `ensureArchiveCoin`; calls `recordVaultEntry` with `name`, `mime`, `pending` flag. Idempotent via `findVaultEntry`.
- `TorrentSwarmPanel.tsx`: in the effect that loads `files` and `persistedTorrents`, call `enrollSelfContent` for any completed file/torrent not yet in a vault (name + mime taken from `FileTransferInfo`; for torrents without a name, use the manifest label if present, else `manifestId`). Runs on every refresh (cheap — `findVaultEntry` short-circuits).
- Delete the `vault-migration-v1-done` session flag guard; keep `migrateCompletedIntoVaults` as a batch helper but always call it (idempotent). This closes the "ran once with no coin, now stuck" trap.

**3. Coins enforce torrents (background sweep)**

`src/lib/blockchain/vaultSeeder.ts`

- Add `enforceVaultSeeding()`: for every vault entry, check that the underlying chunk/manifest is still marked seeding in `persistedTorrents`/`files`. If not, mark the entry `pending: true` so the UI shows it and the redundancy sweep picks it back up. No new gossip topic.
- Hook a 60 s interval from `main.tsx` alongside `startVaultIngest`.

**4. UI truth**

`src/components/p2p/dashboard/TorrentSwarmPanel.tsx` (`VaultEntryRow` only):

- Show `entry.name || label`.
- If `entry.pending` or `coinId.startsWith('archive:')`, append a small `Archive` badge.
- On the peer row summary, add `Pending: N` next to `Coins Used` / `Media Files` when any entries are pending.
- Empty-state "Mine a SWARM coin" hint stays, but now reads: "…to promote archived entries into a coin-backed vault." Add a `Promote archive` button that calls `promoteArchivedEntries(self, walletCoins)` and refreshes.

### Files touched

- `src/lib/blockchain/syncVault.ts` — role, entry fields, `ensureArchiveCoin`, `promoteArchivedEntries`.
- `src/lib/blockchain/vaultEnroll.ts` — new, self+peer enrol helper.
- `src/lib/blockchain/vaultSeeder.ts` — `enforceVaultSeeding`.
- `src/lib/blockchain/vaultMigration.ts` — drop session-flag reliance, add name/mime pass-through, archive fallback when no coins.
- `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` — call enrol on refresh, VaultEntryRow name+badge, Promote button.
- `src/main.tsx` — schedule `enforceVaultSeeding` after guardrails chain.

### Not touched

Torrent transport, chunk fetch, gossip, DB schema, existing SWARM coin lifecycle, wallet UI, other tabs.

### Acceptance

1. With 267 seeding items and 1 wallet coin, every seeded item shows up in a vault: the first N fit the wallet coin, the rest land in an `Archive` bucket with real names.
2. Mining or freeing another coin + clicking **Promote archive** moves pending entries onto real coins; count of pending drops accordingly.
3. New uploads/downloads that complete after this change appear in the correct peer vault within one refresh, with their real filename and mime.
4. Stopping a torrent flips its vault entry to `pending` within a minute so the redundancy sweep can re-enforce it.
5. Existing tests (`syncVault.test.ts`) still pass; new archive/promote path covered by a small unit test.
