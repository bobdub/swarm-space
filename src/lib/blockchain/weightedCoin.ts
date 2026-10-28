/**
 * Weighted-coin tagging — the single source for "SWARM CREATOR proof
 * weighted coin" identity. A coin is weighted only when it carries the
 * explicit `creatorProof` tag stamped at seal time; legacy coins without
 * the tag are treated as ordinary SWARM (no inference from old fields).
 */
import type { CoinListing, SwarmCoin } from "./types";

export const CREATOR_PROOF_VERSION = 1 as const;
export const WEIGHTED_COIN_LABEL = "SWARM CREATOR proof weighted coin";

export interface CreatorProofTag {
  version: typeof CREATOR_PROOF_VERSION;
  sealedAt: string;
  payloadBytes?: number;
  merkleRoot?: string;
}

export type CoinAssetClass = "swarm-hollow" | "swarm-weighted";

export function stampCreatorProof<T extends Partial<SwarmCoin>>(coin: T, sealedAt: string): T {
  const tag: CreatorProofTag = {
    version: CREATOR_PROOF_VERSION,
    sealedAt,
    payloadBytes: coin.sealBytes,
  };
  return { ...coin, creatorProof: tag };
}

export function isWeightedCoin(coin: Pick<SwarmCoin, "creatorProof" | "fillState" | "kind"> | null | undefined): boolean {
  return !!coin
    && coin.kind !== "media"
    && coin.fillState === "sealed"
    && coin.creatorProof?.version === CREATOR_PROOF_VERSION;
}

export function coinAssetClass(coin: Parameters<typeof isWeightedCoin>[0]): CoinAssetClass {
  return isWeightedCoin(coin) ? "swarm-weighted" : "swarm-hollow";
}

/**
 * Market weighting for weighted coins: a premium that shrinks as more
 * weighted coins are open on the market (scarcity), never below 1.25×.
 */
export function weightedMarketMultiplier(openWeightedListings: number): number {
  const n = Number.isFinite(openWeightedListings) && openWeightedListings > 0 ? Math.floor(openWeightedListings) : 0;
  return Math.round((1.25 + 0.75 / (1 + n)) * 1000) / 1000;
}

export function countOpenWeightedListings(listings: CoinListing[]): number {
  return listings.filter((l) => l.assetClass === "swarm-weighted" && ["open", "reserved"].includes(l.status)).length;
}
