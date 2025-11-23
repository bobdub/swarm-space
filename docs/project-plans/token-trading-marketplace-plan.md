# Profile Token Trading Marketplace Plan

## Overview
Create a decentralized trading space where users can buy, sell, and trade profile tokens with each other, establishing a dynamic market for personal tokens.

## Core Features

### 1. Trading Interface
- **Order Book System**
  - Bid/Ask spread display
  - Market depth visualization
  - Order history and tracking
  - Real-time price updates via P2P sync

- **Order Types**
  - Market orders (instant execution at best price)
  - Limit orders (execute at specific price)
  - Stop-loss orders (automatic sell at threshold)
  - Cancel/modify pending orders

### 2. Token Listings
- **Token Discovery**
  - Browse all available profile tokens
  - Filter by: creator, price, volume, market cap
  - Search by ticker or creator name
  - Featured/trending tokens section

- **Token Details Page**
  - Price chart (24h, 7d, 30d, All time)
  - Trading volume and liquidity
  - Holder distribution
  - Creator profile and verification
  - Recent trades feed
  - Token utility description

### 3. Wallet Integration
- **Portfolio Management**
  - Multi-token balance display
  - Total portfolio value (in SWARM)
  - Holdings breakdown by token
  - P&L tracking (profit/loss)
  - Transaction history

- **Trading Controls**
  - Quick buy/sell buttons
  - Batch trading (multiple tokens)
  - Portfolio rebalancing tools

### 4. Price Discovery & Liquidity
- **Automated Market Maker (AMM)**
  - Bonding curve pricing for new tokens
  - Initial liquidity pools
  - Slippage protection
  - Price impact warnings

- **Liquidity Pools**
  - Users can provide liquidity for trading pairs
  - Earn fees from trades (0.3% per trade)
  - LP token representation
  - Impermanent loss tracking

### 5. Trading Mechanics
- **Fee Structure**
  - 0.3% trading fee on all transactions
  - 50% to liquidity providers
  - 25% burned (deflationary)
  - 25% to token creator

- **Settlement**
  - Instant settlement via IndexedDB
  - P2P transaction broadcasting
  - Blockchain transaction recording
  - Dispute resolution system

## Technical Architecture

### Data Models

```typescript
interface TradeOrder {
  id: string;
  userId: string;
  tokenId: string;
  ticker: string;
  type: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop-loss';
  amount: number;
  pricePerToken?: number; // undefined for market orders
  totalValue: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled';
  createdAt: string;
  filledAt?: string;
  filledAmount: number;
}

interface TokenPriceHistory {
  tokenId: string;
  ticker: string;
  timestamp: string;
  price: number;
  volume: number;
  marketCap: number;
}

interface LiquidityPool {
  id: string;
  tokenId: string;
  ticker: string;
  swarmReserve: number; // SWARM tokens in pool
  tokenReserve: number; // Profile tokens in pool
  totalLPTokens: number;
  providers: LiquidityProvider[];
}

interface LiquidityProvider {
  userId: string;
  lpTokens: number;
  swarmProvided: number;
  tokensProvided: number;
  addedAt: string;
}
```

### IndexedDB Stores
- `tradeOrders` - Active and historical orders
- `tokenPriceHistory` - Price tracking
- `liquidityPools` - AMM pool data
- `trades` - Executed trade history

### P2P Distribution
- Broadcast order placements to mesh
- Sync price updates across nodes
- Distributed order book
- Trade execution confirmation

### Pricing Algorithm (Bonding Curve)
```javascript
// Simple bonding curve: price increases with supply
function calculatePrice(currentSupply, tokensInPool) {
  const k = swarmReserve * tokenReserve; // Constant product
  const newTokenReserve = tokenReserve - amountToBuy;
  const newSwarmReserve = k / newTokenReserve;
  const swarmRequired = newSwarmReserve - swarmReserve;
  return swarmRequired / amountToBuy; // Price per token
}
```

## User Experience

### Trading Flow
1. **Browse Tokens** → Discover available tokens
2. **Token Details** → View charts, stats, creator
3. **Place Order** → Choose order type and amount
4. **Confirmation** → Review fees and impact
5. **Execution** → Order filled via orderbook or AMM
6. **Receipt** → Transaction recorded on blockchain

### Portfolio View
- Clean dashboard showing all holdings
- Pie chart of portfolio allocation
- P&L indicators (green/red)
- Quick trade actions

### Notifications
- Order filled alerts
- Price alerts (token reached target)
- New token listings
- Liquidity pool returns

## Security Considerations

### Anti-Manipulation
- Rate limiting on order placement
- Minimum order sizes
- Max slippage protection
- Front-running prevention (no public mempool)

### Dispute Resolution
- Trade escrow for large orders
- Multi-sig for liquidity pools
- Community arbitration system
- Automatic refunds for failed trades

### Validation
- Balance checks before order placement
- Double-spend prevention
- Order signature verification
- Liquidity reserve validation

## Future Enhancements

### Phase 2
- **Margin Trading** - Trade with leverage
- **Futures Contracts** - Token derivatives
- **Options Trading** - Call/put options
- **Staking Pools** - Lock tokens for yield

### Phase 3
- **Mobile Trading App** - Native mobile experience
- **Trading Bots** - Automated trading strategies
- **Social Trading** - Follow successful traders
- **Token Baskets** - Trade portfolios as single unit

### Phase 4
- **Cross-Chain DEX** - Trade tokens across blockchains
- **DAO Governance** - Community-controlled exchange
- **Yield Farming** - Incentivized liquidity provision
- **NFT Fractional Trading** - Trade portions of NFTs

## Success Metrics
- Daily trading volume
- Number of active trading pairs
- Liquidity pool depth
- User acquisition and retention
- Average trade size
- Price stability

## Development Timeline
- **Week 1-2**: Order book and basic trading UI
- **Week 3-4**: AMM implementation and liquidity pools
- **Week 5-6**: Price charts and analytics
- **Week 7-8**: Testing, security audit, launch
