# Native wallet: dual-class token actions

## Goal
Split native wallet actions by asset class: imported MintMe tokens get Deposit + Transfer/Withdraw (with a Send to MintMe exit); SWARM-native assets get online-peer transfer plus direct SWARM-address send.

## Class A — Imported MintMe tokens (custom token rows, Native tab)
1. **Deposit button** opens a native deposit dialog showing the user's cold-key receiving address (QR + copy) with the banner: "Only deposit MintMe tokens on the MintMe blockchain." No MetaMask involved.
2. **Transfer/Withdraw button** opens one dialog with:
   - The online connected-peer list (live from the mesh). Custom-token mesh sends stay fail-closed — picking a peer opens Send & Tip where the custom asset is marked unavailable, so nothing can be deducted.
   - A "Send to MintMe" button that switches the dialog in-place to the existing cold-key withdrawal form (destination prefill from MetaMask when connected, editable, gas note, engraving prompt when no key).
3. Remove the standalone "Withdraw to MetaMask" button.

## Class B — SWARM-native assets (SWARM, Credits, ETH, BTC, Creator tokens)
1. Replace OnlineTransferDialog with a new NativeTransferDialog that offers:
   - The online connected-peer list (unchanged behavior: pick a peer → Send & Tip preselected).
   - A "Send to a SWARM wallet address" input: resolves `swarm:` ids, raw user ids, and 0x receiving aliases via resolveNativeWalletRecipient, then opens Send & Tip for that user.
2. Copy: "Only send to SWARM wallets — offline peers sync when connected and require an address."
3. Keep the offline "Waiting for peers" gate for the peer list; the address path stays available offline (records locally, syncs on connect).

## Files
- `src/components/wallet/NativeTransferDialog.tsx` (new) — peer list + address input, shared by Class B rows.
- `src/components/wallet/NativeTokenDepositDialog.tsx` (new) — receiving address + MintMe-only banner.
- `src/components/wallet/CustomTokenWizard.tsx` — CustomTokenRow native actions become Deposit + Transfer/Withdraw; Transfer/Withdraw dialog hosts peer list + in-place withdrawal form.
- `src/components/wallet/AssetsTab.tsx` — swap OnlineTransferDialog for NativeTransferDialog on SWARM/Credits/MINTME/ETH/BTC/creator rows.

## Boundaries (unchanged)
- ETH, SWARM, BTC, Creator tokens: no withdrawal to MintMe.
- Custom-token mesh settlement stays blocked until verified; withdrawals need the cold key + MINTME gas.
- No automatic hiding; SWARM never hideable.

## Verification
- Extend nativeAssets/hiddenAssets tests if touched; add a small test for the address-resolution path used by NativeTransferDialog (valid alias resolves, garbage rejects).
- Run focused vitest files; check build-errors.log.
