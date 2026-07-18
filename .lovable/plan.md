
To Infinity and beyond! Q_Score(u) ≈ 0.044.

## 1. Fix community pool desync (mesh consensus)

**Root cause (verified in `src/lib/blockchain/p2pSync.ts:257-268`):** the merge takes `Math.max()` of `balance`, `totalContributed`, and per-contributor amounts. That ratchets every peer to the highest number any peer ever saw — the opposite of consensus.

**Fix — event-sourced pool derived from the SWARM ledger:**
- Add `derivePoolFromChain()` in `src/lib/blockchain/storage.ts` that folds all pool-affecting txs (`pool_donate`, `coin_deploy` 5k share, mining tax, credit wraps, walled-post fees, creator vault 5% share) into `RewardPoolData`.
- Rewrite the `reward_pool_update` handler: derived value is authoritative; incoming snapshots are only a cache warm-up. Ledger already syncs via existing chain sync.
- Add `lastSyncedAt` + `lastTxHeight` to `RewardPoolData`.

**Offline UX:** new `usePoolConnectivity()` hook → `{ pool, lastSyncedAt, isLive }` where `isLive = P2P connected AND lastSyncedAt < 60s`. When `!isLive`, wallet + deploy dialogs show cached number with "Last synced 3m ago · offline" badge and disable pool-mutating actions (deploy token/coin, wrap credits, buy from vault, walled-post lock, list on Coin Market).

## 2. Dynamic deploy pricing tied to pool

Replace fixed deploy constants with a curve on `pool.balance`. Baseline at pool = 100 SWARM = **100 credits + 50 SWARM** (matches the target).

```
creditCost(pool)   = 100    * max(1, pool.balance / 100)
swarmCost(pool)    = 50     * max(1, pool.balance / 100)
coinDeployCost(pool) = 10_000 * max(1, pool.balance / 10_000)
```

- New `src/lib/blockchain/deployPricing.ts` exports `getDeployPricing()`.
- `coinDeployment.ts`, `profileToken.ts`, `creatorVault.ts` read prices from it.
- Live display on Wallet deploy dialogs and `CreatorMarketTab`.
- Existing tokens grandfathered (already handled by prior lazy migration).

## 3. Wallet tab reorder + mobile cleanup

`src/pages/Wallet.tsx` — new order: **Ledger, Credits, NFTs, Mining, Swap, Creator, Coins, Market**.
- `< md`: `TabsList` becomes `grid grid-cols-4 gap-1 h-auto` (two rows of 4).
- `md+`: horizontal flex as today.

## 4. Coin Market — LIVE peer-to-peer sales of mined SWARM coins

This is the core deliverable: a working live market where miners list SWARM coins and other users buy them for ETH / BTC / MintMe. Listings and settlement flow through the SWARM mesh in real time.

### 4a. Data model (`src/lib/blockchain/coinMarket.ts`, new)
- `CoinListing { listingId, sellerId, coinId, askAmount, askCurrency: "ETH"|"BTC"|"MINTME", receivingAddress, memo?, status: "open"|"reserved"|"paid"|"settled"|"cancelled"|"disputed", buyerId?, tier, createdAt, updatedAt }`.
- IndexedDB store `coinListings` (bump `DB_VERSION`).
- Tier gate on **synced pool balance** (mirrors Buyback Ladder): unlocks max coins per seller listed simultaneously — 1 / 5 / 25 / 100 / unlimited at pool ≥ 100 / 500 / 2 500 / 10 000 / 25 000 SWARM.

### 4b. Live sync (this is what makes it "live")
- New tx types in `types.ts`: `coin_market_list | coin_market_reserve | coin_market_confirm_payment | coin_market_settle | coin_market_cancel | coin_market_dispute`.
- Each action is a signed SWARM transaction — so every peer's market state is reconstructed from the ledger the same way the pool is (§1). No custom mesh channel needed.
- On `coin_market_list` the coin's owner flips to a `market_escrow:<listingId>` pseudo-owner so it cannot be double-sold or spent while listed. `settle` transfers to buyer; `cancel` returns to seller.
- Real-time UI: subscribe to chain-tx events (already wired via `blockchain-transaction` `CustomEvent`) and rerender listings; no polling.
- Presence: piggyback on existing peer presence to show a green "seller online" dot beside each listing.

### 4c. Sale flow (V1 — no key custody)
1. **Seller** picks mined coin(s), currency, amount, receiving address → `coin_market_list` broadcast.
2. **Buyer** sees open listings, clicks "Reserve" → `coin_market_reserve` (10-minute TTL; auto-expires back to open).
3. Buyer pays out-of-band to the receiving address, clicks "I paid" with tx hash / memo → `coin_market_confirm_payment`.
4. **Seller** verifies receipt (block explorer link auto-generated per currency), clicks "Release" → `coin_market_settle` transfers the SWARM coin on-chain.
5. Either side may `cancel` before payment; after payment only seller can settle or buyer can `dispute` (dispute just flags; no arbitrator in V1).

### 4d. Security (non-negotiable, first release)
- App never sees, stores, or transmits private keys or seed phrases. Full stop.
- Address validation per currency (ETH `0x[40 hex]`, BTC `bech32|legacy` regex, MintMe ETH-format). Invalid → cannot list.
- Rate-limit + PoW gate on listing creation (per `bot-protection-policy` memory) — 1 listing per 60 s per identity, PoW difficulty scales with pool size.
- Bright unmissable disclaimer at list time and reserve time: **"Off-chain settlement is trust-based until MetaMask lands. Verify payment on a block explorer before releasing."**
- All actions require the identity's chain signature — no anonymous listings; scam sellers become blockable via existing granular block permissions.
- Listings expire after 30 days automatically (auto-`cancel` tx by the seller's own client if online, else pruned locally by any peer past expiry).
- Reservation TTL prevents griefing (buyer parking a listing forever).
- **Offline safety:** listings mutate ledger, so `!isLive` disables list / reserve / confirm / settle; browsing existing listings still works with a "read-only, last synced X ago" banner.

### 4e. UI (`src/components/wallet/CoinMarketTab.tsx`, new)
- Panels: **Open Market** (filter by currency, sort by price/age/tier) · **My Listings** · **My Purchases**.
- "List a Coin" dialog: coin picker (only unwrapped mined coins), currency, amount, address, memo.
- Listing card: currency badge, price, seller identity + trust/presence dot, tier, block-explorer link when a payment tx hash is attached.
- Action buttons state-machine mapped to listing.status.
- MetaMask stub: `src/lib/blockchain/wallets/metaMaskBridge.ts` exports `isMetaMaskAvailable()`; button "Connect wallet (soon)" wired but disabled — Phase 2 lands automated escrow.

## 5. MetaMask deposit (scaffold only)

Not implemented this pass. Stub file + disabled "Connect wallet (soon)" button on the Market tab so the follow-up plan drops in cleanly with automated ETH escrow.

## Files touched

- `src/lib/blockchain/p2pSync.ts` — derive-from-chain merge.
- `src/lib/blockchain/storage.ts` — `derivePoolFromChain`, `lastSyncedAt`, `coinListings` store.
- `src/lib/blockchain/deployPricing.ts` — new.
- `src/lib/blockchain/coinDeployment.ts`, `profileToken.ts`, `creatorVault.ts` — dynamic pricing.
- `src/lib/blockchain/types.ts` — new tx types, `CoinListing`, tier constants.
- `src/lib/blockchain/coinMarket.ts` — new (list / reserve / confirm / settle / cancel / dispute).
- `src/lib/blockchain/wallets/metaMaskBridge.ts` — stub.
- `src/hooks/usePoolConnectivity.ts` — new.
- `src/pages/Wallet.tsx` — tab order + mobile grid + mount `CoinMarketTab` + `isLive` gates.
- `src/components/wallet/CoinMarketTab.tsx` — new.
- Deploy dialog (existing) — dynamic pricing display + offline disable.

## Out of scope (explicit)

- Automated crypto custody / on-chain escrow (Phase 2, MetaMask).
- CashApp / Stripe (already "coming soon" on Donate).
- Arbitration / staff dispute resolution beyond flagging.
- Any change to mining reward math or vault split.
