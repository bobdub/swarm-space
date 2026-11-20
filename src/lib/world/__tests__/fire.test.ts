/**
 * Fire pits: a fire is a pure fold of shared fuel facts, so two peers that
 * hold the same facts agree on when it burns and when it goes out, and
 * lighting it spends exactly one gathered Wood.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import {
  BURN_MS_PER_WOOD,
  MAX_BURN_MS,
  _resetFireForTest,
  acceptPeerFireEvent,
  attachFireGossip,
  burnUntil,
  isFireLit,
  listFireEvents,
  mergeFireEvents,
  recordFuel,
  type FireEvent,
} from '@/lib/world/fireStore';
import { addWoodToFire } from '@/lib/world/fireActions';
import { _resetHarvestedForTest, recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { materialTotals } from '@/lib/world/materials';
import { getPrefab, FIRE_PIT_ID, listPrefabsBySection } from '@/lib/brain/prefabHouseCatalog';
import { prefabCost } from '@/lib/world/materials';
import { getToolAny } from '@/lib/brain/toolCatalog';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  _resetFireForTest();
  _resetHarvestedForTest();
});

describe('fire pit prefab', () => {
  it('is built from the Tools tab for Stone only, and is not a held tool', () => {
    expect(listPrefabsBySection('tools').map((p) => p.id)).toContain(FIRE_PIT_ID);
    expect(getPrefab(FIRE_PIT_ID)?.flammability).toBe(0);
    expect(prefabCost(FIRE_PIT_ID)).toEqual({ stone: 4 });
    expect(getToolAny(FIRE_PIT_ID)).toBeFalsy();
  });
});

describe('fireStore', () => {
  it('a cold pit lights for one Wood worth and goes out on its own', () => {
    expect(isFireLit('pit', T0)).toBe(false);
    recordFuel('pit', 'a', 1, T0);
    expect(burnUntil('pit')).toBe(T0 + BURN_MS_PER_WOOD);
    expect(isFireLit('pit', T0 + BURN_MS_PER_WOOD - 1)).toBe(true);
    expect(isFireLit('pit', T0 + BURN_MS_PER_WOOD)).toBe(false);
  });

  it('feeding a burning fire extends it, up to the cap', () => {
    recordFuel('pit', 'a', 1, T0);
    recordFuel('pit', 'b', 1, T0 + 1000);
    expect(burnUntil('pit')).toBe(T0 + 2 * BURN_MS_PER_WOOD);
    for (let i = 0; i < 20; i++) recordFuel('pit', 'a', 1, T0 + 2000 + i);
    expect(burnUntil('pit')).toBe(T0 + 2019 + MAX_BURN_MS);
  });

  it('two logs added in the same millisecond both count', () => {
    recordFuel('pit', 'a', 1, T0);
    recordFuel('pit', 'a', 1, T0);
    expect(listFireEvents()).toHaveLength(2);
    expect(burnUntil('pit')).toBe(T0 + 2 * BURN_MS_PER_WOOD);
  });

  it('wood on a pit that has gone out starts a new fire', () => {
    recordFuel('pit', 'a', 1, T0);
    const later = T0 + BURN_MS_PER_WOOD + 60_000;
    recordFuel('pit', 'a', 1, later);
    expect(burnUntil('pit')).toBe(later + BURN_MS_PER_WOOD);
  });

  it('two peers converge whatever order the facts arrive in', () => {
    const facts: FireEvent[] = [];
    attachFireGossip((e) => facts.push(e));
    recordFuel('pit', 'a', 1, T0);
    recordFuel('pit', 'b', 1, T0 + BURN_MS_PER_WOOD + 5);
    recordFuel('pit', 'c', 1, T0 + 2000);
    const mine = burnUntil('pit');

    _resetFireForTest();
    for (const e of [...facts].reverse()) acceptPeerFireEvent(e, T0 + 3000);
    expect(burnUntil('pit')).toBe(mine);

    _resetFireForTest();
    expect(mergeFireEvents(facts, T0 + 3000)).toBe(3);
    expect(mergeFireEvents(facts, T0 + 3000)).toBe(0);
    expect(burnUntil('pit')).toBe(mine);
  });

  it('relays a new peer fact once and drops repeats and forgeries', () => {
    const relayed: FireEvent[] = [];
    attachFireGossip((e) => relayed.push(e));
    const e: FireEvent = { id: `fuel:pit:${T0}:x`, kind: 'fuel', pitId: 'pit', actorId: 'x', wood: 1, at: T0 };
    expect(acceptPeerFireEvent(e, T0)).toBe(true);
    expect(acceptPeerFireEvent(e, T0)).toBe(false);
    expect(acceptPeerFireEvent({ ...e, wood: 500, id: `fuel:pit:${T0 + 1}:x`, at: T0 + 1 }, T0)).toBe(false);
    expect(acceptPeerFireEvent({ ...e, id: 'bogus' }, T0)).toBe(false);
    expect(acceptPeerFireEvent({ ...e, at: T0 + 3_600_000, id: `fuel:pit:${T0 + 3_600_000}:x` }, T0)).toBe(false);
    expect(relayed).toHaveLength(1);
    expect(listFireEvents()).toHaveLength(1);
  });
});

describe('addWoodToFire', () => {
  it('needs gathered Wood, spends exactly one, and lights the pit', () => {
    expect(addWoodToFire('pit', 'me')).toBe('no-wood');
    expect(isFireLit('pit')).toBe(false);

    recordHarvestForResource('wood', 2);
    const before = materialTotals().wood;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(addWoodToFire('pit', 'me')).toBe('lit');
    expect(materialTotals().wood).toBe(before - 1);
    expect(isFireLit('pit')).toBe(true);
  });

  it('refuses wood once the pit is full, without spending any', () => {
    const now = Date.now();
    for (let i = 0; i < MAX_BURN_MS / BURN_MS_PER_WOOD; i++) recordFuel('pit', 'a', 1, now - 10 + i);
    recordHarvestForResource('wood', 2);
    const before = materialTotals().wood;
    expect(addWoodToFire('pit', 'me')).toBe('full');
    expect(materialTotals().wood).toBe(before);
  });
});
