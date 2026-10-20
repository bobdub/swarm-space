import { afterEach, describe, expect, it } from 'vitest';
import { ownsPendingBuild, ownsPlacement } from '../buildOwnership';
import { stagePendingBuild, listPendingBuilds, removePendingBuild, updatePendingBuild, _resetPendingBuildsForTest } from '../pendingBuildsStore';
afterEach(_resetPendingBuildsForTest);
describe('private builder intent', () => {
  it('only grants wall controls to the maker', () => {
    expect(ownsPlacement({ actorId: 'a' }, 'a')).toBe(true);
    expect(ownsPlacement({ actorId: 'a' }, 'b')).toBe(false);
    expect(ownsPlacement({ actorId: 'a' }, '')).toBe(false);
  });
  it('only shows previews to their maker in the same room', () => {
    const rec = stagePendingBuild({ ownerId: 'a', universeKey: 'global', prefabId: 'wall', localDir: [0, 1, 0], yaw: 0, upOffset: 0 });
    expect(ownsPendingBuild(rec, 'a', 'global')).toBe(true);
    expect(ownsPendingBuild(rec, 'b', 'global')).toBe(false);
    expect(ownsPendingBuild(rec, 'a', 'project-other')).toBe(false);
    expect(ownsPendingBuild({}, 'a', 'global')).toBe(false);
  });
  it('blocks another account changing or removing a preview', () => {
    const rec = stagePendingBuild({ ownerId: 'a', universeKey: 'global', prefabId: 'wall', localDir: [0, 1, 0], yaw: 0, upOffset: 0 });
    updatePendingBuild(rec.id, { yaw: 1 }, 'b', 'global');
    removePendingBuild(rec.id, 'b', 'global');
    expect(listPendingBuilds()).toEqual([rec]);
    updatePendingBuild(rec.id, { yaw: 1 }, 'a', 'global');
    expect(listPendingBuilds()[0].yaw).toBe(1);
    removePendingBuild(rec.id, 'a', 'global');
    expect(listPendingBuilds()).toEqual([]);
  });
});