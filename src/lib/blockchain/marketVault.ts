import { withCreatorMarketOperation } from "./creatorMarketOperation";
import { quoteVaultBuy, type MarketVaultState } from "./marketVaultPricing";
import { getMinedPoolBalance, releaseMinedPoolSwarm } from "./creditWrapping";

export async function getMarketVaultState(): Promise<MarketVaultState> {
  const [poolBalance, { getSwarmChain }] = await Promise.all([getMinedPoolBalance(), import("./chain")]);
  const chain = getSwarmChain();
  await chain.whenReady();
  return { poolBalance, knownMined: Math.max(poolBalance, chain.getTotalSupply()) };
}

/** Buy SWARM from the community-pool vault with Credits. Never mints; the 40% floor is never released. */
export async function buySwarmFromVault(userId: string, swarm: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const { getCreditBalance, deductCredits } = await import("../credits");
    const [state, credits] = await Promise.all([getMarketVaultState(), getCreditBalance(userId)]);
    const quote = quoteVaultBuy(state, swarm, credits);
    if (quote.error) throw new Error(quote.error);
    await deductCredits(userId, quote.credits, `Market Vault: ${quote.credits} credits → ${quote.swarm} SWARM`);
    await releaseMinedPoolSwarm({
      to: userId,
      amount: quote.swarm,
      creditsLocked: quote.credits,
      reason: `Market Vault buy: ${quote.swarm} SWARM for ${quote.credits} credits`,
    });
    return quote;
  });
}
