## Diagnosis (verified by reading the code)

Creator Token markets live in three local IndexedDB stores: `profileTokens`, `creatorVaults`, `profileTokenHoldings`. Nothing on the live mesh replicates them.

- `src/lib/blockchain/p2pSync.ts` **does** implement market replication (`request_profile_tokens` / `send_profile_tokens`, replicating tokens, vaults and holdings).
- That class (`BlockchainP2PSync`) is only constructed inside `src/lib/p2p/transports/hybridOrchestrator.ts`, and `HybridOrchestrator` is **never instantiated anywhere in `src/`** — only the feature-flag name appears elsewhere. So that entire market-sync path is dead code today.
- The live mesh, `src/lib/p2p/swarmMesh.standalone.ts`, only exchanges `chain-sync-request` / `chain-sync-response` (raw blocks) and `blockchain-tx` notices. Its `handleChainSyncResponse` just calls `chain.addTransaction(tx)` — it never calls `applyMarketTransaction`, and no code rebuilds a `profileTokens` / `creatorVaults` record from a `profile_token_deploy` transaction.

Net effect: the owner sees their market because it was written locally at deploy time; peers have neither the store records nor any derivation path, so the Market tab renders empty for them.

## Fix

**1. Add a market-sync channel to the live mesh** (`swarmMesh.standalone.ts`)

- New message types `market-sync-request` and `market-sync-response`, registered in the existing `switch (msg.type)` router alongside `chain-sync-request`.
- Send `market-sync-request` on each successful peer handshake (right next to the existing `chain-sync-request` send), plus on a low-frequency interval reusing the current interval block.
- `handleMarketSyncRequest`: read all `profileTokens`, `creatorVaults`, `profileTokenHoldings` and reply to that one peer.
- `handleMarketSyncResponse`: merge with an "own-record-wins" rule — never overwrite a token/vault whose `userId` is the local identity; for remote records adopt when missing or when the incoming record is newer (`deployedAt` / vault `totalDeposited`+`updatedAt`). Then dispatch `creator-token-updated` and `creator-vault-update` window events so open tabs refresh.
- Payloads are chunk-friendly: strip `banner`/`image` data URLs above a size threshold from the sync payload so large base64 images don't blow the data channel; peers fetch the visual later via the existing token record update on next sync. (Alternative if preferred: keep images and cap the batch size per message.)

**2. Make the chain itself a fallback source of truth**

- In `handleChainSyncResponse`, after adding transactions, run `applyMarketTransaction(tx)` (already exists in `coinMarket.ts`) for market-type txs.
- Add a `rebuildMarketsFromChain()` helper that scans the chain for `profile_token_deploy` transactions and, when no local `profileTokens` record exists for that `userId`, reconstructs the token (name/ticker/supply are all present in `tx.meta`) plus an empty vault. Run it after chain adoption. This guarantees markets appear even if a peer misses a market-sync message.

**3. Push on change instead of waiting for a poll**

- On `deployProfileToken` and on `updateCreatorTokenBanner`, broadcast a `market-sync-response` for that single token so connected peers see the market immediately.

**4. Verification (done before reporting success)**

- Drive two browser contexts against the preview with Playwright: context A deploys/owns a market; context B opens `/profile?tab=market` for A's profile and must render the token header, price and Buy control.
- Confirm via console that `market-sync-response` was received and that `profileTokens` in B's IndexedDB contains A's record.
- Second pass: clear B's market stores, force only a chain sync, and confirm `rebuildMarketsFromChain()` alone restores the visible market.
- Run `tsgo` and the existing vitest suite.

## Notes

- `HybridOrchestrator` / `p2pSync.ts` stay untouched — no attempt to revive that unused transport in this change.
- No changes to pricing, vault split, or trading logic; this is replication only.
