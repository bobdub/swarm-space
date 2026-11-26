/**
 * Each stand is its own market whoever opens it: the modal reads the stand
 * and its owner from the stand, never from the viewer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  records: [] as { placementId: string; prefabId: string; actorId: string; ownerName?: string }[],
  blocks: new Map<string, { meta: Record<string, unknown> }>(),
}));
vi.mock('@/lib/world/worldPlacementsStore', () => ({
  listPlacements: () => h.records,
  subscribePlacements: () => () => {},
}));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ getBlock: (id: string) => h.blocks.get(id) }),
  blockWorldPos: () => [0, 0, 0],
}));

import { resolveStand } from '@/components/brain/TradingStandModal';
import { TRADING_STAND_ID } from '@/lib/brain/prefabHouseCatalog';
import { standVaultScope } from '@/lib/world/tradingStand/tradingStandStore';

beforeEach(() => { h.records = []; h.blocks.clear(); });

describe('resolveStand', () => {
  it("names a peer's stand after the peer, with its own vault", () => {
    h.records = [
      { placementId: 'mine', prefabId: TRADING_STAND_ID, actorId: 'me', ownerName: 'Me' },
      { placementId: 'theirs', prefabId: TRADING_STAND_ID, actorId: 'peer', ownerName: 'Peer' },
    ];
    expect(resolveStand('theirs')).toEqual({ placementId: 'theirs', ownerId: 'peer', ownerName: 'Peer' });
    expect(resolveStand('mine')?.ownerId).toBe('me');
    expect(standVaultScope('theirs').address).not.toBe(standVaultScope('mine').address);
  });

  it("falls back to the placed block's builder while the peer's record is on its way", () => {
    h.blocks.set(`${TRADING_STAND_ID}:theirs`, { meta: { placedBy: 'peer' } });
    expect(resolveStand('theirs')).toEqual({ placementId: 'theirs', ownerId: 'peer' });
  });

  it('knows no owner for an unknown stand, so nobody gets owner controls', () => {
    expect(resolveStand('ghost')).toBeNull();
  });
});
