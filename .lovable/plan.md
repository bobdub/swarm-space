# Clean Up & Prep: Remove legacy MetaMask, fixed 1 MINTME gas hold

## 1. Gas fee on non-SWARM withdrawals
When the network is MintMe, the Withdraw dialog shows:

```text
Withdraw:  X MINTME        (what the recipient gets)
Gas fee:   1 MINTME held   (pays MintMe network gas)
Total:     X + 1 MINTME    (needed in your balance)
```

- The Withdraw button stays off unless the balance covers X + 1.
- "Max" fills balance − 1, so a full withdrawal never fails on gas.
- Only the real gas used is debited from the ledger (normally a tiny fraction of 1); the unused part of the hold stays in the user's balance. This keeps the ledger equal to what actually left the address, so the 2-minute deposit sync never re-credits or double-counts.
- The withdrawal record keeps the tx hash as soon as it is broadcast, so closing the tab mid-send can't leave the balance out of step.
- SWARM-network withdrawals are unchanged (no gas).

## 2. Remove legacy MetaMask code
Remove (MetaMask-connect flows replaced by native send/receive):
- MetaMask deposit: `MintMeDepositDialog`, `deposits/mintmeDeposit.ts`, `depositDismissal.test.tsx`
- MetaMask connect/gateway: `MetaMaskConnectButton`, `MetaMaskGatewayService`, `useMetaMask`, `metaMaskSdk`, `metaMaskBridge(+test)`, `metaMaskRequestTimeout`, `swarmMetaMask`, `SwarmMetaMaskDialog`, `SwarmMetaMaskGuide` page + route, wallet-link signing (`walletLink`)
- MetaMask export tab in `SwarmBridgeDialog`, MetaMask tab in Assets, MetaMask button in top bar / Settings gateway panel
- Custom-token MetaMask deposit paths superseded by `NativeTokenImport`

Keep:
- Historical ledger acceptance of past MetaMask hash deposits (`nativeMintmeCustody` verify path) so old balances stay valid
- `DirectCryptoDonate` (plain address/QR donations)
- Cold Wallet guide, rewritten to "send to your native receiving address; withdraw to any 0x address"
- MintMe network/RPC helpers used by native send/receive

Each removal is preceded by an `rg` check; anything still imported by native flows is kept and noted.

## 3. Docs & rules
- Replace MetaMask rules in root and `src/lib/blockchain/AGENTS.md` with: "Wallet send/receive is native cold-key only; MetaMask-era records are accepted for history, never created."
- Update memory (MetaMask Swarm Cell, MintMe network flow) as retired.

## Technical details
- `nativeMintmeDirect.withdrawNativeMintMe`: add `GAS_HOLD = 1e18`; check ledger and on-chain `held ≥ value + GAS_HOLD`; debit `value + gasUsed*gasPrice`.
- `MintMeWithdrawDialog`: fee/total breakdown, Max = balance − 1.
- Tests: balance below X+1 blocked; Max = balance − 1; ledger debit = X + actual gas; sync after withdrawal credits 0. Run existing wallet/MintMe suites after removals.
