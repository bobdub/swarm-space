To Infinity and beyond! Q_Score(u) ≈ 0.047.

Plan: repair the Community Pool, Creator deployment pricing, and Wallet Market flow without expanding scope.

Confirmed current state from code
- Community pool derivation exists, but peer pool snapshots are ignored when both peers have the same block height, even if the peer has newer pending pool transactions. That explains “each user only sees local deposits” while pending mesh holdings do not converge.
- `blockchain-transaction` is currently a local browser event; the P2P sync class has `broadcastNewTransaction()`, but the orchestrator is not wired to forward local blockchain transactions to peers.
- Market listings are stored in local IndexedDB (`coinListings`) and market actions are only recorded as transactions; incoming market transactions are not reconstructing/upserting the local listing store.
- Creator token deployment uses `getDeployPricing()`, but the visible Wallet Creator UI only loads pricing during wallet refresh and falls back to stale constants if pricing is missing. The constants still say `1,000 credits / 50 SWARM`, which can leak into the UI and mental model.
- The current market lists individual mined `SwarmCoin` objects, not an amount of SWARM from the wallet balance. The “List a mined coin” button can be disabled if mesh is not considered live or no `wallet` status coin exists, so users may see no useful sell inputs.

Implementation plan

1. Make the community pool converge across users
- Wire local `blockchain-transaction` events into the active P2P blockchain sync so real pool-affecting transactions are sent to peers immediately.
- Include pending pool-affecting transactions in pool snapshot freshness/identity so a peer can adopt a newer pending-pool state even when block height is unchanged.
- On incoming pool-affecting transactions, re-derive and broadcast the updated pool once, with throttling to avoid loops.
- Keep the ledger-derived pool as the source of truth, but stop rejecting useful peer snapshots solely because block height matches.

2. Link pool liquidity to the market page correctly
- Update `getCoinMarketStats()` to always derive/read the latest synced pool before calculating `poolLiquidRatio`, instead of showing `0.00%` from a stale or missing local cache.
- Display both pool balance and pool ratio in the market metrics so the user can see the actual synced SWARM pool value behind the percentage.
- Refresh market stats on `reward-pool-update`, `blockchain-transaction`, and market updates.

3. Make Creator deployment pricing visibly dynamic
- Change Creator deployment constants/comments/fallback labels to the intended baseline: `95 credits + 5 SWARM at 100 SWARM community liquidity`.
- Subscribe the Wallet Creator tab to pool updates so the deploy cost recalculates as the synced pool changes, not only on initial wallet load.
- Show a clear formula line in the deploy dialog: current synced pool balance → current credit cost + SWARM cost.
- Keep legacy users protected: if a creator token already exists, no new deployment fee is charged just to preserve or display the token.

4. Open Wallet Market listing inputs for owned SWARM
- Replace the “list one mined coin only” path with a simple “List SWARM for sale” panel:
  - input: SWARM amount to sell
  - input: ask price
  - select: ETH / BTC / MintMe
  - input: receiving address
  - button: List SWARM
- On listing, move/lock that SWARM amount into a market escrow state so it cannot be double-spent while listed.
- Keep existing mined coin support only if it is already used elsewhere, but make the main market UX amount-based because that matches “list mined SWARM for sale that they own in their wallet.”

5. Add buyer controls for open listings
- Open listings show a clear `Buy` button.
- Clicking Buy reserves the listing and shows `Load ETH/BTC/MintMe — coming soon` exactly as requested.
- Buyer can enter a payment reference once payment rails exist; seller can release SWARM after payment confirmation.
- For now, buying does not claim automated ETH/BTC/MintMe custody; it remains marked coming soon.

6. Sync market listings through the mesh
- Add reconstruction/upsert logic for `coin_market_list`, `coin_market_reserve`, `coin_market_confirm_payment`, `coin_market_settle`, `coin_market_cancel`, and `coin_market_dispute` transactions.
- When a peer receives a market transaction, update `coinListings` and escrow/wallet ownership locally so every user sees the same open market.
- Refresh the UI from reconstructed listings, not only local action history.

7. Verification before reporting complete
- Use the live preview to verify Wallet → Creator shows dynamic cost from the pool.
- Verify Wallet → Market shows non-zero pool data when the local ledger has pool contributions.
- Verify a user can open a listing panel, enter SWARM amount/price/currency/address, and create a listing.
- Verify the open listing displays a Buy button and clicking it shows `Load ETH/BTC/MintMe — coming soon` while reserving the listing.
- Run the existing UQRC/lightspeed checks relevant to wallet, pool, and market consistency.