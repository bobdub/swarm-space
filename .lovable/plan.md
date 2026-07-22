SWARM Economy & Creator Token System

Current state (verified): Creator Tokens exist, vaults split 40% Buyback / 40% Stability / 15% Creator / 5% Community, unlock rate is 10 tokens per credit, and only direct vault buy/sell is implemented. The market has a single community pool and no closure protocol.

This plan applies **Option C** for the unlock-rate change: all existing tokens reset their credit baseline today and begin earning under the new rate.

Phase 1 — Vault terminology and split alignment
- Rename the 40% "Buyback" bucket to "Open Market" in `creatorVault.ts` and `types.ts`.
- Verify that the 40% Stability / 40% Open Market / 15% Creator / 5% Community percentages are enforced on every token deployment and every trade.
- Update the vault UI to show the four named buckets and correct percentages.

Phase 2 — Unlock-rate migration and baseline reset
- Change `TOKENS_PER_CREDIT` to 0.1 (100 tokens per 1,000 credits) in `profileTokenUnlock.ts`.
- Add a migration step in `profileTokenUnlock.ts` that, on first load after the update, reads every deployed creator token and resets `creditsAtLastUnlock` to the current earned-credit value.
- Store a per-token `unlockBaseline` field so future unlocks are calculated from the reset point, not from token birth.
- Ensure the initial 40% deployment unlock remains intact and unaffected by the baseline reset.

Phase 3 — Participant listings
- Add `participantListings` to `coinMarket.ts` and the data model.
- Allow each user to have one active sell listing and one active buy-back listing per creator token at a time.
- Enforce a 95% to the Open Market bucket / 5% to the Community pool split on completed participant trades.
- Serve listings first-listed-first-served: sort by timestamp, match oldest buy against oldest sell.
- Add UI in `CreatorMarketTab.tsx` for creating, viewing, and canceling listings.

Phase 4 — SWARM Market Liquidity Vaults per currency
- Replace the single community pool with dedicated liquidity vaults: ETH, BTC, MintMe.
- Initialize each vault with the 45% liquidity / 40% floor / 15% operations split from the spec.
- Update `CoinMarketTab.tsx` to show per-currency vault balances and allow users to list SWARM against a specific currency.
- Route market settlement into the correct currency vault and update the in-app wallet balances in `appWallet.ts`.

Phase 5 — Buy Back Floor
- Add a "Redeem at Floor" action in `CreatorMarketTab.tsx`.
- Any token holder can redeem tokens at the Stability Floor liquidity price.
- Redemption burns the tokens from the holder and pays from the Stability Floor bucket.

Phase 6 — Market Closure Protocol
- Add a "Close Market" action available only to the token creator (or admin).
- On closure: dissolve the Open Market bucket, settle eligible participant listings, freeze trading, and mark the token as closed.
- Permanently prevent redeployment of the same creator token (by creator identity or token ID).
- Add a "Closed" badge in the UI and remove buy/sell/listing controls for closed tokens.

Phase 7 — Testing and safety
- Add unit tests for vault math, unlock-rate migration, and listing matching.
- Run the UQRC consistency checker after each phase to catch contradictions.
- Verify that existing tokens retain their deployment and initial seed balance after the unlock-rate migration.

Open questions before build mode: none. Option C is selected and the plan is ready for implementation.