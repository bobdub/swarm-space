import { describe, it, expect, beforeEach, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: 'peer-a' }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => session }));

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
  updateLocalPlacement,
  patchLocalPlacementMeta,
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
    session.id = 'peer-a';
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

  it('rejects non-owner wall movement', async () => {
    acceptPeerPlacement(base('owned'));
    session.id = 'peer-b';
    const rec = listPlacements()[0];
    expect(await updateLocalPlacement({ ...rec, hitPoint: [8, 0, 0] })).toBeNull();
    expect(listPlacements()[0].hitPoint).toEqual([0, 0, 0]);
  });

  it('rejects non-owner wall decoration', async () => {
    acceptPeerPlacement(base('owned'));
    session.id = 'peer-b';
    expect(await patchLocalPlacementMeta('owned', { decoration: { postId: 'p', updatedAt: 2 } })).toBeNull();
    expect(listPlacements()[0].decoration).toBeUndefined();
  });

  it('rejects non-owner deletion and pickup', async () => {
    acceptPeerPlacement(base('owned'));
    session.id = 'peer-b';
    await removeLocalPlacement('owned');
    expect(listPlacements().map((r) => r.placementId)).toEqual(['owned']);
    expect(buildGlobalTombstoneSnapshot()).toEqual([]);
  });

  it('allows the maker to decorate a peer-cached wall', async () => {
    acceptPeerPlacement(base('owned'));
    expect((await patchLocalPlacementMeta('owned', { decoration: { postId: 'p', updatedAt: 2 } }))?.decoration?.postId).toBe('p');
  });

  it('accepts a peer deletion for a locally-held placement', async () => {
    await recordLocalPlacement(base('z') as never);
    acceptPeerPlacementDelete({ placementId: 'z', universeKey: 'global', deletedAt: Date.now() });
    expect(listPlacements()).toEqual([]);
  });
});