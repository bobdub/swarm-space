import { describe, it, expect, beforeEach, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: 'me', username: 'bob', displayName: 'Bobdub' as string | undefined }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => session }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ removeBlock: () => {}, placeBlock: () => {} }),
}));
vi.mock('@/lib/world/placementController', () => ({
  placePrefabAtHit: () => null,
  poseTimeFromCreatedAt: (t: number) => t,
}));

import { acceptPeerPlacement, listPlacements, recordLocalPlacement, setActiveUniverse, _resetWorldPlacementsForTest } from '@/lib/world/worldPlacementsStore';

const handle = (id: string) => ({
  placementId: id, anchorId: `anchor:${id}`, prefabId: 'trading_stand_wood', actorId: 'me',
  hitPoint: [0, 0, 0] as [number, number, number], placedAtPoseTime: 0, yaw: 0, createdAt: Date.now(),
});

describe("a placement carries its builder's name", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetWorldPlacementsForTest();
    setActiveUniverse('global');
  });

  it('stamps the display name, falling back to the username', async () => {
    expect((await recordLocalPlacement(handle('a'))).ownerName).toBe('Bobdub');
    session.displayName = undefined;
    expect((await recordLocalPlacement(handle('b'))).ownerName).toBe('bob');
  });

  it("keeps a peer's stamped name", () => {
    acceptPeerPlacement({ ...handle('c'), actorId: 'peer', ownerName: 'Ada' });
    expect(listPlacements().find((r) => r.placementId === 'c')?.ownerName).toBe('Ada');
  });
});
