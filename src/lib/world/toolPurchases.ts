/**
 * toolPurchases — tools bought from the Market instead of built.
 *
 * A prefab with `priceSwarm` (today only the Prospector's Pick) costs that
 * much SWARM once, or the same value in Credits at the Market's live spot
 * rate (`spotCreditsPerSwarm`, with the 100:1 `CREDIT_TO_SWARM_RATIO` as the
 * fallback when the vault cannot be read). The payment goes into the
 * Market Vault the way a Market sale's does:
 *   - SWARM: a transfer to the community pool marked as a pool inflow
 *     (`marketVault: true`, `direction: 'vault-sell'`),
 *   - Credits: deducted from the buyer and recorded into the Market's
 *     Credits reserve.
 * Both legs carry `meta.toolPurchase = <prefabId>`, and ownership is read
 * back from the ledger (mined blocks plus this device's unmined entries),
 * so a bought tool stays bought on every device that has the chain.
 */
import { CREDIT_TO_SWARM_RATIO, type SwarmBlock, type SwarmTransaction } from '@/lib/blockchain/types';
import { spotCreditsPerSwarm, type MarketVaultState } from '@/lib/blockchain/marketVaultPricing';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';

export const PROSPECTOR_PICK_ID = 'tool_pick_prospector';

export type ToolPurchaseCurrency = 'SWARM' | 'CREDITS';

export const TOOL_PURCHASE_EVENT = 'tool-purchase-update';

/** SWARM price of a bought tool, or null when the prefab is not sold. */
export function toolPriceSwarm(prefabId: string): number | null {
  const price = getPrefab(prefabId)?.priceSwarm;
  return typeof price === 'number' && price > 0 ? price : null;
}

/** Credits price: the SWARM price at the live spot rate, rounded up. */
export function toolPriceCredits(prefabId: string, market?: MarketVaultState | null): number | null {
  const swarm = toolPriceSwarm(prefabId);
  if (swarm == null) return null;
  let rate = CREDIT_TO_SWARM_RATIO;
  if (market) {
    const spot = spotCreditsPerSwarm(market);
    if (Number.isFinite(spot) && spot > 0) rate = spot;
  }
  return Math.ceil(swarm * rate - 1e-9);
}

interface LedgerSource {
  getChain(): SwarmBlock[];
  getPendingTransactions(): SwarmTransaction[];
}

function isPurchaseBy(tx: SwarmTransaction, userId: string, prefabId: string): boolean {
  return tx.from === userId && (tx.meta as Record<string, unknown> | undefined)?.toolPurchase === prefabId;
}

/** Whether the ledger shows `userId` bought `prefabId`. Pure over the chain. */
export function ownsToolIn(chain: LedgerSource, userId: string, prefabId: string): boolean {
  if (!userId) return false;
  for (const tx of chain.getPendingTransactions()) if (isPurchaseBy(tx, userId, prefabId)) return true;
  for (const block of chain.getChain()) {
    for (const tx of block.transactions ?? []) if (isPurchaseBy(tx, userId, prefabId)) return true;
  }
  return false;
}

async function readyChain() {
  const { getSwarmChain } = await import('@/lib/blockchain/chain');
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain;
}

export async function ownsTool(userId: string | null | undefined, prefabId: string): Promise<boolean> {
  if (!userId) return false;
  if (toolPriceSwarm(prefabId) == null) return true;
  return ownsToolIn(await readyChain(), userId, prefabId);
}

/** Both prices, Credits at the live spot rate. */
export async function toolQuote(prefabId: string): Promise<{ swarm: number; credits: number } | null> {
  const swarm = toolPriceSwarm(prefabId);
  if (swarm == null) return null;
  let market: MarketVaultState | null = null;
  try {
    const { sharedMarketVaultState } = await import('@/lib/blockchain/poolLedger');
    market = sharedMarketVaultState(await readyChain());
  } catch { /* fall back to the 100:1 ratio */ }
  return { swarm, credits: toolPriceCredits(prefabId, market) as number };
}

/**
 * Buy `prefabId` for `userId`. Throws (and charges nothing) when the tool
 * is not sold, already owned, the buyer is not signed in, or the balance
 * is short.
 */
export async function buyTool(userId: string, prefabId: string, currency: ToolPurchaseCurrency): Promise<void> {
  const { getCurrentUser } = await import('@/lib/auth');
  if (!userId || getCurrentUser()?.id !== userId) throw new Error('Sign in to buy tools.');
  if (currency !== 'SWARM' && currency !== 'CREDITS') throw new Error('Tools sell only for SWARM or Credits. Nothing was charged.');
  const quote = await toolQuote(prefabId);
  if (!quote) throw new Error('That tool is not for sale.');
  if (await ownsTool(userId, prefabId)) throw new Error('You already own this tool.');
  const label = getPrefab(prefabId)?.label ?? prefabId;
  const meta = { toolPurchase: prefabId, marketVault: true };

  const { COMMUNITY_POOL, VAULT_CREDITS_CURRENCY } = await import('@/lib/blockchain/poolLedger');
  if (currency === 'SWARM') {
    const { transferSwarm } = await import('@/lib/blockchain/token');
    await transferSwarm({ from: userId, to: COMMUNITY_POOL, amount: quote.swarm, meta: { ...meta, direction: 'vault-sell' } });
  } else {
    const { deductCredits } = await import('@/lib/credits');
    await deductCredits(userId, quote.credits, `Market: ${label} for ${quote.credits} credits`);
    const { generateTransactionId } = await import('@/lib/blockchain/crypto');
    const chain = await readyChain();
    chain.addTransaction({
      id: generateTransactionId(), type: 'custom_token_transfer', from: userId, to: COMMUNITY_POOL, amount: quote.credits,
      timestamp: new Date().toISOString(), signature: '', publicKey: userId, nonce: Date.now(), fee: 0,
      meta: { currency: VAULT_CREDITS_CURRENCY, ...meta },
    });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TOOL_PURCHASE_EVENT, { detail: { prefabId, userId } }));
  }
}
