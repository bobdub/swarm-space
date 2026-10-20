# Coin Vault market readiness — October 20, 2026

## Current stage
- Wallet Native assets has a positive-balance selector; no speculative price is required to list an owned asset.
- Creator Earnings can be claimed with an amount and confirmation, releasing actual held SWARM before reducing the earnings layer. Legacy unbacked earnings cannot be recreated.
- MintMe imports remain network-first. The wizard explains the per-contract lifetime deposit ceiling and displays remaining capacity on the known ledger.
- Local custom-token deposit requests are capped, including pending records. This is not globally coordinated reservation across disconnected/forked peers.
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
- Deployment deducts credits and saves token state before custody locking finishes; failures can leave partially completed setup.
- Market closure marks closed and zeroes reserve before a best-effort custody release; failure can leave the release unfulfilled.
- Community allocation is best-effort accounting, not an atomic four-asset custody settlement.
- Current quotes, top-ups, payout layers and profile-market actions are SWARM-only.

This document supersedes any suggestion that merely engraving a custom-token balance already enables safe multiasset market payments. Those payments are not implemented in this stage. No live wallet or multi-peer tests were requested or performed.