/**
 * coinNftBinding — bind a freshly-minted NFT to a mined coin as its
 * "first artifact" (the immutable seed for field orientation).
 *
 * SCAFFOLD STAGE — pure helpers + a thin advisory wrapper. The actual
 * call sites in nft.ts / mediaCoin.standalone.ts are wired in the
 * follow-up patch so this PR can land without behaviour changes.
 *
 * Rules (from PROJECT_SOURCE_OF_TRUTH alignment):
 *   1. Only `pool` coins can be bound.
 *   2. Binding moves coin to `bound`, then immediately to `filling`.
 *   3. The bound NFT id is the coin's first artifact and cannot change.
 *   4. If the first artifact is removed from active availability, the
 *      coin seals immediately (handled by `sealOnArtifactRemoval`).
 */
import type { SwarmCoin } from "./types";
import { applySeal } from "./coinFill";

export interface BindArgs {
  coin: SwarmCoin;
  nftId: string;
  ownerId: string;
}

export function canBind(coin: SwarmCoin): boolean {
  const phase = coin.fillState ?? (coin.status === "pool" ? "pool" : "filling");
  return phase === "pool" && !coin.firstArtifactNftId;
}

export function bindFirstArtifact({ coin, nftId, ownerId }: BindArgs): SwarmCoin {
  if (!canBind(coin)) {
    throw new Error(`coin ${coin.coinId} cannot be bound (state=${coin.fillState ?? coin.status})`);
  }
  return {
    ...coin,
    ownerId,
    status: "wallet",
    fillState: "filling",
    firstArtifactNftId: nftId,
    fill: coin.fill ?? 0,
    stressAccrued: coin.stressAccrued ?? 0,
  };
}

/** Per the spec, removal of the first artifact seals the coin instantly. */
export function sealOnArtifactRemoval(coin: SwarmCoin, removedNftId: string): SwarmCoin {
  if (coin.firstArtifactNftId !== removedNftId) return coin;
  if (coin.fillState === "sealed" || coin.fillState === "spent") return coin;
  return applySeal(coin);
}