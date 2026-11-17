import { getCreditTransactions } from "@/lib/credits";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { getAllLiveChains } from "@/lib/blockchain/multiChainManager";
import { buildUnifiedHistory, type UnifiedHistoryEntry } from "./unifiedHistory";

/** Reads both ledgers as they are; never writes or migrates records. */
export async function loadUnifiedHistory(userId: string): Promise<UnifiedHistoryEntry[]> {
  if (!userId) return [];
  const chain = getSwarmChain();
  await chain.whenReady();
  const [credits, liveChains] = await Promise.all([
    getCreditTransactions(userId),
    getAllLiveChains().catch(() => []),
  ]);
  const chainTxs = chain.getChain().flatMap(b => b.transactions).concat(chain.getPendingTransactions());
  return buildUnifiedHistory({
    userId,
    credits,
    chain: chainTxs,
    chains: liveChains.map(c => ({ chainId: c.chainId, ticker: c.ticker })),
  });
}
