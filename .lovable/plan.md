# Profile User Markets — Creator Token Marketplace

Adds a **Market** tab to every profile that opens the creator's personal token storefront, backed by a Creator Vault with a 40/40/15/5 allocation and a Buyback Ladder.

## 1. Deployment change (Token Launcher)

Update the existing Creator Token deployment flow (single token per profile, already deployed via `deployProfileToken`) with a new dual cost:

- **Fee:** 50 SWARM (new) + existing credit deployment cost (currently 1,000 credits — configurable).
- Both are checked and deducted atomically before token creation.
- On failure of either, roll back and surface the shortfall clearly.
- Constant: `CREATOR_TOKEN_SWARM_DEPLOY_COST = 50` in `src/lib/blockchain/types.ts`.

No changes to token identity, ticker rules, or single-token-per-profile constraint.

## 2. Creator Vault

Each Creator Token gets one vault, created at deployment. New IndexedDB store `creatorVaults` keyed by `tokenId`:

```
{ tokenId, creatorUserId,
  buybackReserve, stabilityFloor, creatorEarnings, communityContributed,
  totalDeposited, lifetimeBuybacks, currentTier, updatedAt }
```

Every purchase deposits into the vault and is **split automatically**:

| Bucket | Share |
|---|---|
| Buyback Reserve (liquid circulation) | 40% |
| Stability Floor (protected liquidity) | 40% |
| Creator Earnings (withdrawable) | 15% |
| Community Pool (routes to existing SWARM Community Pool) | 5% |

Guardrails: totals reconcile to 100% ± 1 base unit; splits done in integer base units to avoid drift; every split is a `SwarmTransaction` for auditability.

## 3. Pricing & purchases

- Purchase currencies accepted: SWARM and any SWARM-deployed coin (uses existing `coinSpend`).
- Creator Tokens are **not** spendable as currency — buy-only, plus optional sell-back via the Buyback Ladder.
- **Price formula (bonding curve, deterministic):**
  `price = basePrice + k * circulatingSupply`, with `basePrice = 0.1 SWARM`, `k = 0.001` (both configurable). Circulating supply = tokens ever purchased − tokens sold back.
- Purchase pipeline:
  1. Compute integrated cost across `n` tokens (closed-form sum).
  2. Debit buyer wallet in chosen currency (converted to SWARM base units for accounting via existing conversion helpers).
  3. Credit tokens to buyer via `addProfileTokens`.
  4. Split deposit 40/40/15/5 into vault buckets.
  5. Recompute `currentTier` (see Buyback Ladder).
  6. Emit `creator_token_buy` transaction.

## 4. Buyback Ladder

Only the **Buyback Reserve** bucket funds buybacks. Ladder has 5 tiers, each unlocking a share of the reserve:

| Tier | Unlocked share of reserve | Meaning |
|---|---|---|
| T1 | 10% | Baseline support |
| T2 | 25% | Rising confidence |
| T3 | 45% | Strong support |
| T4 | 70% | High confidence |
| T5 | 90% | Maximum support (never 100%) |

- Active tier is derived from vault size vs. lifetime deposits: `currentTier = highest tier whose threshold ≤ buybackReserve / max(totalDeposited, ε)`.
- Sell-back price = `min(currentBondingPrice, buybackReserve * tierShare / offeredTokens)`.
- A single sell can never draw more than the current tier's unlocked share, and reserve can never be fully drained (hard floor: `buybackReserve >= 5% of totalDeposited`).

## 5. Stability Floor

The second 40% bucket is **protected** — never spent by buyback logic, only displayed. It backs long-term confidence and shows on the market page as "Stability Floor".

## 6. Creator Earnings

15% flows to `creatorEarnings`. Creator can withdraw to their SWARM wallet from the Market page; withdrawal emits `creator_token_earnings_withdraw` and decrements the bucket. No lock-up beyond existing platform rules.

## 7. Community Pool

5% routes into the existing SWARM Community Pool via the current pool deposit helper. Vault records `communityContributed` for display only.

## 8. Profile Market tab

Add sixth tab `market` to `src/pages/Profile.tsx` tab list, after Files. New component `src/components/profile/CreatorMarketTab.tsx` renders:

- Header: token name, ticker, image, creator description (from token metadata).
- Stats grid: current price, total supply, circulating supply, vault balance, current buyback tier, stability floor, creator earnings, community contributed.
- **Buy** panel (currency selector: SWARM / user's coins; amount input; live cost preview).
- **Sell** panel (visible when tier ≥ T1 and user holds tokens; shows current buyback quote).
- Buyback ladder visualization (5-step progress bar with active tier highlighted, share % labeled).
- Recent transactions list (last 20 vault txs).
- Holder statistics (top 10 holders by amount, total holder count).
- Empty state when creator has not deployed a token — CTA to Token Launcher for own profile; friendly notice for visitors.

## 9. Files touched

- `src/lib/blockchain/types.ts` — add SWARM deploy cost, vault types, tx types.
- `src/lib/blockchain/profileToken.ts` — dual-cost deployment, vault init.
- `src/lib/blockchain/creatorVault.ts` (new) — vault storage, split, buy/sell, tier, withdraw.
- `src/lib/blockchain/storage.ts` + `src/lib/store.ts` — new `creatorVaults` store (DB version bump, non-destructive per project rules).
- `src/components/profile/CreatorMarketTab.tsx` (new) — market UI.
- `src/components/profile/CreatorBuybackLadder.tsx` (new) — ladder viz.
- `src/pages/Profile.tsx` — new tab + content.
- `src/components/wallet/CoinDeploymentPanel.tsx` (or profile token deployment UI) — surface new 50 SWARM cost.

## 10. Verification

- Unit tests for split math (40/40/15/5 reconciliation to integer base units) and tier thresholds.
- Buy → sell round-trip test: reserve never drains below 5% floor; stability floor untouched.
- Playwright: visit another user's profile, open Market tab, confirm stats render and Buy panel validates balance.
- `bun run build` clean.

## Technical notes

- All state is offline-first in IndexedDB; vault mutations broadcast through existing blockchain recorder so P2P peers converge.
- Uses existing `coinSpend`, `addProfileTokens`, `getSwarmChain`, and community pool helpers — no new external dependencies.
- Follows project rules: `<div role="form">`/`<button type="button">`, no destructive DB upgrades, no new AudioContexts, no CAPTCHA.
