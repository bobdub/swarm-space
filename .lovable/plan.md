

## Walled Posts — Encrypted Paywall via Literal Wrap

### What We're Building

A "post lock" system where creators can paywall content behind an encrypted wall. The post's viewable content (media manifests, text) is wrapped inside a SWARM coin, and viewers must pay the creator's token price to unlock it. All payments flow through the Literal Wrap protocol — coins carry real tokens inside them.

### How It Works (User Flow)

1. **Locking**: In the PostComposer, a new "Lock Post" toggle appears. When enabled, the user sets an unlock price in their Creator Token (e.g., 15 $ALICE). The system charges 5 SWARM coins as the processing fee.
2. **Processing fee swap**: If the user pays with a non-SWARM coin or token, the system auto-swaps to SWARM at ratio via the community pool, following mineHealth protocols.
3. **Content wrapping**: 1 of the 5 SWARM coins receives the post's encrypted metadata (manifest IDs, decryption hints) as a wrapped payload. The other 4 go to the community pool.
4. **Serving**: The content-carrying coin serves a locked placeholder to the network — custom locked avatar + unlock button. The post is always visible to the coin owner (the creator).
5. **Unlocking**: Any user can unlock by paying the token price (in any coin/token at ratio). Their payment tokens are wrapped into the serving coin.
6. **Coin full / capacity exceeded**: If the serving coin can't hold more payment metadata, it moves to the owner's wallet with an "extraction needed" flag and stops serving content.
7. **Extraction**: Owner extracts all payment tokens into their SWARM wallet. The post gets a "community unlocked" icon. The empty coin returns to the community pool.

### Changes

#### 1. New types — `src/lib/blockchain/types.ts`
- Add `WalledPostLock` interface: `{ postId, coinId, unlockCostTokenId, unlockCostTicker, unlockCostAmount, lockedManifestIds, lockedContentHash, createdAt, creatorId, extractionNeeded }`
- Add `"post_lock"`, `"post_unlock"`, `"post_extract_payments"` to `TransactionType`
- Add constants: `WALLED_POST_SWARM_FEE = 5`, `WALLED_POST_CONTENT_COIN_COUNT = 1`, `WALLED_POST_POOL_COINS = 4`

#### 2. New module — `src/lib/blockchain/walledPost.ts`
Core functions:

- **`lockPost(userId, postId, unlockCostTokenId, unlockCostTicker, unlockCostAmount, paymentCoinOrToken?)`**
  1. Validate mineHealth (must be mining)
  2. If payment is non-SWARM, auto-swap to 5 SWARM via community pool at ratio + mineHealth
  3. Deduct 5 SWARM coins from pool (surplus check: pool needs 5+1)
  4. Take 1 coin — wrap post metadata (manifestIds, content hash, decryption pointers) into it as a `WrappedTokenPayload`-style entry with type `"content_lock"`
  5. Send remaining 4 coins to community pool
  6. Update the Post record with `walled: true, wallCoinId, unlockCost` fields
  7. Record `post_lock` transaction on chain

- **`unlockPost(userId, postId, paymentTokenId, paymentTicker, paymentAmount)`**
  1. Validate mineHealth
  2. Verify payment amount matches unlock cost (at ratio if different token)
  3. Check serving coin capacity — can it hold the payment metadata?
  4. If yes: wrap payment tokens into the serving coin, grant user access (add to `unlockedBy[]` list on the post)
  5. If no (coin full): move coin to owner's wallet, set `extractionNeeded: true`, stop serving content
  6. Record `post_unlock` transaction

- **`extractWalledPostPayments(userId, coinId)`**
  1. Verify user owns the coin and it has `extractionNeeded` or manual extraction
  2. Extract all payment tokens to user's SWARM wallet (reuse `extractTokensFromCoin` logic)
  3. Mark post as "community unlocked" (free to view, unlocked icon)
  4. Return empty coin to community pool
  5. Record `post_extract_payments` transaction

- **`canViewWalledPost(userId, postId)`** — returns true if user is creator or in `unlockedBy[]`

#### 3. Update Post type — `src/types/index.ts`
Add optional fields to `Post`:
```
walled?: boolean;
wallCoinId?: string;
unlockCostTokenId?: string;
unlockCostTicker?: string;
unlockCostAmount?: number;
unlockedBy?: string[];
walledCommunityUnlocked?: boolean;
```

#### 4. Update PostComposer — `src/components/PostComposer.tsx`
- Add a "Lock Post" toggle (similar to NSFW toggle) with an expandable section
- When enabled: show a token selector (user's Creator Token or any held token) and amount input for unlock price
- On publish: call `lockPost()` before/after storing the post, gated by mineHealth
- Show the 5 SWARM processing fee clearly

#### 5. Update PostCard — `src/components/PostCard.tsx`
- If `post.walled && !canView`: render a locked overlay with custom lock icon, blurred/hidden content, and an "Unlock" button showing the cost
- If `post.walled && canView`: render normally with a small "Walled" badge
- If `post.walledCommunityUnlocked`: show a "Community Unlocked" icon
- If `extractionNeeded`: show owner-only "Extract Payments" button
- Unlock button triggers `unlockPost()` with a payment modal

#### 6. New component — `src/components/WalledPostUnlockModal.tsx`
- Modal showing unlock cost, user's available tokens/coins, ratio conversion if paying with different asset
- Confirm button calls `unlockPost()`
- Shows mineHealth status (must be mining to unlock)

#### 7. Update IndexedDB — `src/lib/store.ts`
- Add `walledPosts` object store for `WalledPostLock` records
- Bump `DB_VERSION` to 22

#### 8. Update Whitepaper — `src/pages/Whitepaper.tsx`
- Add "Walled Posts — Encrypted Content Paywall" section documenting: lock flow, coin capacity lifecycle, extraction, and community unlock

### Technical Details

```text
LOCK FLOW:
  Creator locks post (unlock = 20 $ALICE tokens)
  ├─ mineHealth ✓
  ├─ 5 SWARM coins deducted from pool (needs 6 in pool)
  ├─ Coin #1 ← wraps post metadata (manifestIds, decrypt keys)
  ├─ Coins #2-#5 → community pool
  └─ Post marked: walled=true, wallCoinId=Coin#1

UNLOCK FLOW:
  Viewer pays 20 $ALICE to unlock
  ├─ mineHealth ✓
  ├─ Check Coin#1 capacity (weight + 20 + 5 overhead ≤ 100?)
  ├─ YES → wrap 20 $ALICE into Coin#1, add viewer to unlockedBy[]
  └─ NO  → Coin#1 → owner wallet (extractionNeeded), content stops serving

EXTRACTION:
  Owner extracts Coin#1
  ├─ All wrapped payments → owner's token holdings
  ├─ Post → walledCommunityUnlocked=true (free for all)
  └─ Empty Coin#1 → community pool
```

