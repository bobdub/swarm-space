// SWARM Token Implementation
import { SwarmTransaction, SwarmTokenBalance } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getTokenBalance, saveTokenBalance } from "./storage";
import { getCurrentUser } from "../auth";

export async function getSwarmBalance(address: string): Promise<number> {
  const chain = getSwarmChain();
  return chain.getBalance(address);
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

export async function mintSwarm(params: {
  to: string;
  amount: number;
  reason: string;
}): Promise<SwarmTransaction> {
  const chain = getSwarmChain();

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_mint",
    from: "system",
    to: params.to,
    amount: params.amount,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: "system",
    nonce: Date.now(),
    fee: 0,
    meta: { reason: params.reason },
  };

  chain.addTransaction(transaction);
  return transaction;
}

export async function burnSwarm(params: {
  from: string;
  amount: number;
  reason: string;
}): Promise<SwarmTransaction> {
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

export async function claimRewardAsSwarm(params: {
  userId: string;
  creditAmount: number;
  reason: string;
}): Promise<SwarmTransaction> {
  // Convert credits to SWARM at 1:1 ratio
  const swarmAmount = params.creditAmount;

  const transaction = await mintSwarm({
    to: params.userId,
    amount: swarmAmount,
    reason: `Credit reward conversion: ${params.reason}`,
  });

  return transaction;
}

export function getSwarmTicker(): string {
  return "SWARM";
}

export function getSwarmName(): string {
  return "Swarm-Space";
}
