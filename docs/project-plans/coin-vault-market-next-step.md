# Coin Vault market readiness — October 20, 2026

## Current stage
- Wallet Native assets has a positive-balance selector; no speculative price is required to list an owned asset.
- Creator Earnings can be claimed with an amount and confirmation, releasing actual held SWARM before reducing the earnings layer. All remaining layers, including earmarked community contributions, must be backed; a legacy earnings figure cannot spend another layer's new deposits.
- MintMe imports remain network-first. The wizard explains the per-contract lifetime deposit ceiling and displays remaining capacity on the known ledger.
- Custom-token deposit requests and incoming peer chains are capped, including pending-record reconciliation. This is not globally coordinated reservation across disconnected/forked peers.
- In-game Reinforce and its Credits fallback are unchanged.

## Settlement boundary
Current custom-token deposits are signed records of an external self-transfer. They do not escrow MintMe tokens: a self-transfer does not remove the user's ability to spend them externally. Therefore they cannot yet serve as trustless redeemable backing, freely transferable native value, or market payment liquidity. No outside trading price or UQRC-derived exchange rate is assigned.

## Next phase: profile market buy/sell
1. Establish verified external custody, receipt finality and replay protection before enabling spendable custom-token deposits. Decide how peers agree on a global cap and reconcile forks; local sums alone cannot promise global enforcement.
2. Introduce asset-identified native holdings and transfers, with exact decimal accounting. Keep each token's layers and earnings separate from SWARM, without implicit conversion.
3. Add creator-selected accepted payment and earning assets to the profile market; buyers choose only supported positive-balance assets. Preserve existing SWARM buys/sells until multiasset settlement is verified.
4. Define and validate internal reserve/supply valuation separately. The suggested reserve and unlocked-supply ratios remain ideas, not established prices.
5. Reconcile older vaults from ledger evidence; never mint historical unbacked balances. The current custody container is a deterministic record, not yet a consumed mined deployment-payment coin.

## Audit findings to address before expansion
### Addressed in this update
- Deployment validates inputs first and locks launch custody before charging credits, publishing deployment or granting seed holdings. A rejected credit payment attempts an explicit custody refund.
- Closure refuses unbacked layers and releases the reserve before zeroing it or marking closed. Repeating a successful closure cannot send the reserve again. The closure's community contribution survives pool re-derivation.
- Buys, sells, top-ups, earnings claims and closure share one device-local operation guard. Overlapping actions fail clearly and may be retried with fresh state.
- Profile market reads no longer create empty vaults or run legacy seed migration. Held custody is shown separately from lifetime deposits; unbacked sell-backs, claims and closure are disabled. Launch pricing is no longer hardcoded in the profile.

### Still requires a settlement/recovery design
- Ledger writes, credits, coin engravings and IndexedDB records are not one atomic commit. Crashes, write failures after a transfer and failed refunds still need durable, replay-safe operation journals and reconciliation.
- The shared operation guard is device-local; it does not authorize peer snapshots, verify creator-token ownership across peers or provide distributed locks. Peer snapshot conflicts and holder settlement remain unresolved.
- Community allocation remains earmarked vault custody plus ledger-derived pool accounting, not an atomic separate-asset transfer. Do not promise multiasset settlement or count the same backing twice.
- Older-account initialization must consume an eligible mined Coin or reconstruct a proven holder from ledger evidence. Existing deterministic archival containers are not consumed mined deployment-payment coins; no paid initializer or invented legacy backing was added.
- Current quotes, top-ups, payout layers and profile-market actions remain SWARM-only. Custom payment/earning selectors require verified external escrow, exact-decimal native settlement and a chosen peer agreement design first.

This document supersedes any suggestion that merely engraving a custom-token balance already enables safe multiasset market payments. Those payments are not implemented in this stage. Automated checks cover deployment rejection/refund, payout layer protection, overlapping operations, closure retry and pool derivation; no live wallet or multi-peer tests were performed, by request.