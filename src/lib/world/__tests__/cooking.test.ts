/**
 * The fire pit's grill: raw food a player owns cooks over a burning fire,
 * cooked food rows further than raw Food, and the Trading Stand never
 * sells cooked food.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { _resetFireForTest, litThrough, recordFuel, BURN_MS_PER_WOOD } from '@/lib/world/fireStore';
import {
  COOKABLE_FOODS,
  GRILL_SLOTS,
  RAW_FOOD_ROW_METRES,
  _resetCookingForTest,
  cookableFor,
  eatCookedServing,
  grillJobs,
  heldCooked,
  heldRaw,
  settleGrill,
  startCooking,
} from '@/lib/world/cooking';
import { _resetHarvestedForTest, recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { TRADING_GOODS, isTradingGood } from '@/lib/world/tradingStand/pricing';
import {
  ROW_METRES_PER_FOOD,
  _resetCrewForTest,
  chargeRowing,
  setFoodPurse,
} from '@/lib/brain/sea/crew';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  _resetFireForTest();
  _resetHarvestedForTest();
  _resetCookingForTest();
  _resetCrewForTest();
});

describe('litThrough', () => {
  it('is true only while one unbroken fire covers the span', () => {
    recordFuel('pit', 'a', 1, T0);
    expect(litThrough('pit', T0, T0 + BURN_MS_PER_WOOD)).toBe(true);
    expect(litThrough('pit', T0, T0 + BURN_MS_PER_WOOD + 1)).toBe(false);
    // Out, then lit again: a span across the gap is not covered.
    recordFuel('pit', 'a', 1, T0 + BURN_MS_PER_WOOD + 10_000);
    expect(litThrough('pit', T0 + 1000, T0 + BURN_MS_PER_WOOD + 20_000)).toBe(false);
    expect(litThrough('pit', T0 + BURN_MS_PER_WOOD + 10_000, T0 + BURN_MS_PER_WOOD + 20_000)).toBe(true);
    expect(litThrough('other', T0, T0 + 1)).toBe(false);
  });
});

describe('grill', () => {
  it('cooks a fish the player owns over a burning fire', () => {
    recordHarvestForResource('fish', 2);
    recordFuel('pit', 'a', 1, T0);
    const fish = cookableFor('fish')!;
    const res = startCooking('pit', 'fish', T0 + 1000);
    expect(res.ok).toBe(true);
    expect(heldRaw('fish')).toBe(1);
    expect(grillJobs('pit')).toHaveLength(1);
    // Not done yet.
    expect(settleGrill(T0 + 1000 + fish.cookMs - 1)).toEqual([]);
    const done = settleGrill(T0 + 1000 + fish.cookMs);
    expect(done.map((d) => d.outcome)).toEqual(['cooked']);
    expect(heldCooked('cooked_fish')).toBe(1);
    expect(heldRaw('fish')).toBe(1);
    expect(grillJobs('pit')).toHaveLength(0);
  });

  it('needs a lit fire and raw food in the bag', () => {
    recordHarvestForResource('chicken', 1);
    expect(startCooking('pit', 'chicken', T0).reason).toBe('cold');
    recordFuel('pit', 'a', 1, T0);
    expect(startCooking('pit', 'shark', T0).reason).toBe('none');
    expect(startCooking('pit', 'wood', T0).reason).toBe('unknown');
    expect(startCooking('pit', 'chicken', T0).ok).toBe(true);
    expect(heldRaw('chicken')).toBe(0);
  });

  it('holds a few at a time', () => {
    recordHarvestForResource('egg', GRILL_SLOTS + 1);
    recordFuel('pit', 'a', 1, T0);
    for (let i = 0; i < GRILL_SLOTS; i++) expect(startCooking('pit', 'egg', T0 + i).ok).toBe(true);
    expect(startCooking('pit', 'egg', T0 + 10).reason).toBe('full');
    expect(heldRaw('egg')).toBe(1);
  });

  it('gives the food back raw when the fire goes out mid-cook', () => {
    recordHarvestForResource('shark', 1);
    recordFuel('pit', 'a', 1, T0);
    const start = T0 + BURN_MS_PER_WOOD - 5000;
    expect(startCooking('pit', 'shark', start).ok).toBe(true);
    expect(heldRaw('shark')).toBe(0);
    const done = settleGrill(T0 + BURN_MS_PER_WOOD + 1);
    expect(done.map((d) => d.outcome)).toEqual(['cold']);
    expect(heldRaw('shark')).toBe(1);
    expect(heldCooked('cooked_shark')).toBe(0);
  });
});

describe('cooked food and rowing', () => {
  it('every cooked meal rows further than a unit of raw Food', () => {
    expect(RAW_FOOD_ROW_METRES).toBe(ROW_METRES_PER_FOOD);
    for (const f of COOKABLE_FOODS) expect(f.rowMetres).toBeGreaterThan(RAW_FOOD_ROW_METRES);
  });

  it('a cooked serving sets a longer rowing leg than raw Food', () => {
    recordHarvestForResource('fish', 1);
    recordFuel('pit', 'a', 1, T0);
    startCooking('pit', 'fish', T0);
    settleGrill(T0 + cookableFor('fish')!.cookMs);
    let rawFood = 5;
    setFoodPurse({
      has: () => true,
      spendOne: () => eatCookedServing() || (rawFood > 0 ? (rawFood--, true) : false),
    });
    // First leg (60 m) ends: the cooked fish is eaten, so the next leg is long.
    expect(chargeRowing(ROW_METRES_PER_FOOD)).toBe(true);
    expect(heldCooked('cooked_fish')).toBe(0);
    expect(rawFood).toBe(5);
    expect(chargeRowing(cookableFor('fish')!.rowMetres - 1)).toBe(true);
    expect(rawFood).toBe(5);
    // Past the fish's leg, raw Food is eaten again, 60 m at a time.
    expect(chargeRowing(1)).toBe(true);
    expect(rawFood).toBe(4);
    expect(chargeRowing(ROW_METRES_PER_FOOD)).toBe(true);
    expect(rawFood).toBe(3);
  });

  it('eats the smallest cooked meal first, keeping the big ones', () => {
    recordHarvestForResource('shark', 1);
    recordHarvestForResource('egg', 1);
    recordFuel('pit', 'a', 1, T0);
    startCooking('pit', 'shark', T0);
    startCooking('pit', 'egg', T0);
    settleGrill(T0 + cookableFor('shark')!.cookMs);
    expect(eatCookedServing()).toBe(cookableFor('egg')!.rowMetres);
    expect(eatCookedServing()).toBe(cookableFor('shark')!.rowMetres);
    expect(eatCookedServing()).toBe(0);
  });
});

describe('Trading Stand', () => {
  it('sells raw food only: cooked food is not a trading good', () => {
    for (const f of COOKABLE_FOODS) {
      expect(isTradingGood(f.raw)).toBe(true);
      expect(isTradingGood(f.cooked)).toBe(false);
    }
    expect(TRADING_GOODS.some((g) => g.id.startsWith('cooked'))).toBe(false);
  });
});
