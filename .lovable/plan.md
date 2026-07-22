# Mobile MetaMask + SWARM Bridge

## Goals
1. Make the wallet/market experience work on mobile — MetaMask connects from the phone, and market forms can be filled and submitted without getting stuck off-screen.
2. Build a real bridge so MetaMask can connect to a SWARM EVM network and move funds on-chain.

## What we know from the latest check
- `window.ethereum` is not injected on mobile browsers, so the current MetaMask button always shows “Install MetaMask” and sends the user to a download page.
- Market forms on mobile are not reachable at the bottom of the dialog, so users cannot submit listings or payments.
- SWARM is a custom chain and is not yet EVM-compatible, so MetaMask cannot add it as a custom network today.

## Technical approach

### Phase 1 — Mobile wallet connection (MetaMask SDK)
- Add `@metamask/sdk` to the project.
- Create a small wrapper `src/lib/blockchain/wallets/metaMaskSdk.ts` that initializes the SDK on mobile / touch devices and falls back to the existing extension provider on desktop.
- Update `src/hooks/useMetaMask.ts` to use the SDK provider when available, keeping the local cache behavior unchanged.
- The MetaMask button will offer:
  - Desktop: connect browser extension.
  - Mobile: deep-link / QR pairing into the MetaMask app.
  - Not installed: still show the install link, but with a fallback “Open MetaMask app” option if the SDK can detect it.

### Phase 2 — Mobile market forms
- Make all market dialogs scrollable and keyboard-safe on small screens:
  - Add `max-h-[90dvh] overflow-y-auto` to the dialog content wrapper.
  - Use the existing `vaul` drawer for the listing / buy / withdraw forms on mobile (`max-w-full`, bottom-sheet style, scrollable body).
- Test the “List SWARM” and “I paid” flows at 360px viewport to confirm the submit button is reachable.
- Keep the same form state and validation; only the container changes.

### Phase 3 — SWARM EVM network definition
- Define a canonical SWARM EVM network config in `src/lib/blockchain/wallets/swarmEvmNetwork.ts`:
  - `chainId` (hex)
  - `chainName` (e.g. “Swarm-Space Testnet”)
  - `rpcUrls` (placeholder for the SWARM RPC endpoint)
  - `nativeCurrency` (symbol: SWARM, decimals: 18)
  - `blockExplorerUrls` (optional)
- Add helpers to request `wallet_addEthereumChain` and `wallet_switchEthereumChain` in MetaMask.
- The network config will be a single source of truth used by the connect button and the bridge panel.

### Phase 4 — Real bridge contract interface
- Install `ethers` (or `viem`) for contract calls.
- Create an ERC-20 wrapped SWARM token ABI and a placeholder contract address in `src/lib/blockchain/wallets/swarmBridge.ts`.
- Implement:
  - `depositSwarmToEvm(amount)` — lock local SWARM and call the bridge contract mint function.
  - `withdrawSwarmFromEvm(amount)` — call the bridge contract burn/redeem function and credit local SWARM.
- Until the bridge contract is deployed, the UI will show the on-chain preview with a clear “contract not deployed” state and a button to copy the deployment parameters.

### Phase 5 — Deposit / withdraw flows
- Replace the current “bridge signing coming soon” messages in `AssetsTab` with actual on-chain calls.
- Deposit: show the MetaMask address and the amount; confirm the EVM transaction.
- Withdraw: show the destination address and amount; confirm the EVM transaction.
- Keep the in-app ledger as a fallback/cache and record every bridge transaction in the local SWARM chain for auditability.

## Verification steps
- Type-check and build pass.
- Mobile preview: open Wallet → Market, tap “List SWARM,” scroll to the bottom, and submit.
- Mobile preview: tap MetaMask connect, choose MetaMask app, and return with the address visible.
- Desktop: MetaMask extension still connects as before.
- Bridge: add SWARM network to MetaMask and confirm the chain ID is accepted.

## Out of scope
- WalletConnect, Rainbow, etc. MetaMask only for now.
- Deploying the actual bridge contract. The code will be ready and a placeholder address will be used; the user can deploy the contract and update the address.

## Next action
Approve the plan, then I will implement Phase 1 and Phase 2 first (mobile wallet + mobile forms) and continue with the bridge configuration.