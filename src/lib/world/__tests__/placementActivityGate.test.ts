import { describe, it, expect, beforeEach, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: 'me' }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => session }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ removeBlock: () => {}, placeBlock: () => {} }),
}));
vi.mock('@/lib/world/placementController', () => ({
  placePrefabAtHit: () => null,
  poseTimeFromCreatedAt: (t: number) => t,
}));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({
  getSwarmMeshStandalone: () => ({ onMessage: () => () => {}, broadcast: () => {} }),
}));

import {
  acceptPeerPlacement,
  buildGlobalPlacementSnapshot,
  isPlacementSuppressed,
  listPlacements,
  mergePlacementSnapshot,
  setActiveUniverse,
  sweepIdlePlacements,
  touchLocalPlacement,
  _resetWorldPlacementsForTest,
} from '@/lib/world/worldPlacementsStore';
import { _acceptWallInteractionForTest, _resetWallInteractionsForTest } from '@/lib/world/wallInteractionsStore';
import { isPlacementIdle, MAIN_BRAIN_IDLE_MS } from '@/lib/world/placementActivity';
import { setBuilderRenderMode } from '@/lib/brain/builderRenderModeStore';
import { _resetUnsupportedPostsForTest, stopSupportingPost } from '@/lib/content/unsupportedPostsStore';

const DAY = 24 * 60 * 60 * 1000;
const rec = (id: string, actorId: string, ageMs: number, universeKey?: string) => ({
  placementId: id,
  prefabId: 'wall-oak',
  actorId,
  hitPoint: [0, 0, 0] as [number, number, number],
  yaw: 0,
  createdAt: Date.now() - ageMs,
  universeKey,
});

describe('Main Brain 5-day activity gate', () => {
  beforeEach(() => {
    session.id = 'me';
    localStorage.clear();
    _resetWorldPlacementsForTest();
    _resetWallInteractionsForTest();
    _resetUnsupportedPostsForTest();
    setBuilderRenderMode('stacked');
    setActiveUniverse('global');
  });

  it('peers do not carry a Main Brain placement idle for over 5 days', () => {
    acceptPeerPlacement(rec('old', 'peer', 6 * DAY));
    acceptPeerPlacement(rec('fresh', 'peer', 2 * DAY));
    expect(listPlacements().map((r) => r.placementId)).toEqual(['fresh']);
  });

  it('only gates the Main Brain, not project hubs or live rooms', () => {
    acceptPeerPlacement(rec('hub', 'peer', 30 * DAY, 'project-x'));
    setActiveUniverse('project-x');
    expect(listPlacements().map((r) => r.placementId)).toEqual(['hub']);
  });

  it('any wall interaction (view, tip, graffiti) counts as activity', () => {
    _acceptWallInteractionForTest({ id: 'v1', placementId: 'seen', kind: 'view', actorId: 'x', at: Date.now() - DAY });
    acceptPeerPlacement(rec('seen', 'peer', 20 * DAY));
    expect(listPlacements().map((r) => r.placementId)).toEqual(['seen']);
  });

  it('backfill carries wall-interaction activity to a newcomer', () => {
    _acceptWallInteractionForTest({ id: 'g1', placementId: 'busy', kind: 'graffiti', actorId: 'x', emoji: '🔥', at: Date.now() - DAY });
    acceptPeerPlacement(rec('busy', 'peer', 20 * DAY));
    const snap = buildGlobalPlacementSnapshot();
    // Newcomer: no interaction history.
    _resetWorldPlacementsForTest();
    _resetWallInteractionsForTest();
    expect(mergePlacementSnapshot(snap)).toBe(1);
    expect(listPlacements().map((r) => r.placementId)).toEqual(['busy']);
  });

  it('ignores activity stamps from the future', () => {
    expect(isPlacementIdle({ ...rec('x', 'peer', 9 * DAY), activityAt: Date.now() + 365 * DAY })).toBe(true);
  });

  it('keeps the author\'s own idle placement locally but does not seed it', () => {
    acceptPeerPlacement(rec('mine', 'me', 9 * DAY));
    expect(listPlacements().map((r) => r.placementId)).toEqual(['mine']);
    expect(buildGlobalPlacementSnapshot()).toEqual([]);
  });

  it('an author refresh makes it active again for peers', async () => {
    acceptPeerPlacement(rec('mine', 'me', 9 * DAY));
    await touchLocalPlacement('mine');
    const snap = buildGlobalPlacementSnapshot();
    expect(snap.map((r) => r.placementId)).toEqual(['mine']);
    // Another peer takes the refreshed record.
    _resetWorldPlacementsForTest();
    session.id = 'someone-else';
    expect(mergePlacementSnapshot(snap)).toBe(1);
    expect(listPlacements().map((r) => r.placementId)).toEqual(['mine']);
  });

  it('the sweep drops placements that went idle while held', () => {
    acceptPeerPlacement(rec('aging', 'peer', 4 * DAY));
    expect(sweepIdlePlacements(Date.now() + 2 * DAY)).toBe(1);
    expect(listPlacements()).toEqual([]);
    expect(MAIN_BRAIN_IDLE_MS).toBe(5 * DAY);
  });
});

describe('placement suppression', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetUnsupportedPostsForTest();
    setBuilderRenderMode('stacked');
  });

  it('Light mode suppresses every placement', () => {
    expect(isPlacementSuppressed({})).toBe(false);
    setBuilderRenderMode('light');
    expect(isPlacementSuppressed({})).toBe(true);
    expect(localStorage.getItem('brain:builder-render-mode:v1')).toBe('light');
    setBuilderRenderMode('stacked');
  });

  it('a wall pinning an unsupported post is suppressed', async () => {
    const wall = { decoration: { postId: 'p1', updatedAt: Date.now() } };
    expect(isPlacementSuppressed(wall)).toBe(false);
    await stopSupportingPost({ postId: 'p1', source: 'brain', manifestIds: [] });
    expect(isPlacementSuppressed(wall)).toBe(true);
  });
});
