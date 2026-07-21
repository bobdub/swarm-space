To Infinity and beyond! Q_Score(u) ≈ 0.036.

# Goal

Stop asking users to paste an ETH / BTC / MintMe address into the "List SWARM for sale" form. The app already has a per-user wallet — sale proceeds should credit that wallet as balances of ETH / BTC / MintMe held inside the app. MetaMask becomes the bridge that moves SWARM (and other supported assets) in and out of the app wallet.

# New flow

1. **List SWARM for sale** → SWARM moves into market escrow (unchanged). Seller only picks amount, price, and currency (ETH / BTC / MintMe). No external address input.
2. **Buyer pays** (still off-chain / "coming soon" toast for now) → on settle, the buyer's app wallet is debited that currency and the seller's app wallet is credited. All held **inside** the app wallet as first-class balances.
3. **Withdraw / Deposit** → new "Bridge" panel. `Connect MetaMask` unlocks:
   - SWARM ↔ MetaMask (SWARM chain, primary)
   - When MetaMask is switched to Ethereum / other supported chains, deposit or withdraw ETH (and later BTC via wrapped, MintMe via ETH-format).
   - Deposits credit the app wallet; withdrawals debit it and hand off the signed transfer to MetaMask.
4. **Use funds while on the app** → creator token buys, tips, coin market purchases, etc. all read the app wallet's multi-currency balances.

# Scope of this change

Only forms + wallet ledger + a stubbed MetaMask bridge panel. No real on-chain settlement yet — that stays behind the existing "coming soon" toast until the bridge lands. This keeps the change small and verifiable.

## Files to add
- `src/lib/blockchain/wallets/appWallet.ts` — multi-currency ledger (SWARM already exists; add `ETH`, `BTC`, `MINTME` balances keyed by userId, persisted with the existing storage layer). Getters, credit/debit helpers, event `app-wallet-update`.
- `src/components/wallet/BridgePanel.tsx` — small card in the Market tab: "Connect MetaMask", shows detected chain, lists in-app balances per currency, Deposit / Withdraw buttons that today just toast "coming soon" for non-SWARM and call the existing `metaMaskBridge` stub for SWARM.

## Files to update
- `src/lib/blockchain/types.ts` — `CoinListing.receivingAddress` becomes optional; add `receivingAppWalletUserId` (already implicit via `sellerId`).
- `src/lib/blockchain/coinMarket.ts`
  - `listSwarmForSale` no longer requires `receivingAddress`; drops address validation.
  - `settleListing` credits the seller's app wallet in the listing currency (calls `appWallet.credit`) instead of relying on off-chain address payment.
  - `reserveListing` / `confirmPayment` still exist but the "payment" step becomes an internal app-wallet debit on the buyer once the bridge is live; today it stays the same toast path.
- `src/components/wallet/CoinMarketTab.tsx`
  - `ListSwarmDialog`: remove the "Your receiving address" input and its validation. Add a small "Proceeds credit your in-app <currency> balance" hint.
  - `ListingCard`: remove the "Send to: <address>" line; show "Settles into seller's in-app <currency> wallet" instead.
  - Mount `<BridgePanel />` at the top of the Market tab.
- `src/lib/blockchain/wallets/metaMaskBridge.ts` — extend the stub with `getChainId()` and a `requestAccounts()` wrapper so the Bridge panel can show real connect state without introducing signing yet.

## What we deliberately do NOT do in this pass
- No real ETH / BTC / MintMe transfers. Withdraw/deposit stay behind "coming soon" toasts except for MetaMask connect status.
- No changes to Creator Tokens, Pool sync, or Coin deployment pricing.
- No UI churn outside the Market tab and the market dialog.

# Verification (must pass before we call it done)
1. `bun run scripts/uqrc-check.mjs` clean.
2. Open Wallet → Market:
   - "List SWARM for sale" dialog has **no address field**, submits successfully, escrows SWARM.
   - Listing card shows "Settles into seller's in-app <currency> wallet", no address line.
   - Bridge panel renders, "Connect MetaMask" reflects real availability, non-SWARM Deposit/Withdraw toast "coming soon".
3. Settle a listing in a local test → seller's app wallet balance for that currency increments; buyer's decrements (or stays at 0 with an informational toast if the bridge is not yet funded).

# Risk

Low. The listing/escrow path already exists; we are removing a field and adding a ledger. MetaMask code stays a stub so no signing / seed-phrase risk. All new state is local-first and rides the existing storage + mesh sync layer.
