# Profile Token System

## Overview

The Profile Token System is a user-owned token economy built on the SWARM blockchain, allowing creators to deploy personal tokens that unlock gradually as they contribute to the platform. These tokens serve as a reputation and reward mechanism that can be locked into NFT posts, creating a unique content monetization model.

---

## Core Features

### 1. Token Deployment

**Deployment Cost:** 100 SWARM credits

**Initial Supply:** 1,000 tokens  
**Maximum Supply:** 10,000 tokens

**Requirements:**
- Sufficient credit balance (100 credits minimum)
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
- Fee: 100 SWARM
- Initial allocation: 1,000 tokens to creator's wallet

---

### 2. Gradual Supply Unlocking

**Unlock Mechanism:**
- 10 tokens unlocked per 1 credit earned
- Automatic calculation based on credits earned since deployment
- Maximum cap: 10,000 tokens

**Unlock Formula:**
```typescript
tokensUnlocked = creditsEarnedSinceDeployment × 10
currentSupply = min(initialSupply + tokensUnlocked, maxSupply)
```

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
- Redeployment does NOT incur additional deployment fee
- Supply resets to initial 1,000 tokens on redeploy

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

### 4. NFT Post Creation with Token Locking

**Lock Mechanism:**
- Users lock 1-100 of their profile tokens into NFT posts
- Locked tokens are burned/removed from circulation
- Creates verifiable scarcity and value

**Post Requirements:**
- Valid profile token ownership
- Sufficient token balance
- Title and content fields
- Optional media attachments

**Reward System:**
- When users "hype" an NFT post: +1 profile token reward to hyper
- Hype cost: 5 SWARM credits (20% burned)
- Creates engagement loop between creators and supporters

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
- Amount ranges: 1-100 for NFT locks
- Credit balance checks before operations
- Ownership verification for all actions

### Balance Checks
```typescript
// Deployment
if (balance < PROFILE_TOKEN_DEPLOYMENT_COST) {
  throw new Error("Insufficient credits");
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
1. Navigate to Wallet → Profile Token tab
2. Click "Deploy Profile Token"
3. Enter name, ticker, description, image
4. System validates 100 credit balance
5. Transaction broadcast to blockchain
6. 1,000 tokens added to creator's holdings
7. Unlock state initialized with current credits

### Creator Flow: Creating NFT Posts
1. Verify profile token deployment and balance
2. Navigate to NFT Post Creator
3. Enter title, content, tokens to lock (1-100)
4. System validates token ownership
5. NFT minted on blockchain
6. Tokens burned from creator's supply
7. Post visible in feeds and profile

### User Flow: Earning Profile Tokens
1. User "hypes" NFT post (costs 5 credits)
2. System rewards +1 profile token to user
3. Token added to user's holdings
4. User can now create their own NFT posts with earned tokens

### Automatic Unlock Flow
1. User earns credits through platform activity
2. On wallet load (every 5 seconds):
   - System calculates credits earned since deployment
   - Unlocks 10 tokens per credit earned
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
1. **Initial Scarcity**: Only 1,000 tokens available at deployment
2. **Earned Scarcity**: Unlock gated by platform contribution
3. **Burn Mechanism**: NFT post locks permanently reduce supply
4. **Hype Rewards**: New token distribution through engagement

### Deflationary Pressure
- 20% of SWARM hype payments burned
- 0.3 SWARM daily burn per user (quantum metrics)
- Profile tokens burned on NFT lock (not recoverable)

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

**"Insufficient credits" on deployment**
- Verify user has 100+ credits
- Check `creditBalances` store
- Review transaction history

**"Profile token already in use"**
- Token has been used to lock an NFT post
- Cannot be redeployed
- User must deploy a new token

**Supply not increasing**
- Check `tokenUnlockStates` exists for token
- Verify credits earned since deployment
- Ensure wallet is being refreshed (5s interval)

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
