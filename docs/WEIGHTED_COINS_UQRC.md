# Weighted Coins — UQRC Alignment

_Status: scaffolding landed; scheduler + UI wiring in follow-up._

## Definitions (already true in the codebase)

- **Coin** — a *mined* action object (`SwarmCoin`). Coins are never minted.
- **Token** — an *earned/wrapped* asset (`CreatorToken`, `WrappedTokenPayload`). Tokens are never mined.
- **Field stress** — sampled UQRC manifold stress: $\lVert[D_\mu,D_\nu]\rVert + \lVert\nabla_\mu\nabla_\nu S(u)\rVert$.
- **Fill** — normalised progress `[0,1]` accrued from field stress.
- **First artifact** — the NFT bound to the coin at mint time; the immutable seed for field orientation.

## Lifecycle state machine

```
pool → bound → filling → sealed → spent
```

| State        | Meaning                                                                 |
|--------------|-------------------------------------------------------------------------|
| `pool`       | Empty mined coin sitting in the community pool. Not bindable to value.  |
| `bound`      | NFT first-artifact attached; orientation locked. Transient.             |
| `filling`    | Accruing stress at 4 Hz toward the seal threshold.                      |
| `sealed`     | Crystallised. Immutable value carrier. Spendable.                       |
| `spent`      | Transferred / consumed for tools. Terminal.                             |

## Material analogy

- **Coins → Carbon (C)** — diamond-like, lattice-stable, single-use crystal.
- **Tokens → Gold (Au)** — fluid, divisible, measured by weight.

## Fill math (deterministic)

Implemented in `src/lib/blockchain/coinFill.ts`:

```ts
// soft-saturation past the 80 % knee
const k_eff = fill < 0.80 ? k : k * (1 - (fill - 0.80) / 0.25);
const df    = (1 - fill) * (1 - exp(-k_eff * stress * dt));
fill_next   = min(1, fill + df);
```

- 4 Hz tick (`coinFillScheduler.ts`).
- `stress` sampled through an injected `StressSampler` so the math stays pure and unit-testable.
- Reaching `fill >= 1` triggers an immediate `applySeal` transform.

## NFT binding

Implemented in `src/lib/blockchain/coinNftBinding.ts`:

- `bindFirstArtifact({ coin, nftId, ownerId })` — pool → filling.
- The bound NFT is the coin's only first artifact and may never be replaced.
- `sealOnArtifactRemoval(coin, nftId)` — if that NFT becomes unavailable, the coin seals instantly at its current fill (snapshot).

## Spend guard

Implemented in `src/lib/blockchain/coinSpend.ts`:

- `isSpendable(coin)` returns `true` only for `sealed` coins (or legacy coins with no lifecycle metadata, for backward compatibility).
- `assertSpendable(coin)` throws with a typed `SpendBlockedReason` so the wallet UI can surface a precise message.

## Module boundaries

- `coinFill.ts` — pure math. No I/O, no Field access.
- `coinFillScheduler.ts` — only mutator of `fill` / `stressAccrued` / `fillState`.
- `coinNftBinding.ts` — only writer of `firstArtifactNftId`.
- `coinSpend.ts` — only place that decides whether a coin may leave the wallet.
- UQRC sampling never reaches into `fieldEngine` directly — it goes through the same bridge pattern as `chainHealthBridge` (see `mem://blockchain/uqrc-coupling`).

## What is NOT in this scaffold

- The scheduler does not auto-start at boot.
- Existing `coinWrap.ts` / `nft.ts` / `mediaCoin.standalone.ts` are unchanged; lifecycle fields are optional on `SwarmCoin` so all current data validates.
- No transport coupling: media availability lives wherever the project already keeps it; only its presence/absence is observed via `sealOnArtifactRemoval`.