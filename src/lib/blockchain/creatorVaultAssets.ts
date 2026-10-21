/**
 * Creator Vault asset inflows — custom tokens and game credits.
 *
 * Safe holders are only the native wallet and the Coin Vault:
 *  - Refused inflows never leave the sender's native wallet (the "refund"
 *    is that nothing moves).
 *  - Accepted custom tokens move by a native `custom_token_transfer` into the
 *    vault address and are engraved on the vault coin. They are held
 *    inventory, not liquid SWARM, so no layer changes.
 *  - Credits are taken from the sender and staged on the vault record. Every
 *    full 100 wraps into 1 SWARM through the existing pool-backed credit wrap
 *    (paid from the reward pool, same as wallet wraps) straight into vault
 *    custody, then splits 40/40/15/5. Below 100 — or when the pool cannot
 *    cover a wrap — credits stay staged and add no liquid value.
 */
import type { CreatorVault, SwarmTransaction } from "./types";
import { CREDIT_TO_SWARM_RATIO } from "./types";
import { evaluateVaultInflow, type VaultInflowAsset } from "./creatorVaultInflow";
import { creatorVaultAddress, ensureCreatorVaultCoin } from "./creatorVaultCustody";
import { withCreatorMarketOperation } from "./creatorMarketOperation";
import { put } from "../store";

export type StagedVault = CreatorVault & { stagedCredits?: number };

function round6(n: number) { return Math.round(n * 1_000_000) / 1_000_000; }
const nowIso = () => new Date().toISOString();

export interface VaultAssetResult {
  action: "accept" | "hold";
  liquidSwarm: number;
  stagedCredits: number;
  message: string;
}

async function ledger(): Promise<SwarmTransaction[]> {
  const { _allTransactionsForExternalLedger } = await import("./wallets/walletLink");
  return _allTransactionsForExternalLedger();
}

/** Contracts that have ever been deposited onto the native ledger. */
export function knownContractsFrom(txs: SwarmTransaction[]): Set<string> {
  const set = new Set<string>();
  for (const tx of txs) {
    const cur = String(tx.meta?.currency ?? "").toLowerCase();
    if (tx.type === "external_deposit" && /^mintme:0x[\da-f]{40}$/.test(cur)) set.add(cur.slice(7));
  }
  return set;
}

export async function depositAssetToCreatorVault(params: {
  fromId: string;
  tokenId: string;
  asset: Exclude<VaultInflowAsset, { kind: "swarm" }>;
  amount: number;
}): Promise<VaultAssetResult> {
  return withCreatorMarketOperation(params.tokenId, () => depositUnlocked(params));
}

async function depositUnlocked(params: {
  fromId: string; tokenId: string; asset: Exclude<VaultInflowAsset, { kind: "swarm" }>; amount: number;
}): Promise<VaultAssetResult> {
  const { fromId, tokenId, asset, amount } = params;
  const { getCreatorVault, saveCreatorVault, computeTier } = await import("./creatorVault");
  const vault = (await getCreatorVault(tokenId)) as StagedVault | null;
  if (!vault) throw new Error("Vault not initialized");
  if (vault.closed) throw new Error("This market has been closed.");
  const vaultAddress = creatorVaultAddress(tokenId);
  const txs = await ledger();
  const { getRecordedTokenBalance, tokenCurrency } = await import("./deposits/customTokens");

  const heldCustom: Record<string, number> = {};
  if (asset.kind === "custom") {
    const c = asset.contract.trim().toLowerCase();
    heldCustom[c] = getRecordedTokenBalance(vaultAddress, c);
  }
  const decision = evaluateVaultInflow(
    { heldCustom, stagedCredits: vault.stagedCredits ?? 0, knownContracts: knownContractsFrom(txs) },
    asset, amount,
  );
  if (decision.action === "refund") throw new Error(`Refused — stays in your wallet: ${decision.reason}`);

  if (asset.kind === "custom") {
    const contract = asset.contract.trim().toLowerCase();
    const { getAvailableTokenBalance, getPendingSyncTokenBalance } = await import("./deposits/customTokens");
    const have = getAvailableTokenBalance(fromId, contract);
    if (have < amount) {
      const pending = getPendingSyncTokenBalance(fromId, contract);
      throw new Error(pending > 0
        ? `Only ${have} available — ${pending} is still pending sync. Connect to a peer to unlock it.`
        : `Insufficient token balance. Have ${have}, need ${amount}.`);
    }
    const { getSwarmChain } = await import("./chain");
    const { generateTransactionId } = await import("./crypto");
    getSwarmChain().addTransaction({
      id: generateTransactionId(), type: "custom_token_transfer", from: fromId, to: vaultAddress, amount,
      timestamp: nowIso(), signature: "", publicKey: fromId, nonce: Date.now(), fee: 0,
      meta: { currency: tokenCurrency(contract), vaultCustody: true, direction: "lock", tokenId },
    });
    const coin = await ensureCreatorVaultCoin(tokenId, vault.creatorUserId);
    coin.custodyChain = [...(coin.custodyChain ?? []), { at: nowIso(), from: fromId, to: vaultAddress, reason: `Held ${amount} ${tokenCurrency(contract)} (inventory, not liquid)` }];
    await put("swarmCoins", coin);
    window?.dispatchEvent?.(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
    return { action: "accept", liquidSwarm: 0, stagedCredits: vault.stagedCredits ?? 0, message: `Vault now holds ${heldCustom[contract] + amount} of this token` };
  }

  // Credits: take from the sender, stage on the vault.
  const { deductCredits } = await import("../credits");
  await deductCredits(fromId, amount, `Credits held in Creator Vault ${tokenId}`);
  let staged = round6((vault.stagedCredits ?? 0) + amount);
  let wraps = Math.floor(staged / CREDIT_TO_SWARM_RATIO);
  let liquid = 0;
  if (wraps > 0) {
    const { getMinedPoolBalance, releaseMinedPoolSwarm } = await import("./creditWrapping");
    wraps = Math.min(wraps, Math.floor(await getMinedPoolBalance()));
    if (wraps > 0) {
      const { splitTopUp } = await import("./creatorVaultLiquidity");
      await releaseMinedPoolSwarm({ to: vaultAddress, amount: wraps, creditsLocked: wraps * CREDIT_TO_SWARM_RATIO, reason: `Wrapped ${wraps * CREDIT_TO_SWARM_RATIO} vault credits → ${wraps} SWARM` });
      const split = splitTopUp(wraps);
      vault.buybackReserve = round6(vault.buybackReserve + split.buyback);
      vault.stabilityFloor = round6(vault.stabilityFloor + split.stability);
      vault.creatorEarnings = round6(vault.creatorEarnings + split.creator);
      vault.communityContributed = round6(vault.communityContributed + split.community);
      vault.totalDeposited = round6(vault.totalDeposited + wraps);
      vault.currentTier = computeTier(vault);
      staged = round6(staged - wraps * CREDIT_TO_SWARM_RATIO);
      liquid = wraps;
      const coin = await ensureCreatorVaultCoin(tokenId, vault.creatorUserId);
      coin.custodyChain = [...(coin.custodyChain ?? []), { at: nowIso(), from: "community-pool", to: vaultAddress, reason: `Wrapped ${wraps * CREDIT_TO_SWARM_RATIO} credits → ${wraps} SWARM (40/40/15/5)` }];
      await put("swarmCoins", coin);
    }
  }
  vault.stagedCredits = staged;
  await saveCreatorVault(vault);
  window?.dispatchEvent?.(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  return {
    action: liquid > 0 ? "accept" : "hold", liquidSwarm: liquid, stagedCredits: staged,
    message: liquid > 0
      ? `${liquid} SWARM wrapped into the vault layers; ${staged} credits held`
      : `${staged} / ${CREDIT_TO_SWARM_RATIO} credits held — not liquid until they can wrap`,
  };
}
