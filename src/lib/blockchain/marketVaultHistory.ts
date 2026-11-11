import type { SwarmTransaction } from "./types";

export interface VaultTradeReceipt {
  id: string;
  direction: "vault-buy" | "vault-sell";
  timestamp: string;
  paid: number;
  paidAsset: string;
  received: number;
  receivedAsset: string;
  rate: number;
}

/** Use completed payout legs only: payment proposals and failed swaps are not receipts. */
export function marketVaultHistory(transactions: SwarmTransaction[], userId: string): VaultTradeReceipt[] {
  if (!userId) return [];
  const seen = new Set<string>();
  return transactions.flatMap((tx): VaultTradeReceipt[] => {
    const m = tx.meta;
    if (tx.to !== userId || m?.marketVault !== true || m.tradeLeg !== "payout"
      || (m.direction !== "vault-buy" && m.direction !== "vault-sell")) return [];
    const id = String(m.operationId ?? tx.id);
    const paid = Number(m.paidAmount);
    const received = Number(tx.amount);
    if (seen.has(id) || !Number.isFinite(paid) || paid <= 0 || !Number.isFinite(received) || received <= 0) return [];
    seen.add(id);
    return [{ id, direction: m.direction, timestamp: tx.timestamp, paid, paidAsset: String(m.paidAsset),
      received, receivedAsset: String(m.receivedAsset), rate: paid / received }];
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export async function getMarketVaultHistory(userId: string) {
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  return marketVaultHistory([...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()], userId);
}