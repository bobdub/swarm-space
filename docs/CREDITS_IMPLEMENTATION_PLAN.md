# Credit System Implementation Plan

**Version**: 1.0  
**Last Updated**: 2025-10-24  
**Status**: Planning Phase  
**Target Phase**: 6.0

---

## 📋 Executive Summary

This document outlines the implementation strategy for the **Imagination Network Credits System** as defined in the [Credits Whitepaper](./Credits-Whitepaper.md). The system implements a quantum-inspired, non-monetary internal economy reflecting verified activity and contribution across the decentralized network.

### Core Components
1. **Node Credits** - Infrastructure reliability rewards
2. **Content Credits** - Creative contribution rewards  
3. **P2P Credit Flow** - Tipping, hyping, and peer transactions
4. **Blockchain Arc Ledger** - Immutable credit transaction history
5. **Credit UI/UX** - User-facing credit interface

---

## 🎯 Whitepaper Evaluation

### ✅ Strengths
- **Clear Economics**: Well-defined earning mechanics with fixed rates
- **Anti-Inflation**: Burn/recycle loops and diminishing returns
- **Dual-Layer Design**: Node + Content credits balance infrastructure and creativity
- **P2P Native**: Direct peer interactions without intermediaries
- **Transparency**: All transactions auditable via Arc Ledger

### ⚠️ Implementation Challenges
1. **Quantum Consensus**: "Q-Consensus" needs practical algorithm definition
2. **Sybil Resistance**: No explicit protection against fake accounts/nodes
3. **Credit Scarcity**: Initial distribution strategy undefined
4. **Verification**: Lightweight proof-of-work for uptime/hosting needs specification
5. **Cross-Session Sync**: Credits must survive page refreshes and device switches

### 🔧 Required Specifications
- **Genesis Credits**: Initial user allocation (suggestion: 100 credits)
- **Uptime Verification**: How to prove 24h uptime without central authority
- **Spam Prevention**: Rate limiting for credit-generating actions
- **Hype Algorithm**: Formula for trending/featured feed ranking
- **Credit Cap**: Optional max balance to prevent hoarding

---

## 🏗️ Architecture Design

### Data Models

```typescript
// Core Credit Types
export interface CreditBalance {
  userId: string;
  nodeCredits: number;      // Infrastructure layer
  contentCredits: number;   // Creation layer
  totalCredits: number;     // Combined balance
  lastUpdated: string;
  meta: {
    createdAt: string;
    lifetimeEarned: number;
    lifetimeSpent: number;
  };
}

export interface CreditTransaction {
  id: string;                           // Unique transaction ID
  type: "earn" | "spend" | "tip" | "hype" | "burn";
  category: "node" | "content" | "p2p";
  fromUserId: string;
  toUserId?: string;                    // For tips/transfers
  amount: number;
  reason: string;                       // "post_created", "24h_uptime", etc.
  metadata?: {
    postId?: string;
    projectId?: string;
    chunkRef?: string;
    bytesHosted?: number;
  };
  timestamp: string;
  arcHash: string;                      // SHA-256 of transaction for Arc Ledger
  prevHash: string;                     // Previous transaction hash (blockchain)
}

export interface ArcLedgerEntry {
  hash: string;                         // Current block hash
  prevHash: string;                     // Previous block hash
  timestamp: string;
  transactions: CreditTransaction[];
  nodeSignatures: {                     // Multi-node verification
    userId: string;
    signature: string;
  }[];
}

export interface CreditRule {
  action: string;                       // "create_post", "24h_uptime", etc.
  category: "node" | "content";
  baseReward: number;
  cooldown?: number;                    // Minimum ms between rewards
  diminishingFactor?: number;           // Multiplicative decrease per action
  maxPerDay?: number;                   // Daily cap
}

export interface HypeRecord {
  postId: string;
  userId: string;                       // Who hyped
  amount: number;                       // Credits spent
  timestamp: string;
  burned: boolean;                      // Credits returned to pool
}
```

### IndexedDB Schema Extensions

```typescript
// New Object Stores
export const CREDIT_STORES = {
  creditBalances: "creditBalances",      // User balances
  creditTransactions: "creditTransactions", // Transaction log
  arcLedger: "arcLedger",                // Blockchain Arc entries
  creditRules: "creditRules",            // Earning rules (seeded)
  hypeRecords: "hypeRecords",            // Post hype tracking
  nodeMetrics: "nodeMetrics",            // Uptime/hosting stats
};

// Indices
// creditTransactions: fromUserId, toUserId, type, timestamp
// hypeRecords: postId, userId, timestamp
// nodeMetrics: userId, lastCheckin
```

### Credit Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Actions Layer                       │
│  (Post, Comment, Host, Uptime, Tip, Hype)                   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Credit Engine (lib/credits/)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Earn Logic  │  │  Spend Logic │  │  Validation  │      │
│  │  (Rules)     │  │  (Tip/Hype)  │  │  (Anti-spam) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Transaction Manager                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Create Tx   │  │  Update Bal  │  │  Emit Event  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Blockchain Arc Ledger                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Hash Chain  │  │  Sync to P2P │  │  Verify Arc  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        IndexedDB                             │
│  creditBalances | creditTransactions | arcLedger             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Implementation Phases

### Phase 6.1: Foundation (1 week)
**Goal**: Core credit data structures and basic earning

#### Tasks
1. **Data Layer**
   - [ ] Extend IndexedDB schema with credit stores
   - [ ] Create migration script for existing users
   - [ ] Implement credit CRUD operations (`lib/store.ts`)

2. **Credit Engine Core**
   - [ ] Create `lib/credits/engine.ts` - Main credit logic
   - [ ] Create `lib/credits/rules.ts` - Earning rules
   - [ ] Create `lib/credits/transactions.ts` - Transaction manager
   - [ ] Seed default credit rules

3. **Basic Earning**
   - [ ] Content Credits: Implement post creation reward (+1)
   - [ ] Content Credits: Implement engagement rewards (+0.05)
   - [ ] Genesis allocation (100 credits on first login)

4. **Balance Display**
   - [ ] Create `components/CreditBalance.tsx` - Display widget
   - [ ] Add credit display to TopNavigationBar
   - [ ] Create credit balance hook (`hooks/useCredits.ts`)

#### Files to Create
```
src/lib/credits/
  ├── engine.ts           # Core credit logic
  ├── rules.ts            # Earning rules and validation
  ├── transactions.ts     # Transaction creation/management
  └── types.ts            # TypeScript types

src/components/
  └── CreditBalance.tsx   # UI component

src/hooks/
  └── useCredits.ts       # React hook

src/types/credits.ts      # Shared type definitions
```

#### Acceptance Criteria
- Users receive 100 genesis credits on first login
- Users earn 1 credit per post
- Users earn 0.05 credits per engagement (comment/reaction)
- Credit balance displays in top nav
- All transactions logged to IndexedDB

---

### Phase 6.2: P2P Credit Flow (1 week)
**Goal**: Enable tipping and hyping between users

#### Tasks
1. **Tipping System**
   - [ ] Create `lib/credits/tipping.ts` - Tip logic
   - [ ] Add tip button to PostCard
   - [ ] Create tip confirmation dialog
   - [ ] Implement credit transfer

2. **Hype System**
   - [ ] Create `lib/credits/hype.ts` - Hype logic
   - [ ] Add hype button to PostCard
   - [ ] Implement hype spend + burn
   - [ ] Update post metadata with hype count

3. **Transaction History**
   - [ ] Create `pages/CreditHistory.tsx` - Transaction log
   - [ ] Add navigation link
   - [ ] Filter by type (earn/spend/tip/hype)
   - [ ] Display detailed transaction info

4. **UI Components**
   - [ ] Create `components/TipModal.tsx`
   - [ ] Create `components/HypeButton.tsx`
   - [ ] Create `components/CreditTransaction.tsx` - Single transaction display

#### Files to Create
```
src/lib/credits/
  ├── tipping.ts          # Tip logic
  └── hype.ts             # Hype/boost logic

src/pages/
  └── CreditHistory.tsx   # Transaction history page

src/components/
  ├── TipModal.tsx        # Tip confirmation dialog
  ├── HypeButton.tsx      # Hype/boost button
  └── CreditTransaction.tsx # Transaction display
```

#### Acceptance Criteria
- Users can tip any amount to post authors
- Users can hype posts with credits (min 1, max 100)
- Hyped credits are burned (removed from circulation)
- All P2P transactions logged and auditable
- Transaction history page displays all activity

---

### Phase 6.3: Node Credits (1-2 weeks)
**Goal**: Reward infrastructure contribution (hosting, uptime)

#### Tasks
1. **Node Metrics Tracking**
   - [ ] Create `lib/credits/nodeMetrics.ts`
   - [ ] Track bytes hosted (chunk storage)
   - [ ] Implement uptime heartbeat (24h)
   - [ ] Calculate hosting rewards (+1 per 100MB)

2. **Uptime Verification**
   - [ ] Create proof-of-uptime protocol
   - [ ] Implement heartbeat via BroadcastChannel
   - [ ] Award +1 credit per 24h uptime
   - [ ] Prevent gaming via timestamp validation

3. **P2P Hosting Rewards**
   - [ ] Track successful chunk transfers
   - [ ] Award credits for serving chunks to peers
   - [ ] Implement reliability bonus for sustained hosting

4. **Node Dashboard**
   - [ ] Create `pages/NodeDashboard.tsx`
   - [ ] Display hosting stats (MB hosted, uptime)
   - [ ] Show node credit earnings
   - [ ] Add reliability score

#### Files to Create
```
src/lib/credits/
  └── nodeMetrics.ts      # Node tracking and rewards

src/pages/
  └── NodeDashboard.tsx   # Node stats and earnings
```

#### Challenges
- **Uptime Verification**: No central authority to verify 24h uptime
  - **Solution**: Use localStorage timestamps + P2P peer attestation
  - **Limitation**: Self-reported initially, enhanced with P2P Phase 5.2
- **Hosting Verification**: Must prove chunks served to peers
  - **Solution**: Peer-signed receipts via WebRTC data channel
  - **Limitation**: Requires trust between peers initially

#### Acceptance Criteria
- Users earn +1 credit per 100MB hosted locally
- Users earn +1 credit per 24h of verified uptime
- Node credits tracked separately from content credits
- Node dashboard displays hosting stats and earnings

---

### Phase 6.4: Blockchain Arc Ledger (1-2 weeks)
**Goal**: Immutable transaction history with lightweight verification

#### Tasks
1. **Arc Chain Implementation**
   - [ ] Create `lib/credits/arcLedger.ts`
   - [ ] Implement SHA-256 hash chaining
   - [ ] Link transactions into blocks
   - [ ] Genesis block creation

2. **Verification System**
   - [ ] Implement hash validation
   - [ ] Verify chain integrity
   - [ ] Detect tampering attempts
   - [ ] Repair broken chains (re-sync from peers)

3. **P2P Sync Integration**
   - [ ] Broadcast new Arc blocks via signaling
   - [ ] Request missing blocks from peers
   - [ ] Merge Arc chains from multiple peers
   - [ ] Resolve conflicts (longest chain wins)

4. **Arc Explorer UI**
   - [ ] Create `pages/ArcExplorer.tsx`
   - [ ] Display Arc chain blocks
   - [ ] Show transaction hash verification
   - [ ] Visualize chain integrity

#### Files to Create
```
src/lib/credits/
  ├── arcLedger.ts        # Blockchain Arc implementation
  └── arcSync.ts          # P2P Arc synchronization

src/pages/
  └── ArcExplorer.tsx     # Arc Ledger explorer UI
```

#### Arc Ledger Specification
```typescript
// Lightweight blockchain for credit transactions
interface ArcBlock {
  height: number;                   // Block number (sequential)
  hash: string;                     // SHA-256(prevHash + timestamp + txData)
  prevHash: string;                 // Previous block hash
  timestamp: string;                // ISO 8601 timestamp
  transactions: CreditTransaction[];
  merkleRoot: string;               // Hash of all transactions
}

// Genesis block (height 0)
const GENESIS_BLOCK: ArcBlock = {
  height: 0,
  hash: "0000000000000000000000000000000000000000000000000000000000000000",
  prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
  timestamp: "2025-10-24T00:00:00.000Z",
  transactions: [],
  merkleRoot: "0000000000000000000000000000000000000000000000000000000000000000",
};
```

#### Acceptance Criteria
- All credit transactions hashed into Arc blocks
- Hash chain validated on load
- Tampering detected and reported
- Arc blocks synced via P2P
- Arc Explorer displays full transaction history

---

### Phase 6.5: Advanced Features (2-3 weeks)
**Goal**: Trending algorithm, reputation, anti-gaming

#### Tasks
1. **Trending Algorithm**
   - [ ] Create `lib/credits/trending.ts`
   - [ ] Implement hype-weighted ranking
   - [ ] Time decay for trending posts
   - [ ] Featured feed based on credits
   - [ ] Update Explore page with trending

2. **Reputation System**
   - [ ] Calculate user reputation score
   - [ ] Factor: credits earned, spent, tipped received
   - [ ] Display reputation badge/level
   - [ ] Create `components/ReputationBadge.tsx`

3. **Anti-Gaming Measures**
   - [ ] Implement rate limiting (cooldowns)
   - [ ] Diminishing returns on repetitive actions
   - [ ] Detect spam patterns
   - [ ] Sybil resistance (future: Proof-of-Personhood)

4. **Credit Analytics**
   - [ ] Create `pages/CreditAnalytics.tsx`
   - [ ] Display earning trends (chart)
   - [ ] Show spending breakdown
   - [ ] Network-wide credit statistics

#### Files to Create
```
src/lib/credits/
  ├── trending.ts         # Trending algorithm
  ├── reputation.ts       # Reputation calculation
  └── antiSpam.ts         # Anti-gaming logic

src/components/
  └── ReputationBadge.tsx # User reputation display

src/pages/
  └── CreditAnalytics.tsx # Credit analytics dashboard
```

#### Trending Algorithm Specification
```typescript
// Hype-weighted trending score
function calculateTrendingScore(post: Post, hype: HypeRecord[]): number {
  const now = Date.now();
  const postAge = now - new Date(post.createdAt).getTime();
  const ageHours = postAge / (1000 * 60 * 60);
  
  // Base score from hype credits
  const hypeScore = hype.reduce((sum, h) => sum + h.amount, 0);
  
  // Time decay (half-life = 24 hours)
  const decayFactor = Math.pow(0.5, ageHours / 24);
  
  // Engagement multiplier
  const engagementBoost = 1 + (post.commentCount || 0) * 0.1 + (post.reactions?.length || 0) * 0.05;
  
  return hypeScore * decayFactor * engagementBoost;
}
```

#### Acceptance Criteria
- Trending feed shows hype-weighted posts
- Reputation badges display on profiles
- Rate limiting prevents spam
- Credit analytics show earning/spending trends

---

## 🔐 Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Fake Credits** | Arc Ledger hash validation, P2P verification |
| **Sybil Attacks** | Rate limiting, diminishing returns, future PoP |
| **Self-Tipping** | Allow but make visible, reputation impact |
| **Uptime Fraud** | P2P peer attestation, heartbeat validation |
| **Arc Tampering** | SHA-256 chaining, multi-peer verification |
| **Credit Inflation** | Fixed reward rates, burn mechanisms, caps |

### Data Integrity
- **Local Storage**: Credits stored in IndexedDB (tamper-prone)
- **Arc Ledger**: Immutable hash chain (detects tampering)
- **P2P Verification**: Peers validate each other's credit claims
- **Future**: Cryptographic signatures for high-value transactions

### Privacy
- **Public**: Transaction amounts, types, timestamps
- **Private**: User IDs pseudonymous (no real names)
- **Zero-Knowledge**: No central authority sees credit data

---

## 🧪 Testing Strategy

### Unit Tests
- [ ] Credit earning logic
- [ ] Transaction validation
- [ ] Balance updates
- [ ] Hash chain integrity
- [ ] Trending algorithm
- [ ] Anti-spam rate limiting

### Integration Tests
- [ ] End-to-end credit flow (earn → spend → verify)
- [ ] P2P tip transfer
- [ ] Hype and burn cycle
- [ ] Arc block creation and sync

### Manual Test Scenarios

#### Scenario 1: Genesis and Earning
1. Create new account → Verify 100 genesis credits
2. Create 3 posts → Verify 3 content credits earned
3. React to 10 posts → Verify 0.5 credits earned
4. Check credit history → Verify all transactions logged

#### Scenario 2: Tipping
1. Open Post A by User B
2. Tip 10 credits → Confirm modal
3. Verify User A balance decreased by 10
4. Verify User B balance increased by 10
5. Check both credit histories for transaction

#### Scenario 3: Hyping
1. Hype Post A with 20 credits
2. Verify credits deducted from balance
3. Verify post shows +20 hype count
4. Verify credits burned (not transferred to author)
5. Check trending feed for Post A

#### Scenario 4: Node Rewards
1. Enable P2P hosting
2. Wait 24 hours (or simulate)
3. Verify +1 uptime credit
4. Host 150MB of chunks
5. Verify +1 hosting credit (100MB threshold)

#### Scenario 5: Arc Integrity
1. Create 20 transactions
2. Verify Arc chain builds correctly
3. Manually corrupt a hash in IndexedDB
4. Reload page → Verify tampering detected
5. Re-sync from peer → Verify chain restored

---

## 📊 Success Metrics

### Phase 6.1 Success
- ✅ All users receive genesis credits
- ✅ Post creation rewards working
- ✅ Credit balance displays correctly
- ✅ Zero transaction errors

### Phase 6.2 Success
- ✅ Tipping functional with zero failures
- ✅ Hype burns credits as expected
- ✅ Transaction history accurate
- ✅ 90%+ user satisfaction with P2P credit flow

### Phase 6.3 Success
- ✅ Node credits reward hosting and uptime
- ✅ Hosting metrics accurate to ±5%
- ✅ Node dashboard displays live stats

### Phase 6.4 Success
- ✅ Arc Ledger maintains 100% integrity
- ✅ Tampering detected in all test cases
- ✅ P2P sync resolves conflicts correctly

### Phase 6.5 Success
- ✅ Trending algorithm matches hype activity
- ✅ Reputation system reflects user contribution
- ✅ Anti-spam prevents abuse
- ✅ Credit analytics provide actionable insights

### Overall Phase 6 Success
- 🎯 1000+ active users engaging with credits
- 🎯 10,000+ credit transactions processed
- 🎯 Zero critical bugs in production
- 🎯 Positive community feedback on credit economy

---

## 🚀 Deployment Plan

### Phase 6.1 Launch
- Deploy to staging
- Beta test with 10 users for 1 week
- Monitor IndexedDB performance
- Fix critical bugs
- Deploy to production

### Phase 6.2-6.5 Rollout
- Incremental feature releases
- Feature flags for gradual rollout
- Monitor credit economy balance
- Adjust reward rates if needed
- Community feedback loops

---

## 🔮 Future Enhancements (Post-Phase 6)

### Smart Credit Contracts
- Automate peer collaborations
- Escrow for project payments
- Royalty distribution for shared projects

### Cross-Network Credits
- Interoperability with other Imagination Networks
- Credit bridges between domains
- Federated credit reputation

### Advanced Reputation
- Visual reputation graphs
- Trust chains between users
- Reputation staking for verification

### Credit Governance
- Community voting on reward rates
- Proposal system for economy changes
- Decentralized credit rule adjustments

---

## 📝 Open Questions

1. **Genesis Distribution**: Should early adopters receive bonus credits?
2. **Credit Cap**: Max balance to prevent hoarding? (Suggested: 10,000)
3. **Burn Rate**: Is hype burn 100% or partial return to author?
4. **Uptime Proof**: Can we implement secure proof-of-uptime without central server?
5. **Sybil Resistance**: Future Proof-of-Personhood integration (BrightID, Worldcoin)?
6. **Credit Decay**: Should unused credits decay over time to encourage circulation?
7. **Creator Royalties**: Should original post creator receive % of tips to commenters?

---

## 📚 References

- [Credits Whitepaper](./Credits-Whitepaper.md)
- [Wireframe Overview](./WIREFRAME_OVERVIEW.md)
- [Phase 5 P2P Architecture](./WIREFRAME_OVERVIEW.md#phase-5-p2p-networking-foundation)
- [NEXT_STEPS.md](./NEXT_STEPS.md)

---

**Next Action**: Review and approve this plan, then begin Phase 6.1 implementation.
