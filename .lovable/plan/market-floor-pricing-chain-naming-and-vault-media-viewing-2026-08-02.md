# Market Floor Pricing, Chain Naming, and Vault Media Viewing

Four contained changes. Nothing outside the files named below is touched.

## 1. Market form: floor tiers instead of free-form bids

Today the "List SWARM for sale" dialog has an open "Total ask price" number box, so any value (including far under the market floor) can be typed — that behaves like a bid, not a listing.

Change it to floor-anchored pricing:
- Compute a **floor price** from live pool stats: `quoteBaseAsk(currency, marketStats) x SWARM amount`.
- Replace the free number input with a **price tier selector**: Floor (1.00x), +10%, +25%, +50%, plus a Custom option clamped so it can never go below the floor.
- Show the resulting total, per-SWARM rate, and the anchoring floor live as amount/currency change.
- Enforce the same rule in the listing function so any listing under floor is rejected with a clear error.

## 2. Wallet: "Coins" becomes "Chain"

Rename the wallet tab label and the panel heading/description wording from Coins to Chain. Label-only change — tab value, routes and stored data stay identical so nothing else breaks.

## 3. Vaults: visual display of coins being engraved

In Node -> Content Distribution -> Peer Vaults, each actively filling coin currently shows only a text state and byte count. Add:
- A slim animated fill bar per active coin (percent of the 500 MiB capacity), colour-matched to its state (Filling / Approaching / Sealing).
- A pulsing "engraving" indicator on the coin currently taking writes, plus the name of the file in flight.
- Sealed / Wrapped coins render a solid full bar so completion reads instantly.

## 4. Completed media coins: click to view the file

Entries inside a sealed or wrapped coin become clickable. Clicking opens a viewer dialog that pulls real bytes through the existing content resolver (media coin first, then local chunks) and renders by type:
- image -> inline image
- video / audio -> inline player
- text / markdown -> scrollable text
- anything else -> file summary with a Download button

If bytes are not available locally, the dialog says so rather than showing a broken frame. Entries in unsealed coins stay non-clickable and keep their Pending / Archive badge.

## Technical notes

- `src/components/wallet/CoinMarketTab.tsx` — floor + tier selector UI, clamped custom input.
- `src/lib/blockchain/coinMarket.ts` — add `floorAskFor(currency, swarmAmount, stats)` and a floor guard inside `listSwarmForSale`.
- `src/pages/Wallet.tsx` and `src/components/wallet/CoinDeploymentPanel.tsx` — Coins -> Chain label text.
- `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` — engraving bars/pulse in coin rows; make `VaultEntryRow` clickable when its coin is sealed/wrapped.
- New `src/components/p2p/dashboard/VaultMediaViewerDialog.tsx` — dialog using `resolveContent` from `src/lib/blockchain/contentResolver.ts`, with object-URL cleanup on close.

## Verification

- Playwright: Wallet -> Market, confirm an ask below the shown floor cannot be submitted and tier buttons produce expected totals.
- Playwright: Wallet tab reads "Chain".
- Playwright: Node -> Content Distribution, expand a vault, screenshot the animated engraving bars, then click a completed coin entry and confirm the viewer renders content (or the explicit "not stored locally" state).