// SWARM Token Implementation
import { SwarmTransaction, SwarmTokenBalance } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getTokenBalance, saveTokenBalance } from "./storage";
import { getCurrentUser } from "../auth";
import { assertStorageWritable } from "../storage/quotaGuard";
import { REWARD_MATURITY_BLOCKS } from "./issuance";

/**
 * SWARM `address` holds on the shared chain: the figure every peer computes
 * and the one tips, donations and payments may spend. SWARM issued on this
 * device alone is left out (see getDeviceOnlySwarmBalance).
 */
export async function getSwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getSpendableBalance(address);
}

/** SWARM recorded on this device alone: peers can't verify it, so it can't be spent. */
export async function getDeviceOnlySwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getDeviceOnlyBalance(address);
}

/** Block rewards this address mined that ripen after REWARD_MATURITY_BLOCKS more blocks. */
export async function getMaturingSwarmRewards(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getImmatureRewards(address);
}

/** SWARM a signed payment may spend on the shared chain: leaves out SWARM issued on this device alone. */
export async function getSpendableSwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getSpendableBalance(address);
}

const fmtSwarm = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * Why `amount` SWARM can't be spent right now, naming each part of the
 * balance that is held back, or null when it can. Uses the same shared-chain
 * figure a peer checks before accepting the payment.
 */
export async function swarmSpendProblem(address: string, amount: number, verb = "sent"): Promise<string | null> {
  const chain = getSwarmChain();
  await chain.whenReady();
  const spendable = chain.getSpendableBalance(address);
  if (spendable >= amount) return null;
  const parts = [`You can spend ${fmtSwarm(spendable)} SWARM right now.`];
  const maturing = chain.getImmatureRewards(address);
  if (maturing > 0) parts.push(`${fmtSwarm(maturing)} more is from blocks you mined in the last ${REWARD_MATURITY_BLOCKS} blocks and unlocks as new blocks land.`);
  const deviceOnly = chain.getDeviceOnlyBalance(address);
  if (deviceOnly > 0) parts.push(`${fmtSwarm(deviceOnly)} is recorded on this device only, outside any block, so peers can't accept it.`);
  parts.push(`Nothing was ${verb}.`);
  return parts.join(" ");
}

export async function getTokenBalanceRecord(address: string): Promise<SwarmTokenBalance> {
  const existing = await getTokenBalance(address);
  if (existing) {
    return existing;
  }

  const balance: SwarmTokenBalance = {
    address,
    balance: 0,
    locked: 0,
    available: 0,
    nfts: [],
    lastUpdated: new Date().toISOString(),
  };

  await saveTokenBalance(balance);
  return balance;
}

export async function transferSwarm(params: {
  from: string;
  to: string;
  amount: number;
  fee?: number;
  meta?: Record<string, unknown>;
}): Promise<SwarmTransaction> {
  await assertStorageWritable();
  const chain = getSwarmChain();
  const currentBalance = await getSwarmBalance(params.from);

  if (currentBalance < params.amount + (params.fee || 0)) {
    throw new Error("Insufficient SWARM balance");
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_transfer",
    from: params.from,
    to: params.to,
    amount: params.amount,
    timestamp: new Date().toISOString(),
    signature: "", // Would be generated with user's private key
    publicKey: params.from,
    nonce: Date.now(),
    fee: params.fee || 0,
    meta: params.meta,
  };

  chain.addTransaction(transaction);
  return transaction;
}

/**
 * SWARM is issued only by shared-chain block rewards, mined on the SWARM
 * Mesh. A mint made here would sit on this device alone: peers can't verify
 * it, so it would never sync. Refuse instead of creating coins that don't exist.
 */
export async function mintSwarm(_params: {
  to: string;
  amount: number;
  reason: string;
}): Promise<SwarmTransaction> {
  throw new Error("SWARM is only issued by block rewards on the shared chain; nothing was minted.");
}

export async function burnSwarm(params: {
  from: string;
  amount: number;
  reason: string;
}): Promise<SwarmTransaction> {
  await assertStorageWritable();
  const chain = getSwarmChain();
  const currentBalance = await getSwarmBalance(params.from);

  if (currentBalance < params.amount) {
    throw new Error("Insufficient SWARM balance to burn");
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_burn",
    from: params.from,
    to: "0x0",
    amount: params.amount,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.from,
    nonce: Date.now(),
    fee: 0,
    meta: { reason: params.reason },
  };

  chain.addTransaction(transaction);
  return transaction;
}

export function getSwarmTicker(): string {
  return "SWARM";
}

export function getSwarmName(): string {
  return "Swarm-Space";
}
