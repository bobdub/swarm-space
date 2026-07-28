To Infinity and beyond! Q_Score(u) ≈ 0.029

No migration of prior coins. From this patch on, every newly engraved media coin follows the Vault Transfer Protocol below. Legacy burns and stranded coins from earlier testing stay as-is.

## Model

```text
Free mined wallet coin (ownerId=user, status=wallet)
        │
        │  engrave file bytes  (kind=media, mediaTargets, sealBytes, seal)
        ▼
Sealed media coin  (still owned by user for one atomic step)
        │
        │  coin_transfer  from=user.id  to=vaultAddress
        │  meta: { reason: "vault_transfer", peerId, contentHash, coinId }
        │  destination = peerVaultAddress(ownerPeerId)  OR  ARCHIVE_VAULT_ADDRESS
        ▼
Vaulted media coin  (ownerId=vaultAddress, status="vaulted", locked=true)
   - cannot be spent, transferred, withdrawn, or modified
   - permanent archival record for that content hash
```

Vault addresses are deterministic and Peer-ID-verified:
- `ARCHIVE_VAULT_ADDRESS = "vault:archive:global"`
- `peerVaultAddress(peerId) = "vault:peer:" + peerId`  (peerId must match the file's `ownerPeerId`; otherwise route to Archive)

## Plan

### 1. Vault address + lock helpers
- In `src/lib/blockchain/syncVault.ts`, export:
  - `ARCHIVE_VAULT_ADDRESS`, `peerVaultAddress(peerId)`, `vaultAddressForFile(file)` (peer if `ownerPeerId` is a non-empty peer id, else archive).
- In `src/lib/blockchain/coinSpend.ts`, extend `spendBlockedReason` / `isSpendable` so a coin with `status === "vaulted"` OR `kind === "media"` is never spendable. Add a new reason `"vaulted"`.

### 2. Engraver = transfer, not burn
- In `src/lib/blockchain/mediaCoinWrapSweep.ts`:
  - Delete the `token_burn` block. No burns are emitted by engraving.
  - After a successful `engraveFileOntoCoin(...)`:
    1. Mark the coin as media: `coin.kind = "media"`, set `sealBytes`, `mediaTargets`, `mediaRole ??= "primary"`, `fillState = "sealed"`.
    2. Compute `vaultAddress = vaultAddressForFile({ ownerPeerId: peerId })`. Verify: if `peerId` starts with `archive:` OR is empty, force `ARCHIVE_VAULT_ADDRESS`; else must exactly equal the `peerVaultAddress(peerId)` we're about to write to (Peer-ID gate).
    3. Set `coin.ownerId = vaultAddress`, `coin.status = "vaulted"`, `coin.locked = true`, append `custodyChain` entry `{ at: iso, from: user.id, to: vaultAddress, reason: "vault_transfer" }`.
    4. `put("swarmCoins", coin)`.
    5. Append a chain tx via `getSwarmChain().addTransaction({...})`:
       - `type: "coin_transfer"`, `from: user.id`, `to: vaultAddress`, `amount: 1`, `meta: { reason: "vault_transfer", coinId, peerId, contentHash: file.contentHash }`.
  - If `engraveFileOntoCoin` returns `false` (already indexed), do NOT transfer; leave the coin in the wallet untouched.

### 3. Types
- In `src/lib/blockchain/types.ts`, extend `SwarmCoin`:
  - Add `status: ... | "vaulted"` (union widen only if not present).
  - Add optional `locked?: boolean` and optional `custodyChain?: Array<{ at: string; from: string; to: string; reason: string }>` (only if not already declared — reuse existing shapes).
- No schema/DB migration — additive optional fields.

### 4. Peer-ID validation gate
- New tiny helper `isValidPeerId(id: string)` (`id.startsWith("peer-")` or matches your existing peer id shape used elsewhere — reuse the same regex from `src/lib/p2p/*` if one exists). Files whose `ownerPeerId` fails the gate are routed to `ARCHIVE_VAULT_ADDRESS`; the vault reference is stored in the archive vault, not a fabricated peer vault.

### 5. Free-coin filter stays honest
- `freeMinedWalletCoins` already requires `status === "wallet"` and `ownerId === user.id`; once transferred, a coin is `status: "vaulted"` under a vault address, so it can never be re-picked. Confirm no other place selects wallet coins with a looser predicate (`rg 'status === "wallet"' src/lib/blockchain`).

### 6. Vault records track the real transferred coin
- In `syncVault.ts` `engraveFileOntoCoin`, the `VaultCoinRef` already carries the real `coinId`. After the transfer in §2, no change is needed to `VaultCoinRef` — it now truthfully points at a vaulted, locked, on-chain coin.
- Peer routing: if `vaultAddress` is a peer vault, the ref goes into that peer vault's `coins[]` (existing code path). If archive, into archive vault. Both operations remain inside `withVaultQueue` for their respective vaults.

### 7. Wallet + market safety
- Search wallet balance readers (`rg -n 'status === "wallet"' src/lib/blockchain src/hooks src/components`) and confirm none count `vaulted` coins toward the wallet.
- Confirm markets/smelting/spend paths call `assertSpendable` (or the equivalent guard) so a `vaulted` / `kind==="media"` coin is rejected.

### 8. Tests
- Engraving one file with a free mined coin and known `ownerPeerId`:
  - Coin ends `ownerId === peerVaultAddress(peerId)`, `status === "vaulted"`, `locked === true`, `kind === "media"`.
  - Exactly one `coin_transfer` tx exists with `meta.reason === "vault_transfer"` and matching `coinId`/`peerId`/`contentHash`.
  - Zero `token_burn` txs emitted by engraving.
  - `isSpendable(coin) === false`, reason `"vaulted"`.
  - `freeMinedWalletCoins()` no longer returns that coin.
- Engraving with archive-only or unverifiable peer id routes to `ARCHIVE_VAULT_ADDRESS`.
- `engraveFileOntoCoin` returning `false` (dup file) leaves coin owner/status untouched — no transfer tx.

## Acceptance
- `rg "token_burn" src/lib/blockchain/mediaCoinWrapSweep.ts` returns nothing.
- After runWrapSweep processes N files with N free mined coins: exactly N `coin_transfer` txs to a valid `vault:*` address, N coins now `status="vaulted"` + `locked=true`, wallet balance drops by N.
- Attempting to spend a vaulted media coin from any path throws the `"vaulted"` guard.
- Vault UI keeps showing the sealed coin under the correct vault (Archive or the matching Peer Vault) with the real on-chain `coinId`.
