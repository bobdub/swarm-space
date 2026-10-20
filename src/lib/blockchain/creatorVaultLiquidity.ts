/**
 * Creator Vault Liquidity — lets a creator top up their own vault from
 * their SWARM balance without buying tokens (which would inflate supply).
 *
 * Top-ups follow the vault layers: every contribution splits 40% Buyback
 * Reserve / 40% Stability Floor / 15% Creator Earnings / 5% Community Pool,
 * exactly like a purchase. The transfer is a straight burn on the creator's
 * SWARM balance and a credit to the vault's buckets, recorded on the chain
 * for transparency.
 */

import type { CreatorVault, SwarmTransaction } from "./types";
import {
  CREATOR_VAULT_BUYBACK_SHARE,
  CREATOR_VAULT_STABILITY_SHARE,
  CREATOR_VAULT_CREATOR_SHARE,
} from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getCreatorVault, saveCreatorVault, computeTier } from "./creatorVault";

function round6(n: number) { return Math.round(n * 1_000_000) / 1_000_000; }
function nowIso() { return new Date().toISOString(); }

export interface VaultTopUpSplit {
  buyback: number;
  stability: number;
  creator: number;
  community: number;
}

/** Split a top-up amount across the four vault layers (40/40/15/5). */
export function splitTopUp(amount: number): VaultTopUpSplit {
  const buyback = round6(amount * CREATOR_VAULT_BUYBACK_SHARE);
  const stability = round6(amount * CREATOR_VAULT_STABILITY_SHARE);
  const creator = round6(amount * CREATOR_VAULT_CREATOR_SHARE);
  const community = round6(amount - buyback - stability - creator); // absorbs FP drift
  return { buyback, stability, creator, community };
}

/**
 * Add SWARM liquidity to a Creator Vault, split across all four layers.
 * Only the creator can top up their own vault (peer-owned, no custodian).
 */
export async function addVaultLiquidity(params: {
  creatorId: string;
  tokenId: string;
  amount: number;
}): Promise<{ vault: CreatorVault; split: VaultTopUpSplit }> {
  const { creatorId, tokenId, amount } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Amount must be > 0");
  const vault = await getCreatorVault(tokenId);
  if (!vault) throw new Error("Vault not initialized");
  if (vault.creatorUserId !== creatorId) throw new Error("Only the creator can add liquidity");
  if (vault.closed) throw new Error("This market has been closed.");

  const { getSwarmBalance, burnSwarm } = await import("./token");
  const bal = await getSwarmBalance(creatorId);
  if (bal < amount) throw new Error(`Insufficient SWARM. Have ${bal.toFixed(4)}, need ${amount.toFixed(4)}.`);

  await burnSwarm({ from: creatorId, amount, reason: `Vault liquidity top-up (${tokenId})` });

  const split = splitTopUp(amount);
  vault.buybackReserve = round6(vault.buybackReserve + split.buyback);
  vault.stabilityFloor = round6(vault.stabilityFloor + split.stability);
  vault.creatorEarnings = round6(vault.creatorEarnings + split.creator);
  vault.communityContributed = round6(vault.communityContributed + split.community);
  vault.totalDeposited = round6(vault.totalDeposited + amount);
  vault.currentTier = computeTier(vault);
  await saveCreatorVault(vault);

  // Forward the community share to the SWARM community pool (same as buys).
  if (split.community > 0) {
    try {
      const { getRewardPool, saveRewardPool } = await import("./storage");
      let pool = await getRewardPool();
      if (!pool) {
        pool = { id: "global", balance: 0, totalContributed: 0, lastUpdated: nowIso(), contributors: {} };
      }
      if (!pool.contributors) pool.contributors = {};
      pool.balance = round6(pool.balance + split.community);
      pool.totalContributed = round6(pool.totalContributed + split.community);
      pool.contributors[creatorId] = round6((pool.contributors[creatorId] || 0) + split.community);
      pool.lastUpdated = nowIso();
      await saveRewardPool(pool);
    } catch (err) {
      console.warn("[CreatorVault] Community pool update failed:", err);
    }
  }

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
    meta: { tokenId, liquidityTopUp: true, split },
  };
  chain.addTransaction(tx);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }
  return { vault, split };
}

/** @deprecated Use addVaultLiquidity — top-ups split across all vault layers. */
export const addBuybackLiquidity = async (params: {
  creatorId: string;
  tokenId: string;
  amount: number;
}): Promise<CreatorVault> => (await addVaultLiquidity(params)).vault;

// Re-export helper so callers don't need to reach through creatorVault module.
export { getCreatorVault } from "./creatorVault";
