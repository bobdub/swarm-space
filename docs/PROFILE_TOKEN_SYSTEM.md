# Profile Token System

## Overview

The Profile Token System is a user-owned token economy built on the SWARM blockchain, allowing creators to deploy personal tokens that unlock gradually as they contribute to the platform. In the app these are called **Creator Tokens** (Wallet → **Creator** tab). Each token gets its own Creator Vault and market, and creators can charge for walled (paywalled) posts in their token.

---

## Core Features

### 1. Token Deployment

**Deployment Cost:** 25 credits + 5 SWARM at the baseline (`CREATOR_TOKEN_DEPLOY_COST`, `CREATOR_TOKEN_SWARM_DEPLOY_COST` in `src/lib/blockchain/types.ts`). The live price comes from `getDeployPricing()` (`deployPricing.ts`): the baseline applies at a community pool of 100 SWARM or less, and both amounts scale linearly as the pool grows past that.

**Initial Supply:** 4,000 tokens (40% of max, `CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION = 0.4`)  
**Maximum Supply:** 10,000 tokens

**Requirements:**
- Sufficient credits and SWARM for the live deployment price
- Unique ticker symbol (3-5 uppercase letters)
- Token name and optional metadata (description, image)

**Deployment Process:**
```typescript
deployProfileToken({
  userId: string,
  name: string,
  ticker: string,
  description?: string,
  image?: string
})
```

**Contract Address Format:** `swarm://{tokenId}`

**Blockchain Transaction:**
- Type: `profile_token_deploy`
- Fee: the live credit price is deducted, and the SWARM fee is locked into the token's Creator Vault (40 / 40 / 15 / 5 split: buyback, stability, creator, community)
- Initial allocation: `CREATOR_TOKEN_INITIAL_CREATOR_SEED` = 100 tokens minted to the creator's wallet as the vault's first sale

---

### 2. Gradual Supply Unlocking

**Unlock Mechanism** (`src/lib/blockchain/profileTokenUnlock.ts`, `UNLOCK_RATE_VERSION = "2026-07-v2"`):
- 40% of max supply is unlocked at deployment
- The remaining 60% unlocks at 0.1 tokens per credit earned (100 tokens per 1,000 credits)
- Automatic calculation based on credits earned since the unlock baseline
- Maximum cap: 10,000 tokens

**Unlock Formula:**
```typescript
tokensUnlocked = floor((currentCredits - unlockBaseline) × 0.1)
currentSupply = min(supply + tokensUnlocked, maxSupply)
```

**Rate migration:** the first time a token is checked under `2026-07-v2`, its `unlockBaseline` is reset to the current credit balance, so tokens deployed under the older rate start earning from that moment instead of back-filling.

**Credit Earning Opportunities:**
- Post creation: +1 credit
- Comment creation: +0.2 credits (max 2/day)
- Achievement unlocks: +1 credit
- Hosting data: Variable based on bytes hosted

**Tracking System:**
- Records credit balance at deployment time
- Checks credit growth on wallet load (every 5 seconds)
- Updates supply and holdings automatically
- Stores unlock state in `tokenUnlockStates` IndexedDB store

**Progress Visibility:**
```typescript
getTokenUnlockProgress(userId) → {
  currentSupply: number,
  maxSupply: number,
  creditsEarned: number,
  creditsNeededForMax: number,
  percentUnlocked: number
}
```

---

### 3. Token Redeployment & Permanence

**Redeployment Rules:**
- Tokens can be renamed/redeployed ONLY if never used to lock an NFT post
- Once a token is used to lock content, it becomes permanent
- Redeployment charges the current deployment price again
- Supply resets to the initial 4,000 tokens on redeploy
- A permanently closed token cannot be redeployed

**Usage Tracking:**
```typescript
hasProfileTokenBeenUsed(userId, tokenId) → boolean
```

**Permanence Trigger:**
- First NFT post creation with token lock
- Transaction type: `nft_mint` with profileToken meta

**Validation:**
```typescript
// Blocks redeployment if token has been used
if (existing && await hasProfileTokenBeenUsed(userId, tokenId)) {
  throw new Error("Profile token already in use and cannot be redeployed");
}
```

---

### 4. Walled Posts (live) and Legacy NFT Post Locking

**Walled posts (live path):** the post composer at `/create` has a **Lock Post** toggle that puts content behind an encrypted paywall (`src/lib/blockchain/walledPost.ts`):
- Lock: a 5 SWARM processing fee, payable in SWARM, a sub-chain coin (2:1) or a creator token (10:1)
- Unlock: viewers pay the creator-set price in the creator's token
- Extract: the owner extracts payments, after which the post becomes community-unlocked

**Hype:** post hype is credit-based (`hymePost` in `src/lib/credits.ts`): 5 credits by default, 20% burned, the rest paid to the post's author as credits. It does not mint profile tokens.

**Legacy NFT post locking:** the library below (`src/lib/blockchain/nftPost.ts`) still exists, but its `NFTPostCreator` component is not mounted anywhere in the app, so users cannot create these posts today. Kept for reference.

**Lock Mechanism:**
- Users lock 1-100 of their profile tokens into NFT posts
- Locked tokens are burned/removed from circulation
- Creates verifiable scarcity and value

**Post Requirements:**
- Valid profile token ownership
- Sufficient token balance
- Title and content fields
- Optional media attachments


**NFT Post Structure:**
```typescript
{
  type: "nft_post",
  tokenId: string,
  tokensLocked: number (1-100),
  title: string,
  content: string,
  creator: userId,
  contractAddress: string
}
```

---

### 5. Token Holdings & Balance Management

**Holdings Tracking:**
```typescript
ProfileTokenHolding {
  userId: string,
  tokenId: string,
  ticker: string,
  creatorUserId: string,
  amount: number,
  lastUpdated: string
}
```

**Balance Operations:**
- `getUserProfileTokenHoldings(userId)` - Get all holdings
- `getProfileTokenHolding(userId, tokenId)` - Get specific holding
- `addProfileTokens(params)` - Increment holdings

**Wallet Display:**
- Shows all earned profile tokens (from multiple creators)
- Displays token ticker, amount, and creator
- Real-time balance updates

---

## Data Architecture

### IndexedDB Stores

**profileTokens**
- Key: `tokenId`
- Stores deployment metadata, supply, max supply

**profileTokenHoldings**
- Key: `id` (composite: userId + tokenId)
- Tracks user ownership of tokens

**tokenUnlockStates**
- Key: `tokenId`
- Records deployment credit baseline and unlock history

**creditBalances**
- Key: `userId`
- Tracks credits earned, spent, burned

**creditTransactions**
- Key: `id`
- Immutable transaction log

### Blockchain Integration

**SWARM Chain Transactions:**
- `profile_token_deploy` - Token creation
- `token_mint` - Supply increase to holdings
- `nft_mint` - NFT post creation with lock
- `token_transfer` - Movement between users

**Chain Synchronization:**
- All token operations recorded on-chain
- P2P mesh network distribution
- Immutable audit trail

---

## Security & Validation

### Input Validation
- Ticker format: `/^[A-Z]{3,5}$/`
- Amount ranges: 1-100 for legacy NFT locks
- Credit balance checks before operations
- Ownership verification for all actions

### Balance Checks
```typescript
// Deployment (live price from getDeployPricing())
if (balance < pricing.creatorTokenCredits) {
  throw new Error("Insufficient credits");
}
if (swarmBalance < pricing.creatorTokenSwarm) {
  throw new Error("Insufficient SWARM");
}

// NFT Creation
if (holdings.amount < tokensToLock) {
  throw new Error("Insufficient token balance");
}
```

### State Consistency
- Atomic operations with IndexedDB transactions
- Rollback on failure
- Idempotent unlock checks

---

## User Flows

### Creator Flow: Token Deployment
1. Navigate to Wallet → **Creator** tab
2. Click **Deploy Token**
3. Enter name, ticker (3-5 letters) and optional description
4. System validates credits and SWARM against the live price (baseline 25 credits + 5 SWARM)
5. SWARM fee locked into the Creator Vault; credits deducted
6. 4,000 tokens unlocked as supply; 100 tokens added to the creator's holdings
7. Unlock state initialized with current credits

### Creator Flow: Walling a Post
1. Open `/create` and write the post
2. Turn on **Lock Post** and set the unlock price in your creator token
3. Choose the asset that pays the 5 SWARM processing fee
4. Post is locked before broadcast, so peers receive it already walled

### Automatic Unlock Flow
1. User earns credits through platform activity
2. On each unlock check:
   - System calculates credits earned since the unlock baseline
   - Unlocks 0.1 tokens per credit earned
   - Updates supply and holdings
   - Logs unlock event
3. User sees increased supply in wallet

---

## Future Projections

### Phase 1: Enhanced Token Utilities (Q1 2025)
- **Token Staking**: Lock tokens for boosted engagement rewards
- **Governance Rights**: Vote on creator content decisions
- **Gated Content**: Require token holdings to access premium posts
- **Token Tipping**: Direct peer-to-peer token transfers

### Phase 2: Cross-Chain Bridges (Q2 2025)
- **Ethereum Bridge**: ERC-20 wrapped profile tokens
- **Polygon Bridge**: Low-fee L2 transfers
- **BSC Bridge**: Binance Smart Chain compatibility
- **Bridge Architecture**:
  ```typescript
  CrossChainBridge {
    sourceChain: "swarm-space" | "ethereum" | "polygon" | "bsc",
    targetChain: "swarm-space" | "ethereum" | "polygon" | "bsc",
    tokenAddress: string,
    bridgeContract: string,
    lockTx: string,
    mintTx: string,
    status: "pending" | "completed" | "failed"
  }
  ```

### Phase 3: DeFi Integration (Q3 2025)
- **Liquidity Pools**: SWARM/ProfileToken pairs on DEXs
- **Yield Farming**: Earn SWARM by providing liquidity
- **Token Swaps**: Native in-app DEX for profile tokens
- **Price Discovery**: Market-driven token valuation

### Phase 4: Advanced NFT Mechanics (Q4 2025)
- **Fractionalized NFTs**: Split NFT ownership into shares
- **NFT Royalties**: Automatic creator royalties on secondary sales
- **Dynamic NFTs**: Posts that evolve based on engagement
- **NFT Collections**: Bundle multiple NFT posts with bonuses

### Phase 5: Enterprise Features (2026+)
- **Brand Profile Tokens**: Corporate reputation tokens
- **Verified Creator Program**: Blue-check token issuers
- **Institutional Bridges**: Integration with traditional finance
- **Regulatory Compliance**: KYC/AML for high-value transfers

---

## Technical Implementation

### Key Files

**Blockchain Core:**
- `src/lib/blockchain/profileToken.ts` - Deployment and minting
- `src/lib/blockchain/profileTokenBalance.ts` - Holdings tracking
- `src/lib/blockchain/profileTokenUnlock.ts` - Gradual unlock logic
- `src/lib/blockchain/profileTokenUsage.ts` - Usage tracking for permanence
- `src/lib/blockchain/types.ts` - Type definitions

**Credit System:**
- `src/lib/credits.ts` - Credit balance and transactions
- `src/hooks/useCreditBalance.ts` - React hook with auto-unlock

**UI Components:**
- `src/pages/Wallet.tsx` - Profile token dashboard
- `src/components/wallet/NFTPostCreator.tsx` - NFT creation interface
- `src/components/wallet/ProfileTokenHoldings.tsx` - Holdings display

**Storage:**
- `src/lib/store.ts` - IndexedDB schema (v18+)

### Database Version History
- v17: Added `profileTokenHoldings` store
- v18: Added `tokenUnlockStates` store for gradual unlock

---

## Performance Considerations

### Optimization Strategies
- **Lazy Loading**: Holdings fetched only when wallet is opened
- **Debounced Unlock Checks**: 5-second interval prevents spam
- **Indexed Queries**: Fast lookups by userId, tokenId
- **Cached Balances**: In-memory balance cache during session

### Scalability
- **P2P Distribution**: Blockchain distributed across mesh network
- **Local-First**: All reads from IndexedDB (no server calls)
- **Async Operations**: Non-blocking UI updates
- **Batch Processing**: Multiple unlock calculations in single pass

---

## Economic Model

### Token Scarcity Mechanics
1. **Initial Supply**: 4,000 tokens (40%) available at deployment
2. **Earned Scarcity**: The remaining 60% unlocks at 0.1 tokens per credit
3. **Vault Backing**: Deployment fees and sales flow into the Creator Vault (40 / 40 / 15 / 5)
4. **Paywall Demand**: Walled posts are unlocked by paying in the creator's token

### Deflationary Pressure
- 20% of SWARM hype payments burned
- 0.3 SWARM daily burn per user (quantum metrics)
- Profile tokens burned on legacy NFT lock (no UI path today)

### Value Accrual
- Token value tied to creator reputation
- Scarcity increases as tokens locked in popular NFT posts
- Engagement rewards create demand
- Cross-chain bridges enable external liquidity

---

## Developer API

### Deployment
```typescript
import { deployProfileToken } from "@/lib/blockchain/profileToken";

const { token, transaction } = await deployProfileToken({
  userId: "user-123",
  name: "Creator Coin",
  ticker: "CRTR",
  description: "My personal token",
  image: "https://..."
});
```

### Check Usage
```typescript
import { hasProfileTokenBeenUsed } from "@/lib/blockchain/profileTokenUsage";

const isUsed = await hasProfileTokenBeenUsed(userId, tokenId);
```

### Get Unlock Progress
```typescript
import { getTokenUnlockProgress } from "@/lib/blockchain/profileTokenUnlock";

const progress = await getTokenUnlockProgress(userId);
console.log(`${progress.percentUnlocked}% unlocked`);
```

### Create NFT Post
```typescript
import { createNFTPost } from "@/lib/blockchain/nftPost";

const nftPost = await createNFTPost({
  userId: "user-123",
  title: "My First NFT",
  content: "Exclusive content!",
  tokensToLock: 50
});
```

---

## Monitoring & Analytics

### Key Metrics
- Total profile tokens deployed
- Total tokens unlocked across platform
- Total tokens burned in NFT posts
- Average token unlock rate per user
- NFT post creation volume
- Hype engagement rates

### Dashboard Queries
```sql
-- Total deployed tokens
SELECT COUNT(*) FROM profileTokens;

-- Total supply unlocked
SELECT SUM(supply) FROM profileTokens;

-- Top token holders
SELECT userId, SUM(amount) as total 
FROM profileTokenHoldings 
GROUP BY userId 
ORDER BY total DESC 
LIMIT 10;
```

---

## Troubleshooting

### Common Issues

**"Insufficient credits" / "Insufficient SWARM" on deployment**
- Verify the user has the live price (baseline 25 credits + 5 SWARM; scales with the community pool)
- Check `creditBalances` store
- Review transaction history

**"Profile token already in use"**
- Token has been used to lock an NFT post
- Cannot be redeployed
- User must deploy a new token

**Supply not increasing**
- Check `tokenUnlockStates` exists for token
- Verify credits earned since deployment
- Tokens deployed before `2026-07-v2` reset their baseline on first check, so unlocks restart from that point

**Holdings not showing**
- Check `profileTokenHoldings` store
- Verify `addProfileTokens` was called on deployment
- Clear IndexedDB and redeploy token

---

## Conclusion

The Profile Token System creates a self-sustaining creator economy where reputation is tokenized, content is monetized through scarcity, and engagement is rewarded through a native token economy. By gradually unlocking supply based on platform contribution, we ensure that active creators are rewarded while maintaining token value through deflationary burn mechanisms.

The system is designed to scale from individual creators to cross-chain DeFi integration, providing a robust foundation for Web3 social networking and decentralized content monetization.

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-23  
**Status:** Production Ready  
**Chain:** SWARM Blockchain (swarm-space)
