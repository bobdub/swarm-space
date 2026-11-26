// SWARM Token Implementation
import { SwarmTransaction, SwarmTokenBalance } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getTokenBalance, saveTokenBalance } from "./storage";
import { getCurrentUser } from "../auth";
import { assertStorageWritable } from "../storage/quotaGuard";

export async function getSwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getBalance(address);
}

/** SWARM a signed payment may spend on the shared chain: leaves out SWARM issued on this device alone. */
export async function getSpendableSwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getSpendableBalance(address);
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
