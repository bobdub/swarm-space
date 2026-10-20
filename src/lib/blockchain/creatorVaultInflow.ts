// Creator Vault inflow gate — decides, once connected, whether an incoming
// buy/tip asset can be accepted, must be held unapplied, or must be refunded.
// Pure decisions only: settlement still goes through creatorVaultCustody.ts.
import { CREDIT_TO_SWARM_RATIO } from "./types";
import { CUSTOM_TOKEN_DEPOSIT_MAX } from "./deposits/customTokenLimits";

export type VaultInflowAsset =
  | { kind: "swarm" }
  | { kind: "custom"; contract: string }
  | { kind: "credits" };

export interface VaultInflowState {
  /** Custom-token amounts already held by this vault, keyed by lowercase contract. */
  heldCustom: Record<string, number>;
  /** Game credits held but not yet wrapped (below 100). */
  stagedCredits: number;
  /** Contracts recognised as deposited on the native ledger. */
  knownContracts: Set<string>;
}

export type VaultInflowDecision =
  | { action: "accept"; liquidSwarm: number; next: VaultInflowState }
  | { action: "hold"; liquidSwarm: number; next: VaultInflowState; reason: string }
  | { action: "refund"; reason: string };

const CONTRACT = /^0x[\da-f]{40}$/;

export function evaluateVaultInflow(
  state: VaultInflowState,
  asset: VaultInflowAsset,
  amount: number,
): VaultInflowDecision {
  if (!Number.isFinite(amount) || amount <= 0) return { action: "refund", reason: "Amount must be above zero" };

  if (asset.kind === "swarm") return { action: "accept", liquidSwarm: amount, next: state };

  if (asset.kind === "custom") {
    const contract = asset.contract.trim().toLowerCase();
    if (!CONTRACT.test(contract) || !state.knownContracts.has(contract)) {
      return { action: "refund", reason: "Token is not held on the native blockchain" };
    }
    const held = state.heldCustom[contract] ?? 0;
    if (held >= CUSTOM_TOKEN_DEPOSIT_MAX || held + amount > CUSTOM_TOKEN_DEPOSIT_MAX) {
      return { action: "refund", reason: `Vault would exceed ${CUSTOM_TOKEN_DEPOSIT_MAX.toLocaleString()} of this token` };
    }
    return {
      action: "accept",
      liquidSwarm: 0,
      next: { ...state, heldCustom: { ...state.heldCustom, [contract]: held + amount } },
    };
  }

  // Game credits: every full 100 wraps into 1 SWARM of liquid value; remainder is held.
  const total = state.stagedCredits + amount;
  const wraps = Math.floor(total / CREDIT_TO_SWARM_RATIO);
  const remainder = total - wraps * CREDIT_TO_SWARM_RATIO;
  const next = { ...state, stagedCredits: remainder };
  if (wraps === 0) {
    return { action: "hold", liquidSwarm: 0, next, reason: `${remainder} / ${CREDIT_TO_SWARM_RATIO} credits held until they can wrap` };
  }
  return { action: "accept", liquidSwarm: wraps, next };
}
