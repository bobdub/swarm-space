/**
 * Tip weight: the engraving tier a SWARM tip carries in its signed payload.
 *
 * Hollow is the default. A sender can only pick a tier they hold an engraved
 * (Creator Proof) coin for; senders without engraved coins never see tiers and
 * always send Hollow. The tier is part of the signed meta, so a peer cannot
 * change it in transit. Tips signed before this format carry no weight and read
 * as Hollow. The tier labels the payment's weight; it does not move coin custody.
 */
import type { SwarmCoin, SwarmTransaction } from "../types";
import type { EngravingTier } from "../engravingTiers";
import { readSealTier } from "../engravingTiers";
import { isWeightedCoin } from "../weightedCoin";

export const TIP_FORMAT_VERSION = 2 as const;
export type TipWeight = "hollow" | EngravingTier;
export const TIP_WEIGHTS: readonly TipWeight[] = ["hollow", "basic", "rare", "legendary"];
export const TIP_WEIGHT_LABELS: Record<TipWeight, string> = {
  hollow: "Hollow", basic: "Basic", rare: "Rare", legendary: "Legendary",
};

const isTipWeight = (value: unknown): value is TipWeight =>
  typeof value === "string" && (TIP_WEIGHTS as readonly string[]).includes(value);

/** Weights this member may tip with: Hollow, plus each tier of an engraved coin they hold. */
export function availableTipWeights(coins: readonly SwarmCoin[], userId: string): TipWeight[] {
  const held = new Set<TipWeight>();
  for (const coin of coins) {
    if (coin.ownerId === userId && coin.status === "wallet" && !coin.vaultAddress && isWeightedCoin(coin)) {
      held.add(readSealTier(coin));
    }
  }
  return TIP_WEIGHTS.filter(w => w === "hollow" || held.has(w));
}

/** Default to Hollow; refuse a tier the sender does not hold. */
export function resolveTipWeight(requested: TipWeight | undefined, available: readonly TipWeight[]): TipWeight {
  const weight = requested ?? "hollow";
  if (!available.includes(weight)) {
    throw new Error(`You don't hold an engraved ${TIP_WEIGHT_LABELS[weight] ?? weight} coin to tip with`);
  }
  return weight;
}

/** The weight a recorded tip carries; legacy tips without one are Hollow. */
export function readTipWeight(tx: Pick<SwarmTransaction, "meta">): TipWeight {
  const weight = tx.meta?.weight;
  return isTipWeight(weight) ? weight : "hollow";
}

/**
 * Signed-format check. Legacy tips (no tipFormat, no weight) stay valid.
 * Format 2 requires a known weight, and only SWARM tips may carry one.
 */
export function hasValidTipWeight(tx: Pick<SwarmTransaction, "meta">): boolean {
  const format = tx.meta?.tipFormat;
  const weight = tx.meta?.weight;
  if (format === undefined && weight === undefined) return true;
  if (format !== TIP_FORMAT_VERSION || !isTipWeight(weight)) return false;
  return tx.meta?.assetId === "chain:SWARM";
}
