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

/** Validate peer ledger ingress without accepting duplicate external deposit records. */
export function validCustomTokenDepositLedger(transactions: SwarmTransaction[]): boolean {
  const totals = new Map<string, number>();
  const seen = new Set<string>();
  for (const tx of transactions) {
    const currency = String(tx.meta?.currency ?? "").toLowerCase();
    if (tx.type !== "external_deposit" || !/^mintme:0x[\da-f]{40}$/.test(currency)) continue;
    if (seen.has(tx.id)) return false;
    seen.add(tx.id);
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const total = (totals.get(currency) ?? 0) + amount;
    if (total > CUSTOM_TOKEN_DEPOSIT_MAX) return false;
    totals.set(currency, total);
  }
  return true;
}