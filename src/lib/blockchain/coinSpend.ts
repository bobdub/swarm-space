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
  | "vaulted"
  | "missing-first-artifact";

export function isSpendable(coin: SwarmCoin): boolean {
  // Vault Transfer Protocol: a coin engraved into a vault is a permanent
  // archival record. It can never be spent, transferred, or withdrawn.
  if (isVaultLocked(coin)) return false;
  if (!coin.firstArtifactNftId) {
    // Legacy coins with no lifecycle metadata fall back to the old
    // `status === 'wallet'` rule so we don't break existing balances.
    return coin.fillState === undefined && coin.status === "wallet";
  }
  return coin.fillState === "sealed";
}

/** True when the coin lives inside a vault protocol and is immutable. */
export function isVaultLocked(coin: SwarmCoin): boolean {
  return coin.status === "vaulted" || coin.locked === true || coin.kind === "media";
}

export function spendBlockedReason(coin: SwarmCoin): SpendBlockedReason | null {
  if (isSpendable(coin)) return null;
  if (isVaultLocked(coin)) return "vaulted";
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