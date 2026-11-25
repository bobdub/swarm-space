import { getCreditTransactions } from "@/lib/credits";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { getAllLiveChains } from "@/lib/blockchain/multiChainManager";
import { getAll } from "@/lib/store";
import type { SwarmCoin } from "@/lib/blockchain/types";
import { readSealTier } from "@/lib/blockchain/engravingTiers";
import { isWeightedCoin } from "@/lib/blockchain/weightedCoin";
import { buildUnifiedHistory, type UnifiedHistoryEntry } from "./unifiedHistory";

/** Reads both ledgers as they are; never writes or migrates records. */
export async function loadUnifiedHistory(userId: string): Promise<UnifiedHistoryEntry[]> {
  if (!userId) return [];
  const chain = getSwarmChain();
  await chain.whenReady();
  const [credits, liveChains, coins] = await Promise.all([
    getCreditTransactions(userId),
    getAllLiveChains().catch(() => []),
    getAll<SwarmCoin>("swarmCoins").catch(() => [] as SwarmCoin[]),
  ]);
  // Engraving weight belongs to the coin; only Creator Proof coins are weighted.
  const coinTiers = new Map(coins.map(c => [c.coinId, isWeightedCoin(c) ? readSealTier(c) : null]));
  const pending = chain.getPendingTransactions();
  const chainTxs = chain.getChain().flatMap(b => b.transactions).concat(pending);
  return buildUnifiedHistory({
    pendingIds: new Set(pending.map(tx => tx.id)),
    userId,
    credits,
    chain: chainTxs,
    chains: liveChains.map(c => ({ chainId: c.chainId, ticker: c.ticker })),
    coinTiers,
  });
}
