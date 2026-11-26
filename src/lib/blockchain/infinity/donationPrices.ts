/**
 * Market prices for the donor board, in SWARM per unit, from the app's own
 * markets:
 *   • Credits: the Market Vault's spot price (Credits per SWARM, inverted).
 *   • Synced MintMe/Ethereum tokens: the vault's spot price for that token,
 *     liquid SWARM / (virtual reserve + what the vault holds).
 *   • Creator tokens: the creator market's spot price at today's supply.
 *   • MINTME, ETH, BTC: the coin market's base ask for one SWARM, inverted.
 * The vault figures come from mined blocks, so peers on the same chain agree.
 * An asset with no market gets no price and adds nothing to a donor's value.
 */
import type { CoinMarketCurrency } from "../types";

const COIN_MARKET: readonly CoinMarketCurrency[] = ["MINTME", "ETH", "BTC"];

export async function loadMarketPrices(refs: Iterable<string>): Promise<Record<string, number>> {
  const wanted = new Set(refs);
  const prices: Record<string, number> = { SWARM: 1 };
  const set = (ref: string, price: number) => { if (Number.isFinite(price) && price > 0) prices[ref] = price; };
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  const [{ sharedMarketVaultState, confirmedVaultTotals, vaultTokenHeld }, { spotCreditsPerSwarm, marketVaultLayers, TOKEN_VIRTUAL_RESERVE }] =
    await Promise.all([import("../poolLedger"), import("../marketVaultPricing")]);
  const state = sharedMarketVaultState(chain);
  if (wanted.has("Credits")) set("Credits", 1 / spotCreditsPerSwarm(state));
  const { liquid } = marketVaultLayers(state);
  const totals = confirmedVaultTotals(chain);
  for (const ref of wanted) {
    if (/^[a-z]+:0x[0-9a-f]{40}$/i.test(ref)) {
      set(ref, liquid / (TOKEN_VIRTUAL_RESERVE + vaultTokenHeld(totals, ref)));
    } else if (ref.startsWith("creator:")) {
      try {
        const [{ getCreatorVault, priceAtSupply }] = await Promise.all([import("../creatorVault")]);
        const vault = await getCreatorVault(ref.slice("creator:".length));
        if (vault && !vault.closed && Number.isFinite(vault.circulatingSupply)) set(ref, priceAtSupply(vault.circulatingSupply));
      } catch { /* no creator market here: no price */ }
    }
  }
  const coins = COIN_MARKET.filter((c) => wanted.has(c));
  if (coins.length > 0) {
    try {
      const { getCoinMarketStats, quoteBaseAsk } = await import("../coinMarket");
      const stats = await getCoinMarketStats();
      for (const c of coins) set(c, 1 / quoteBaseAsk(c, stats));
    } catch { /* coin market unavailable: those coins stay unpriced */ }
  }
  return prices;
}
