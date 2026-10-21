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

const POOL = "community-pool";

export async function getVaultTokenHeld(contract: string): Promise<number> {
  const { getRecordedTokenBalance } = await import("./deposits/customTokens");
  return getRecordedTokenBalance(POOL, contract.toLowerCase());
}

async function addTokenTransfer(from: string, to: string, amount: number, contract: string, direction: string) {
  const { getSwarmChain } = await import("./chain");
  const { generateTransactionId } = await import("./crypto");
  const { tokenCurrency } = await import("./deposits/customTokens");
  getSwarmChain().addTransaction({
    id: generateTransactionId(), type: "custom_token_transfer", from, to, amount,
    timestamp: new Date().toISOString(), signature: "", publicKey: from, nonce: Date.now(), fee: 0,
    meta: { currency: tokenCurrency(contract), marketVault: true, direction },
  });
}

/** Swap a synced native-wallet token into the vault for already-mined SWARM. */
export async function swapTokenForSwarm(userId: string, contract: string, amount: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const c = contract.toLowerCase();
    const { getAvailableTokenBalance } = await import("./deposits/customTokens");
    const { quoteTokenForSwarm } = await import("./marketVaultPricing");
    const [state, held] = await Promise.all([getMarketVaultState(), getVaultTokenHeld(c)]);
    const q = quoteTokenForSwarm(state, held, amount, getAvailableTokenBalance(userId, c));
    if (q.error) throw new Error(q.error);
    await addTokenTransfer(userId, POOL, amount, c, "vault-buy");
    await releaseMinedPoolSwarm({ to: userId, amount: q.out, creditsLocked: 0, reason: `Market Vault swap: ${amount} token → ${q.out} SWARM` });
    return q;
  });
}

/** Sell SWARM into the vault for a token it actually holds. */
export async function swapSwarmForToken(userId: string, contract: string, swarm: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const c = contract.toLowerCase();
    const { getSwarmBalance, transferSwarm } = await import("./token");
    const { quoteSwarmForToken } = await import("./marketVaultPricing");
    const [state, held, mine] = await Promise.all([getMarketVaultState(), getVaultTokenHeld(c), getSwarmBalance(userId)]);
    const q = quoteSwarmForToken(state, held, swarm, mine);
    if (q.error) throw new Error(q.error);
    await transferSwarm({ from: userId, to: POOL, amount: swarm, meta: { marketVault: true, direction: "vault-sell" } });
    await addTokenTransfer(POOL, userId, q.out, c, "vault-sell");
    const { derivePoolFromChain } = await import("./storage");
    await derivePoolFromChain().catch(() => {});
    return q;
  });
}
