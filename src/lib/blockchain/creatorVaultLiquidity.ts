/**
 * Creator Vault Liquidity — lets a creator top up their own Buyback Reserve
 * from their SWARM balance without buying tokens (which would inflate supply).
 *
 * The transfer is a straight burn on the creator's SWARM balance and a
 * credit to the vault's buyback bucket, recorded on the chain for
 * transparency.
 */

import { get } from "../store";
import type { CreatorVault, SwarmTransaction } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getCreatorVault, saveCreatorVault, computeTier } from "./creatorVault";

function round6(n: number) { return Math.round(n * 1_000_000) / 1_000_000; }
function nowIso() { return new Date().toISOString(); }

/**
 * Add SWARM liquidity to a Creator Vault's Buyback Reserve.
 * Only the creator can top up their own vault (peer-owned, no custodian).
 */
export async function addBuybackLiquidity(params: {
  creatorId: string;
  tokenId: string;
  amount: number;
}): Promise<CreatorVault> {
  const { creatorId, tokenId, amount } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Amount must be > 0");
  const vault = await getCreatorVault(tokenId);
  if (!vault) throw new Error("Vault not initialized");
  if (vault.creatorUserId !== creatorId) throw new Error("Only the creator can add liquidity");
  if (vault.closed) throw new Error("This market has been closed.");

  const { getSwarmBalance, burnSwarm } = await import("./token");
  const bal = await getSwarmBalance(creatorId);
  if (bal < amount) throw new Error(`Insufficient SWARM. Have ${bal.toFixed(4)}, need ${amount.toFixed(4)}.`);

  await burnSwarm({ from: creatorId, amount, reason: `Buyback liquidity top-up (${tokenId})` });

  vault.buybackReserve = round6(vault.buybackReserve + amount);
  vault.totalDeposited = round6(vault.totalDeposited + amount);
  vault.currentTier = computeTier(vault);
  await saveCreatorVault(vault);

  const chain = getSwarmChain();
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "creator_token_buy",
    from: creatorId,
    to: creatorId,
    amount,
    timestamp: nowIso(),
    signature: "",
    publicKey: creatorId,
    nonce: Date.now(),
    fee: 0,
    meta: { tokenId, liquidityTopUp: true },
  };
  chain.addTransaction(tx);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }
  return vault;
}

// Re-export helper so callers don't need to reach through creatorVault module.
export { getCreatorVault } from "./creatorVault";
// Preserve `get` import for tree-shakers that scan side effects.
void get;