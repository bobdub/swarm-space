---
name: Profile User Markets
description: Per-profile Creator Token marketplace with 40/40/15/5 vault split and Buyback Ladder tiers.
type: feature
---
Every profile has a **Market** tab (sixth tab). Deploying a Creator Token now costs `1,000 credits + 50 SWARM` (SWARM routed to community pool). Deployment initializes a `CreatorVault` (`creatorVaults` IndexedDB store, DB v23).

**Vault split per purchase:** 40% Buyback Reserve (liquid) / 40% Stability Floor (protected, never spent) / 15% Creator Earnings (withdrawable) / 5% Community Pool (forwarded).

**Pricing:** deterministic bonding curve `price = 0.1 + 0.001 * circulatingSupply` SWARM; integrated closed-form for buys.

**Buyback Ladder:** 5 tiers derived from `buybackReserve / totalDeposited` ratio (0.05/0.15/0.25/0.35/0.45 thresholds → 10/25/45/70/90% reserve unlocks). Hard floor: reserve never drops below 5% of totalDeposited.

**Files:** `src/lib/blockchain/creatorVault.ts`, `src/components/profile/CreatorMarketTab.tsx`, new tx types `creator_token_buy|sell|earnings_withdraw`.