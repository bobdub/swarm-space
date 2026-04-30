/**
 * coinSpend — guard helpers enforcing "only sealed coins are spendable".
 *
 * SCAFFOLD STAGE — pure predicate + error-returning guard. UI and
 * transaction builders should call `assertSpendable(coin)` before
 * constructing a transfer / tool-payment transaction. Wiring into the
 * existing wallet send path lands in the follow-up patch.
 */
import type { SwarmCoin } from "./types";

export type SpendBlockedReason =
  | "unbound"
  | "filling"
  | "already-spent"
  | "missing-first-artifact";

export function isSpendable(coin: SwarmCoin): boolean {
  if (!coin.firstArtifactNftId) {
    // Legacy coins with no lifecycle metadata fall back to the old
    // `status === 'wallet'` rule so we don't break existing balances.
    return coin.fillState === undefined && coin.status === "wallet";
  }
  return coin.fillState === "sealed";
}

export function spendBlockedReason(coin: SwarmCoin): SpendBlockedReason | null {
  if (isSpendable(coin)) return null;
  if (coin.fillState === "spent") return "already-spent";
  if (!coin.firstArtifactNftId) return "missing-first-artifact";
  if (coin.fillState === "filling" || coin.fillState === "bound") return "filling";
  return "unbound";
}

export function assertSpendable(coin: SwarmCoin): void {
  const reason = spendBlockedReason(coin);
  if (reason) {
    throw new Error(`coin ${coin.coinId} not spendable: ${reason}`);
  }
}