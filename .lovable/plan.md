# Remove Participant Listings — one Buy / Sell-to-Vault path for everyone

## Goal
Creator Token markets get a single, symmetric mechanic: **anyone** (creator or peer) buys from the vault on the bonding curve and sells back to the vault. The peer-to-peer listing board (with its implied bid/ask matching) is removed, and "Redeem at Floor" disappears as a separate control because it is the same act as selling to the vault.

## What changes for the user
- The **Participant Listings** panel (Your Sell Listing / Your Buy Listing / Open Sells / Open Buys) is gone from the Market tab.
- The **Redeem at Floor** panel is gone.
- **Buy** and **Sell to Vault** stay, available to every viewer with a wallet, and are the only trade controls.
- Selling no longer dead-ends when the Buyback Ladder is at Tier 0: the vault falls back to the Stability Floor price so holders always have an exit. The sell panel shows which source is paying ("Ladder Tier N" or "Stability Floor").
- Market closure text no longer mentions refunding listings.

## Technical detail

**Delete**
- `src/lib/blockchain/participantListings.ts`
- Listing state, handlers (`handleListSell`, `handleListBuy`, `handleCancelListing`), the listings JSX block, the Redeem-at-Floor JSX block and `handleRedeemFloor` in `src/components/profile/CreatorMarketTab.tsx`, plus the now-unused imports and the `participant-listing-update` event listener.
- `ParticipantListing`, `ParticipantListingSide`, `ParticipantListingStatus` and the `PARTICIPANT_TRADE_*` share constants in `src/lib/blockchain/types.ts`.

**Fold floor redemption into sell**
- In `src/lib/blockchain/creatorVault.ts`, keep `sellCreatorTokens` as the single exit. When the ladder tier is 0, or the ladder proceeds would breach the 5% hard reserve floor, pay the remainder from `stabilityFloor` at the floor price (`stabilityFloor / circulatingSupply`) instead of throwing "Buyback tier is inactive".
- Return the payment source in the result so the UI can label it; `quoteSell` gains the same fallback so the quoted proceeds match what is actually paid.
- Remove the exported `redeemAtFloor` function (its logic now lives inside the sell path).
- Remove the `refundAllListings` call from `closeCreatorMarket`.

**Storage / housekeeping**
- Leave the `participantListings` IndexedDB store in place in `src/lib/store.ts` (no destructive DB change, per project rules) but drop it from the backup manifest in `src/lib/backup/exportFullState.ts` and from the diagnostics list in `src/pages/StorageDiagnostics.tsx`.

## Verification
- Typecheck passes with no dangling references to `participantListings` / `redeemAtFloor`.
- In the live preview, open a profile Market tab and confirm: only Buy and Sell to Vault panels render, no listings board, no Redeem panel.
- With a vault at Tier 0 and a non-empty Stability Floor, a sell succeeds and pays floor-priced SWARM, and the sell button no longer reads "Buyback inactive".
