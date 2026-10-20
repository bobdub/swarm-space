/**
 * Creator Vault Custody — real coin custody for the Profile User Markets.
 *
 * Nothing is burned. Every deposit (deployment fee, market buy, creator
 * top-up) is a real on-chain transfer from the payer into the vault's
 * deterministic address, and every payout (buyback, earnings withdrawal,
 * market-close dissolve) is a real transfer back out of that address.
 *
 * Each vault also has a physical container: a locked SwarmCoin
 * (`vault-coin:creator:{tokenId}`, status "vaulted") whose append-only
 * custodyChain engraves every movement and its 40/40/15/5 layer split.
 * The coin can never be spent, transferred, or withdrawn — it is the
 * vault's permanent archival record.
 */

import { get, put } from "../store";
import type { SwarmCoin } from "./types";
import { COIN_MAX_WEIGHT } from "./types";

function nowIso() {
  return new Date().toISOString();
}

/** Deterministic on-chain address that physically holds a vault's SWARM. */
export function creatorVaultAddress(tokenId: string): string {
  return `vault:creator:${tokenId}`;
}

/** Deterministic coin id of the vault's locked container coin. */
export function creatorVaultCoinId(tokenId: string): string {
  return `vault-coin:creator:${tokenId}`;
}

/** Fetch the vault's container coin, if it exists. */
export async function getCreatorVaultCoin(tokenId: string): Promise<SwarmCoin | null> {
  return (await get<SwarmCoin>("swarmCoins", creatorVaultCoinId(tokenId))) ?? null;
}

/**
 * Ensure the vault's locked container coin exists. Idempotent.
 * The coin is owned by the vault address, vaulted and locked — it is an
 * engraving plate, never a spendable wallet coin.
 */
export async function ensureCreatorVaultCoin(
  tokenId: string,
  creatorUserId: string,
): Promise<SwarmCoin> {
  const existing = await getCreatorVaultCoin(tokenId);
  if (existing) return existing;
  const coin: SwarmCoin = {
    coinId: creatorVaultCoinId(tokenId),
    weight: 0,
    maxWeight: COIN_MAX_WEIGHT,
    wrappedTokens: [],
    ownerId: creatorVaultAddress(tokenId),
    status: "vaulted",
    checkedForWrap: false,
    minedAt: nowIso(),
    fillState: "sealed",
    sealedAt: nowIso(),
    kind: "fungible",
    vaultAddress: creatorVaultAddress(tokenId),
    locked: true,
    custodyChain: [
      {
        at: nowIso(),
        from: creatorUserId,
        to: creatorVaultAddress(tokenId),
        reason: "Creator Vault coin engraved — permanent market custody container",
      },
    ],
  };
  await put("swarmCoins", coin);
  return coin;
}

export interface VaultCustodySplit {
  buyback: number;
  stability: number;
  creator: number;
  community: number;
}

/**
 * Lock SWARM into a Creator Vault: a real transfer from the payer to the
 * vault address, engraved onto the vault coin with its layer split.
 * Throws on insufficient balance (via transferSwarm) — nothing is burned.
 */
export async function lockIntoCreatorVault(params: {
  fromId: string;
  tokenId: string;
  creatorUserId: string;
  amount: number;
  split: VaultCustodySplit;
  reason: string;
}): Promise<void> {
  const { fromId, tokenId, creatorUserId, amount, split, reason } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Amount must be > 0");

  const { transferSwarm } = await import("./token");
  await transferSwarm({
    from: fromId,
    to: creatorVaultAddress(tokenId),
    amount,
    meta: { vaultCustody: true, direction: "lock", tokenId, split, reason },
  });

  const coin = await ensureCreatorVaultCoin(tokenId, creatorUserId);
  coin.custodyChain = [
    ...(coin.custodyChain ?? []),
    { at: nowIso(), from: fromId, to: creatorVaultAddress(tokenId), reason },
  ];
  await put("swarmCoins", coin);
}

/**
 * Release SWARM from a Creator Vault to a recipient (buyback, earnings
 * withdrawal, close dissolve). Refuses when the vault address does not
 * physically hold enough — legacy vaults whose deposits predate custody
 * have no engraved funds to release.
 */
export async function releaseFromCreatorVault(params: {
  tokenId: string;
  creatorUserId: string;
  toId: string;
  amount: number;
  layer: string;
  reason: string;
}): Promise<void> {
  const { tokenId, creatorUserId, toId, amount, layer, reason } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Amount must be > 0");

  const vaultAddress = creatorVaultAddress(tokenId);
  const { getSwarmBalance, transferSwarm } = await import("./token");
  const held = await getSwarmBalance(vaultAddress);
  if (held < amount) {
    throw new Error(
      `Vault custody holds ${held.toFixed(4)} SWARM, cannot release ${amount.toFixed(4)}. ` +
        `Markets created before coin custody have no engraved funds to pay out.`,
    );
  }

  await transferSwarm({
    from: vaultAddress,
    to: toId,
    amount,
    meta: { vaultCustody: true, direction: "release", tokenId, layer, reason },
  });

  const coin = await ensureCreatorVaultCoin(tokenId, creatorUserId);
  coin.custodyChain = [
    ...(coin.custodyChain ?? []),
    { at: nowIso(), from: vaultAddress, to: toId, reason: `${reason} (${layer})` },
  ];
  await put("swarmCoins", coin);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }
}
