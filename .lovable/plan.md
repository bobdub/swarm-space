Plan: Local Storage Hardening, Token Recovery, and Security Audit

Goal: recover the lost test creator token if any local or P2P copy remains; make local storage resilient so users never lose tokens or coins; block asset transfers when storage is too full; and run a security + UQRC audit alongside the Infinity logic chain.

Resolved context from questions:
- The lost token is a creator token, no peers are online right now, and it may have synced with another user previously.
- Storage threshold: 85% warning / 90% hard block.

Current state confirmed from reads:
- Account backup (`src/lib/auth.ts`) exports only identity keys + user meta, not blockchain/token state.
- Archive fallback (`src/lib/storage/providers/archiveFallback.ts`) exports only manifests/chunks.
- Profile tokens, vaults, and holdings live in separate IndexedDB stores (`profileTokens`, `creatorVaults`, `profileTokenHoldings`) and are not currently replicated by the blockchain P2P sync, which only syncs blocks and the reward pool.
- The chain does store `profile_token_deploy` transactions with token metadata, so a lost token record can be reconstructed if the chain survives.
- `StorageHealthIndicator.tsx` already reads quota but does not block operations.

---

Phase 1 — Token Recovery (read-only / reconstructive)

1. Inspect local storage for surviving copies:
   - Search `localStorage` for the chain dirty snapshot key `__swarm_chain_snapshot`.
   - Open `imagination-db` and inspect stores `blockchain`, `profileTokens`, `creatorVaults`, `profileTokenHoldings`, `tokenUnlockStates` for the creator token record.
   - Record the user's `userId` and any token ticker/name from the UI or backup.

2. Reconstruct from the chain if the store record is missing:
   - Scan `blockchain` transactions for `type: "profile_token_deploy"` matching the user's `userId` or known ticker.
   - If found, re-create the `profileTokens` entry with `id = userId` and the deployment metadata.
   - Re-create `creatorVaults` for that token and seed `profileTokenHoldings` with the creator's 100-token seed, mirroring the legacy migration already in `profileToken.ts`.
   - Re-create `tokenUnlockStates` with the current credit baseline under the new 0.1 tokens/credit rate.

3. If no local copy exists, check last-known P2P peers:
   - On next app launch with an active peer, trigger a manual blockchain sync and a new store-level sync request for `profileTokens`/`creatorVaults`.
   - This is the Phase-1 fallback; it is not guaranteed if no peers are ever online again.

4. Deliver recovery result in the UI:
   - If reconstructed: show a toast "Creator token restored from local chain snapshot".
   - If not reconstructable: show a clear message and point to the new full-data backup feature implemented in Phase 2.

---

Phase 2 — Local Storage Stability & Security

1. Build a full-data backup/export module:
   - Add `src/lib/backup/exportFullState.ts` that exports the chain, profile tokens, vaults, holdings, token balances, coin listings, reward pool, and user identity into a single encrypted/downloadable bundle.
   - Add `src/lib/backup/importFullState.ts` to restore it with conflict resolution (newer wins, never overwrite `_origin: local` content).
   - Add a "Backup Wallet & Tokens" button in Settings → Security/Recovery, and an auto-prompt after creator token deployment.

2. Harden the chain dirty snapshot:
   - In `src/lib/blockchain/chain.ts`, extend `__swarm_chain_snapshot` to include `profileTokens`, `creatorVaults`, `profileTokenHoldings`, and `tokenBalances` so a browser crash can recover the full token state, not just blocks.
   - Keep the snapshot under a size limit; if it exceeds ~4 MB, warn the user to export instead.

3. Extend P2P replication to include token state:
   - In `src/lib/blockchain/p2pSync.ts`, add new sync actions: `request_profile_tokens`, `send_profile_tokens`, `request_creator_vaults`, `send_creator_vaults`.
   - When a peer receives a chain with a `profile_token_deploy` transaction that it does not have locally, it will request the matching token/vault records from the broadcasting peer.
   - This prevents the "chain has the transaction but the app has no token" failure mode.

4. Add storage health gating:
   - Create `src/lib/storage/quotaGuard.ts` exporting:
     - `getStorageHealth()`: returns percent, quota, and available bytes.
     - `assertStorageWritable(threshold = 90)` throws `StorageFullError` if quota is above threshold.
   - Wire the guard into all state-mutating asset paths:
     - `transferSwarm`, `mintSwarm`, `burnSwarm` in `src/lib/blockchain/token.ts`.
     - `buyCreatorTokens`, `sellCreatorTokens`, `redeemAtFloor`, `withdrawCreatorEarnings`, `closeCreatorMarket` in `src/lib/blockchain/creatorVault.ts`.
     - `createParticipantListing`, `buyParticipantListing`, `cancelParticipantListing` in `src/lib/blockchain/participantListings.ts`.
     - `createCoinListing`, `acceptCoinListing`, `cancelCoinListing` in `src/lib/blockchain/coinMarket.ts`.
   - On `StorageFullError`, return a user-facing message: "Local storage is too full to safely record this transaction. Export or withdraw assets to MetaMask before continuing."

5. UI warning surfaces:
   - Update `StorageHealthIndicator.tsx` to show the 85% warning persistently and the 90% critical state with a CTA to Settings → Backup.
   - Add a global `StorageFullBanner` rendered at the top level when storage >= 90%, blocking all wallet/token action buttons until the user frees space or exports.

---

Phase 3 — Security & UQRC Audit

1. Basic security scan:
   - Run `security--get_scan_results` with `force=true` and `security--run_security_scan` to refresh findings.
   - Review any new findings in `supply_chain`, `supabase_lov`, `app_mcp`, and `connector_security_scan`.
   - Apply fixes only for findings that are actionable; document any that are not applicable.

2. UQRC / Infinity logic chain audit:
   - Run `node scripts/uqrc-check.mjs --strict` to identify contradictions against Core memory rules.
   - Apply the Infinity Protocol 7-step reasoning chain to each finding:
     - Trace the flow of asset mutations.
     - Identify stress points (storage writes, chain persistence, P2P replication).
     - Map hidden dependencies (e.g., `profileToken.ts` depends on `creatorVault.ts` but neither replicates token state).
     - Enumerate failure modes (browser crash, quota exceeded, peer offline).
     - Score curvature and fix the highest-stress paths first.
   - Update `src/lib/uqrc/baseline.json` with the new top-stress snapshot if the scan is clean.

3. Memory update:
   - If new security guidance is discovered, update the security memory via `security--update_memory` and inform the user.
   - If a new Core constraint is warranted (e.g., "All asset transfers must pass storage-quota guard"), add it to `.lovable/memory/index.md`.

---

Success criteria

- The lost creator token is either restored from local chain data or a clear reason is given why it cannot be restored.
- All asset-transfer functions reject writes when storage usage >= 90% with a helpful message.
- The app offers a full-state backup/export that includes tokens, vaults, and chain.
- P2P blockchain sync requests and replicates token/vault records, not just blocks.
- `security--run_security_scan` and `node scripts/uqrc-check.mjs --strict` both pass with no new unhandled findings.

---

Technical note

This plan does not change the creator-token economy rules or pricing. It only improves the durability, discoverability, and quota safety of the data already produced by those rules.