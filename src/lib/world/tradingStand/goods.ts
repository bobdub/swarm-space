/**
 * Trading goods in the player's material bag.
 *
 * Wood, Water, Stone, Fibre and Food are the material lens over the element
 * bag (`materials.ts`). Honey and Gems are their own goods, kept in the same
 * bag under `good:` keys. Every change goes through `spendHarvested` (via
 * `spendMaterials`) or `recordHarvestForResource`, so the bag stays the one
 * source of what a player holds.
 *
 * The stand is online play: its trades and stock reach the ledger, so it
 * reads and draws the online bag only (`ONLINE_ONLY`). Goods gathered in
 * offline play stay local and are never sold or stocked here.
 */
import { getHarvested, recordHarvestForResource, spendHarvested, type BagScope } from '@/lib/remix/harvestedInventory';
import { materialTotals, spendMaterials, type MaterialId } from '@/lib/world/materials';
import type { TradingGood } from './pricing';

const MATERIAL_GOODS: ReadonlySet<TradingGood> = new Set(['wood', 'water', 'stone', 'fibre', 'food']);
const goodKey = (good: TradingGood) => `good:${good}`;
const ONLINE_ONLY: BagScope = { onlineOnly: true };

/** Whole units of `good` the player holds from online play (what the stand can take). */
export function heldGood(good: TradingGood): number {
  if (MATERIAL_GOODS.has(good)) return materialTotals(ONLINE_ONLY)[good as MaterialId] ?? 0;
  return Math.floor(getHarvested(goodKey(good), ONLINE_ONLY));
}

/**
 * Why `takeGood(good, qty)` failed, in words: goods gathered in offline
 * play are named as such so a player knows why they cannot trade them.
 */
export function shortGoodMessage(good: TradingGood, qty: number): string {
  const online = heldGood(good);
  const inPlay = MATERIAL_GOODS.has(good)
    ? materialTotals()[good as MaterialId] ?? 0
    : Math.floor(getHarvested(goodKey(good)));
  if (inPlay >= qty && online < qty) {
    return `Only ${online} of your ${good} were gathered online. Goods gathered offline stay in local play and can't be traded.`;
  }
  return `You don't have ${qty} ${good}.`;
}

/** Take `qty` units out of the bag. False (and nothing taken) when not enough is held. */
export function takeGood(good: TradingGood, qty: number): boolean {
  if (!Number.isSafeInteger(qty) || qty <= 0) return false;
  if (MATERIAL_GOODS.has(good)) return spendMaterials({ [good as MaterialId]: qty }, ONLINE_ONLY);
  return spendHarvested([{ symbol: goodKey(good), count: qty }], ONLINE_ONLY);
}

/** Put `qty` units into the online bag (a stand buy, or a refund of a stand spend). */
export function giveGood(good: TradingGood, qty: number): void {
  if (!Number.isSafeInteger(qty) || qty <= 0) return;
  recordHarvestForResource(good, qty, 'online');
}
