import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ removeBlock: () => {}, placeBlock: () => {} }),
}));
vi.mock('@/lib/world/placementController', () => ({
  placePrefabAtHit: () => null,
  poseTimeFromCreatedAt: (t: number) => t,
}));

import {
  acceptPeerPlacement,
  acceptPeerPlacementDelete,
  buildGlobalPlacementSnapshot,
  buildGlobalTombstoneSnapshot,
  mergePlacementSnapshot,
  removeLocalPlacement,
  recordLocalPlacement,
  listPlacements,
  setActiveUniverse,
  _resetWorldPlacementsForTest,
} from '@/lib/world/worldPlacementsStore';

const base = (id: string, universeKey?: string) => ({
  placementId: id,
  prefabId: 'wall-oak',
  actorId: 'peer-a',
  hitPoint: [0, 0, 0] as [number, number, number],
  yaw: 0,
  createdAt: 1,
  universeKey,
});

describe('lobby placement backfill', () => {
  beforeEach(() => {
    _resetWorldPlacementsForTest();
    setActiveUniverse('global');
  });

  it('snapshot contains only global-scoped placements', () => {
    acceptPeerPlacement(base('a'));
    acceptPeerPlacement(base('b', 'project-x'));
    acceptPeerPlacement(base('c', 'liveroom-1'));
    const snap = buildGlobalPlacementSnapshot();
    expect(snap.map((r) => r.placementId)).toEqual(['a']);
  });

  it('merge discards non-global entries', () => {
    mergePlacementSnapshot([base('g'), base('p', 'project-x')]);
    expect(listPlacements().map((r) => r.placementId)).toEqual(['g']);
    setActiveUniverse('project-x');
    expect(listPlacements()).toEqual([]);
  });

  it('deleted placements stay deleted through peer backfill', async () => {
    await recordLocalPlacement(base('w') as never);
    expect(listPlacements().map((r) => r.placementId)).toEqual(['w']);
    await removeLocalPlacement('w');
    expect(listPlacements()).toEqual([]);

    // Peer still holds the wall — backfill must not resurrect it.
    mergePlacementSnapshot([base('w')]);
    expect(listPlacements()).toEqual([]);
    acceptPeerPlacement(base('w'));
    expect(listPlacements()).toEqual([]);

    // The deletion is shared with peers.
    expect(buildGlobalTombstoneSnapshot().map((t) => t.placementId)).toEqual(['w']);
    expect(buildGlobalPlacementSnapshot()).toEqual([]);
  });

  it('accepts a peer deletion for a locally-held placement', async () => {
    await recordLocalPlacement(base('z') as never);
    acceptPeerPlacementDelete({ placementId: 'z', universeKey: 'global', deletedAt: Date.now() });
    expect(listPlacements()).toEqual([]);
  });
});