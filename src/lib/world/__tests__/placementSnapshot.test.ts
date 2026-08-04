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
  buildGlobalPlacementSnapshot,
  mergePlacementSnapshot,
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
});