---
name: weighted-coins-uqrc
description: Weighted coins as UQRC lifecycle — pool→bound→filling→sealed→spent; 4Hz fill from field stress with 80% knee; first-artifact NFT binding; only sealed coins spendable
type: feature
---
Weighted Coins are mined SWARM coins evolved by the UQRC field.

- Lifecycle (`SwarmCoin.fillState`): `pool → bound → filling → sealed → spent`. Fields are optional on `SwarmCoin` — legacy coins remain valid.
- Material model: coins = Carbon (lattice, single-use crystal); tokens = Gold (fluid, divisible).
- Fill math (`src/lib/blockchain/coinFill.ts`): `df = (1-f)(1-exp(-k_eff·stress·dt))` with `k_eff` softening past the 0.80 knee over a 0.25 band. Pure, unit-testable.
- 4 Hz scheduler (`coinFillScheduler.ts`) is the ONLY mutator of `fill`/`stressAccrued`/`fillState`. Stress is provided by an injected `StressSampler`; the scheduler never imports `fieldEngine` directly (mirrors `chainHealthBridge` contract).
- NFT binding (`coinNftBinding.ts`): `bindFirstArtifact` moves pool→filling and writes `firstArtifactNftId` (immutable). `sealOnArtifactRemoval` seals instantly when the first artifact becomes unavailable.
- Spend guard (`coinSpend.ts`): `isSpendable` true only for `sealed` coins; legacy coins (no lifecycle metadata) fall back to `status==='wallet'` for compatibility. `assertSpendable` throws typed `SpendBlockedReason`.
- See `docs/WEIGHTED_COINS_UQRC.md` for the full spec and module boundaries.