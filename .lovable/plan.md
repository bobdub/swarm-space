# Wallet & Market — MetaMask always on, trades peer-gated

The user corrected the split: MetaMask can connect at any time (deposit/withdraw), but markets and token/coin actions require peers to propagate. This plan wires that split cleanly.

1. Global MetaMask connect, always available
- New `MetaMaskConnectButton.tsx` (or `WalletConnectButton`) using the existing `metaMaskBridge.ts` helpers.
- Mount it in `Wallet.tsx` header row so it is visible on every tab.
- Also mount it in the top navigation bar (`TopNavigationBar.tsx`) on desktop and inside the mobile menu, so users can connect MetaMask without navigating to Wallet.
- Persist last known account in `localStorage` so the badge renders immediately on reload, then reconciles with the extension.
- States: not detected → install link; disconnected → Connect; connected → show truncated address + chain label + Disconnect / Reconnect dropdown.

2. Add Assets tab as first Wallet tab
- New `AssetsTab.tsx` showing unified balance list: SWARM, Credits, ETH, BTC, MintMe.
- SWARM/Credits use existing balances.
- ETH/BTC/MintMe use `getAppWalletBalances` from `appWallet.ts`.
- Each row has a Deposit button (opens modal showing deposit address / QR) and a Withdraw button (amount input + destination = connected MetaMask address).
- Deposit: SWARM shows the user's peer/address; ETH/BTC/MintMe show the connected MetaMask address as the deposit target (the bridge direction from MetaMask → app).
- Withdraw: ETH/BTC/MintME withdraw debits the in-app balance and records a `pending_withdraw` transaction (real signing stays "bridge signing next release" as today). The UI clearly states the funds are still on the in-app ledger until the bridge is signed.
- Keep the existing `BridgePanel` but remove it from CoinMarketTab and mount it inside the Assets tab as the "Bridge" section, or merge it into the Assets tab so the MetaMask connect is the same everywhere. Mark `BridgePanel` deprecated if superseded.

3. Market actions require peer connection
- New `useMarketGate()` helper in `marketGate.ts` (or inline) that returns `canTrade` = true only when there is at least one active peer connection (`useP2PContext` + `getActivePeerConnections().length > 0`).
- In `CoinMarketTab.tsx`:
  - Disable `List SWARM for sale` when `!canTrade` with tooltip/text: "Connect to a peer to list."
  - Disable the `Buy` button on `ListingCard` when `!canTrade`.
  - Disable seller release/cancel and buyer confirm/dispute when `!canTrade` (these are state mutations that must propagate).
  - Replace the current generic mesh alert with a clearer message: "Markets only operate while connected to another peer." when `!canTrade`.
- Local pending transactions remain visible (cached listings, queued actions), but mutations are blocked until a peer is present.

4. Wallet tab reorder
- Move "Assets" to the first/default tab.
- Reorder tabs as requested: Ledger, Credits, NFTs, Mining, Swap, Creator, Coins, Market.
  - The existing order already matches this except Assets is new and should be first. Keep default to Assets.

5. No changes to settlement/escrow logic
- `coinMarket.ts`, `appWallet.ts`, and mesh propagation stay unchanged. Only UI gating and visibility are updated.
- No new IndexedDB schema or localStorage keys beyond the MetaMask cache.

6. Verification
- Type-check.
- Load `/wallet` without peers → Assets tab shows balances and MetaMask connect works; Market tab lists disabled actions with "connect to a peer" message.
- Connect MetaMask → address/chain appears in wallet header and top nav; withdraw modal prefills MetaMask address.
- Connect to a peer → Market list/buy/release buttons become enabled.
