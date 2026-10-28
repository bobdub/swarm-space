# Account-free MintMe community rewards

## Result
Replace the community-user payout model with a separate mesh-agreement path. No one signs in as the community vault. Keep the existing wallet transfer experience and leave Brain, camera, weather and native SWARM mining untouched.

## Reward rules
- Mining proceeds go to the configured community MintMe receiving address.
- Only independently verified, confirmed MintMe earnings count toward the 25 MINTME threshold.
- Retain 5% for the community; distribute 95% equally among the agreed connected network recipients.
- Credit MINTME in existing native SWARM wallets without changing SWARM balances or using MetaMask.
- Receiving a native credit is not an external MintMe transfer to a user's cold-key address.

## Implementation
1. Add an isolated MintMe proposal and approval validator. Each proposal binds the confirmed funding receipts, eligible-member snapshot, recipients, atomic-unit amounts and retained share to one deterministic identifier.
2. Require signed approvals from a strict majority of the same eligible-member snapshot. Reject duplicate voters, nonmembers, stale snapshots, changed amounts and replayed receipts. A browser's immediate neighbours must not define network membership.
3. Add account-free native community allocation acceptance, separate from ordinary user-signed wallet tips. Verify backing and the complete agreement certificate before accepting the whole batch; record retained funds and prevent repeated allocation of the same receipts.
4. Carry complete certified batches through the existing wallet transaction transport and chain validation. Wallet balances must read accepted allocations, including after reload and peer synchronization.
5. Remove the community-login payout entry point when its replacement passes focused tests. Keep honest waiting status in Node details, with no pop-up alerts.

## Boundaries that must be resolved before automatic payouts
The existing SWARM mining vote approves positive block activity; it does not establish confirmed external funds, a globally agreed member list or globally exclusive spending. It cannot safely authorize MintMe payouts unchanged.

Two foundations need explicit provision before automatic settlement can be enabled:
- **An authenticated, consistent network membership/checkpoint rule**, so different portions of the mesh cannot approve conflicting batches against the same money. Mere majority counting of self-reported peers is insufficient.
- **Account-free control of external custody**, such as a supported threshold-signing arrangement or a verified MintMe contract. Peer votes alone cannot spend funds at an ordinary MintMe address. Native allocations do not move community funds into users' personal external cold-key wallets.

Build and test the proposal/certificate groundwork first, keeping live allocation disabled until those foundations exist. Do not distribute a shared private key, derive a public community secret, invent MINTME credits or silently introduce a community account.

## Technical details and verification
- Reuse `payoutPolicy.ts` for the 25 MINTME / 5% / 95% atomic-unit math; add no new pricing multiplier.
- Keep MintMe agreement in its own module instead of extending native mining's block-vote handler.
- Bind receipts and batches deterministically; verify exact replay versus altered replay and reject conflicting allocations.
- Add focused tests for majority membership, receipt authenticity, threshold, equal shares, retained funds, partitions, duplicate execution and atomic rejection.
- Run existing native MINTME, wallet-tip, payout-policy and miner lifecycle tests. Do not open a live Brain browser session.
- Funded multi-peer payouts and external withdrawals remain unverified until real custody and membership prerequisites are available.