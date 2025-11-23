# NFT Marketplace Plan

## Overview
Build a comprehensive marketplace for trading NFT posts, images, achievements, and other digital collectibles locked with profile tokens.

## Core Features

### 1. NFT Discovery & Browsing
- **Gallery View**
  - Grid layout with thumbnail previews
  - Infinite scroll or pagination
  - Filter by: type, creator, price range, rarity
  - Sort by: newest, price, popularity, rarity

- **NFT Types Supported**
  - NFT Posts (text + profile token locked)
  - NFT Images (locked profile token images)
  - Achievement NFTs (wrapped badges)
  - Custom NFTs (future: videos, audio, 3D models)

- **Search & Filters**
  - Full-text search on titles/descriptions
  - Creator username search
  - Tag-based filtering
  - Price range slider
  - Token type filter (which profile token used)

### 2. NFT Detail Page
- **Visual Display**
  - High-resolution image/content preview
  - Locked content indicator (for unlockable NFTs)
  - Ownership badge
  - Verification checkmark (creator verification)

- **Metadata**
  - Title and description
  - Creator profile link
  - Creation date
  - Token contract address
  - Locked profile tokens count
  - Rarity score
  - View count and engagement metrics

- **Ownership History**
  - Previous owners list
  - Sale price history chart
  - Transaction timestamps
  - Blockchain transaction links

- **Unlocked Users**
  - List of users who unlocked this NFT
  - Community engagement stats

### 3. Buying & Selling

#### Listing NFTs for Sale
- **Create Listing**
  - Set fixed price or auction
  - Duration for auction listings
  - Reserve price for auctions
  - Bundle multiple NFTs together
  - Add tags and categories

- **Listing Management**
  - Edit price or duration
  - Cancel listing (with penalty fee)
  - Relist expired items
  - Bulk listing tools

#### Purchasing NFTs
- **Purchase Flow**
  1. View NFT details
  2. Click "Buy Now" or "Place Bid"
  3. Confirm payment (SWARM or profile tokens)
  4. Instant ownership transfer
  5. Download/unlock content (if applicable)

- **Payment Options**
  - SWARM tokens (native currency)
  - Profile tokens (specific to creator)
  - Mixed payment (SWARM + tokens)

#### Auction System
- **English Auction**
  - Ascending price bidding
  - Auto-extend on last-minute bids
  - Bid history visible
  - Minimum bid increment

- **Dutch Auction**
  - Descending price over time
  - First buyer wins at current price
  - Time-based price decay

### 4. Unlockable Content
- **Token-Gated Access**
  - Requires holding specific profile tokens
  - Multiple unlock tiers (10, 50, 100 tokens)
  - Permanent unlock (tokens burned)
  - Temporary unlock (tokens held, not burned)

- **Content Types**
  - High-res images
  - Exclusive posts/stories
  - Downloadable files
  - Private community access
  - Behind-the-scenes content

### 5. Creator Tools

#### Minting Dashboard
- **Bulk Minting**
  - Upload multiple NFTs at once
  - CSV import for metadata
  - Batch set pricing

- **Collection Management**
  - Create NFT collections (series)
  - Set collection metadata
  - Limited edition sets
  - Generative art tools

#### Analytics
- **Sales Dashboard**
  - Total sales volume
  - Revenue breakdown
  - Best-selling NFTs
  - Buyer demographics

- **Engagement Metrics**
  - Views and favorites
  - Unlock rates
  - Share and comment counts
  - Time-on-page analytics

#### Royalties
- **Secondary Sales**
  - Set royalty percentage (0-10%)
  - Automatic royalty distribution
  - Lifetime earnings tracking
  - Royalty withdrawal to wallet

### 6. Social Features

#### Community Engagement
- **Favorites & Collections**
  - Like/favorite NFTs
  - Create custom collections
  - Share collections publicly

- **Comments & Reviews**
  - Comment on NFT pages
  - Rate NFTs (5-star system)
  - Report inappropriate content

#### Creator Profiles
- **Public Profile**
  - Creator bio and links
  - All created NFTs gallery
  - Sales statistics
  - Follower count
  - Verification badge

- **Following System**
  - Follow favorite creators
  - Get notified of new drops
  - Creator feed/timeline

### 7. Notifications & Alerts
- **Real-time Updates**
  - NFT sold/purchased
  - Auction outbid alert
  - New listing from followed creator
  - Price drop on watchlist items

- **Email Digests**
  - Daily/weekly marketplace summary
  - Trending NFTs
  - Portfolio value updates

## Technical Architecture

### Data Models

```typescript
interface NFTListing {
  id: string;
  nftId: string; // Reference to NFTMetadata
  sellerId: string;
  listingType: 'fixed' | 'auction';
  price?: number; // Fixed price in SWARM
  startingBid?: number; // Auction starting bid
  currentBid?: number;
  reservePrice?: number;
  paymentTokens: {
    swarm?: number;
    profileToken?: { tokenId: string; amount: number };
  };
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt?: string;
  bids?: AuctionBid[];
}

interface AuctionBid {
  id: string;
  listingId: string;
  bidderId: string;
  amount: number;
  timestamp: string;
  status: 'active' | 'outbid' | 'won' | 'cancelled';
}

interface NFTSale {
  id: string;
  nftId: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  price: number;
  paymentMethod: 'swarm' | 'profile-token' | 'mixed';
  royaltyAmount: number;
  royaltyRecipient: string;
  timestamp: string;
  transactionId: string; // Blockchain tx
}

interface CreatorRoyalty {
  creatorId: string;
  nftId: string;
  percentage: number; // 0-10%
  totalEarned: number;
  lastPaymentAt?: string;
}
```

### IndexedDB Stores
- `nftListings` - Active marketplace listings
- `nftSales` - Historical sales data
- `auctionBids` - Auction bid history
- `creatorRoyalties` - Royalty tracking
- `nftFavorites` - User favorites/watchlist

### P2P Sync
- Broadcast new listings to mesh
- Sync auction bids in real-time
- Distribute sale events
- Update NFT ownership across network

### Search Index
- Full-text search using Lunr.js
- Index title, description, tags, creator
- Real-time index updates
- Fuzzy search support

## Smart Contract Features

### NFT Contract (Future)
```javascript
interface INFTContract {
  // Minting
  mint(metadata: NFTMetadata, royalty: number): Promise<string>;
  
  // Transfer
  transfer(nftId: string, to: address): Promise<void>;
  
  // Royalties
  setRoyalty(nftId: string, percentage: number): Promise<void>;
  
  // Marketplace
  createListing(nftId: string, price: number): Promise<string>;
  cancelListing(listingId: string): Promise<void>;
  buy(listingId: string): Promise<void>;
  
  // Auctions
  startAuction(nftId: string, startBid: number, duration: number): Promise<string>;
  placeBid(auctionId: string, amount: number): Promise<void>;
  endAuction(auctionId: string): Promise<void>;
}
```

## Security Considerations

### Fraud Prevention
- NFT ownership verification before sale
- Balance check before listing
- Duplicate listing prevention
- Front-running protection

### Content Moderation
- DMCA takedown process
- User reporting system
- Automated content scanning
- Creator verification process

### Payment Security
- Escrow for auction funds
- Atomic swaps (simultaneous transfer)
- Refund mechanism for disputes
- Multi-sig for high-value sales

## User Experience

### Responsive Design
- Mobile-optimized browsing
- Touch-friendly auction bidding
- Progressive web app (PWA)
- Offline mode for owned NFTs

### Accessibility
- Screen reader support
- Keyboard navigation
- Alt text for all images
- High contrast mode

### Performance
- Lazy load images
- Virtual scrolling for large galleries
- Image compression and CDN
- Optimistic UI updates

## Monetization

### Platform Fees
- 2.5% fee on all sales
- Listing fee for premium placement
- Verified creator badge ($10/month)
- Featured listings ($5 per day)

### Fee Distribution
- 1.5% to platform treasury
- 0.5% burned (deflationary)
- 0.5% to liquidity pools

## Future Enhancements

### Phase 2
- **Fractional Ownership** - Own portions of expensive NFTs
- **Renting System** - Rent NFTs for temporary use
- **NFT Loans** - Use NFTs as collateral
- **Collaborative NFTs** - Multiple creators, shared royalties

### Phase 3
- **Virtual Galleries** - 3D exhibition spaces
- **AR/VR Integration** - View NFTs in AR
- **Physical Merchandise** - Print NFTs on physical items
- **Cross-Platform Integration** - Display on other platforms

### Phase 4
- **AI Generation Tools** - Create NFTs with AI
- **Generative Collections** - Algorithmic NFT creation
- **Music & Video NFTs** - Support for media files
- **Live Minting Events** - Real-time drop events

## Success Metrics
- Monthly sales volume
- Number of active listings
- Average sale price
- Creator retention rate
- Buyer satisfaction score
- Platform fee revenue

## Development Timeline
- **Week 1-2**: Core marketplace UI (browse, search, view)
- **Week 3-4**: Listing and fixed-price sales
- **Week 5-6**: Auction system implementation
- **Week 7-8**: Creator dashboard and analytics
- **Week 9-10**: Royalty system and secondary sales
- **Week 11-12**: Testing, audit, beta launch
