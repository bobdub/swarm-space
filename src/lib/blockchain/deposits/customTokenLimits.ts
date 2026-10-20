import type { SwarmTransaction } from "../types";

export const CUSTOM_TOKEN_DEPOSIT_MAX = 5_000_000;

/** Lifetime ingress per contract on the known ledger; withdrawals do not reset it. */
export function customTokenDepositCapacity(transactions: SwarmTransaction[], address: string) {
  const currency = `MINTME:${address.trim().toLowerCase()}`;
  const ids = new Set<string>();
  let deposited = 0;
  for (const tx of transactions) {
    if (ids.has(tx.id)) continue;
    ids.add(tx.id);
    if (tx.type !== "external_deposit" || String(tx.meta?.currency).toLowerCase() !== currency.toLowerCase()) continue;
    const amount = Number(tx.amount);
    if (Number.isFinite(amount) && amount > 0) deposited += amount;
  }
  return { deposited, remaining: Math.max(0, CUSTOM_TOKEN_DEPOSIT_MAX - deposited), max: CUSTOM_TOKEN_DEPOSIT_MAX };
}

export function assertCustomTokenDepositCapacity(transactions: SwarmTransaction[], address: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount above zero");
  const capacity = customTokenDepositCapacity(transactions, address);
  if (amount > capacity.remaining) {
    throw new Error(`This token has ${capacity.remaining.toLocaleString()} remaining of its 5,000,000 total deposit limit on the synced ledger.`);
  }
  return capacity;
}