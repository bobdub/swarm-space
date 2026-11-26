/**
 * Trading goods in the player's material bag.
 *
 * Wood, Water, Stone, Fibre and Food are the material lens over the element
 * bag (`materials.ts`). Honey and Gems are their own goods, kept in the same
 * bag under `good:` keys. Every change goes through `spendHarvested` (via
 * `spendMaterials`) or `recordHarvestForResource`, so the bag stays the one
 * source of what a player holds.
 */
import { getHarvested, recordHarvestForResource, spendHarvested } from '@/lib/remix/harvestedInventory';
import { materialTotals, spendMaterials, type MaterialId } from '@/lib/world/materials';
import type { TradingGood } from './pricing';

const MATERIAL_GOODS: ReadonlySet<TradingGood> = new Set(['wood', 'water', 'stone', 'fibre', 'food']);
const goodKey = (good: TradingGood) => `good:${good}`;

/** Whole units of `good` the player holds. */
export function heldGood(good: TradingGood): number {
  if (MATERIAL_GOODS.has(good)) return materialTotals()[good as MaterialId] ?? 0;
  return Math.floor(getHarvested(goodKey(good)));
}

/** Take `qty` units out of the bag. False (and nothing taken) when not enough is held. */
export function takeGood(good: TradingGood, qty: number): boolean {
  if (!Number.isSafeInteger(qty) || qty <= 0) return false;
  if (MATERIAL_GOODS.has(good)) return spendMaterials({ [good as MaterialId]: qty });
  return spendHarvested([{ symbol: goodKey(good), count: qty }]);
}

/** Put `qty` units into the bag. */
export function giveGood(good: TradingGood, qty: number): void {
  if (!Number.isSafeInteger(qty) || qty <= 0) return;
  recordHarvestForResource(good, qty);
}
