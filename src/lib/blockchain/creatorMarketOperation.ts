/** Device-local exclusion across every operation touching a creator market.
 * This is not peer consensus or a distributed settlement lock.
 */
const activeMarkets = new Set<string>();

export async function withCreatorMarketOperation<T>(
  tokenId: string,
  action: () => Promise<T>,
): Promise<T> {
  if (activeMarkets.has(tokenId)) {
    throw new Error("A market operation is already in progress for this vault. Please retry.");
  }
  activeMarkets.add(tokenId);
  try {
    return await action();
  } finally {
    activeMarkets.delete(tokenId);
  }
}