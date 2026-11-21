import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
const self = vi.hoisted(() => ({ pos: [0, 0, 0] as [number, number, number] }));
vi.mock('@/lib/brain/uqrcPhysics', () => ({
  getBrainPhysics: () => ({ getBody: () => ({ pos: self.pos }) }),
}));
vi.mock('@/lib/world/swingFxBus', () => ({ emitImpactFx: vi.fn(), emitSwingFx: vi.fn() }));

import { EARTH_RADIUS, getEarthPose, getEarthPoseTime, quatRotate, type Vec3 } from '@/lib/brain/earth';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import { FOOD_PER_HEN, FOOD_PER_ROOSTER, _resetChickensForTest, getHens, henPoseAt, isHenAway } from '@/lib/brain/land/chickens';
import { _resetHarvestedForTest } from '@/lib/remix/harvestedInventory';
import { materialTotals } from '@/lib/world/materials';
import { _resetNatureEventsForTest, listNatureEvents } from '@/lib/world/natureEventsStore';
import { tryCatchNearbyHen, tryTakeNestEgg } from '@/lib/world/henHunting';
import { flockOf, nestEggs, FOOD_PER_EGG } from '@/lib/brain/land/chickens';

function standAt(n: Vec3): void {
  const pose = getEarthPose();
  const r = EARTH_RADIUS + groundElevationAt(n) + 0.9;
  const w = quatRotate(pose.spinQuat, [n[0] * r, n[1] * r, n[2] * r]);
  self.pos = [pose.center[0] + w[0], pose.center[1] + w[1], pose.center[2] + w[2]];
}

beforeEach(() => {
  _resetNatureEventsForTest();
  _resetChickensForTest();
  _resetHarvestedForTest();
});

describe('hunting hens with a knife', () => {
  for (const rooster of [false, true]) {
    it(`a knife next to a ${rooster ? 'rooster' : 'hen'} catches it for Food, and it is gone for everyone`, () => {
      const hen = getHens().find((h) => h.rooster === rooster)!;
      standAt(henPoseAt(hen, getEarthPoseTime()).n);
      const before = materialTotals().food ?? 0;
      expect(tryCatchNearbyHen('tool_knife_stone', 'me')).toBe(true);
      expect((materialTotals().food ?? 0) - before).toBe(rooster ? FOOD_PER_ROOSTER : FOOD_PER_HEN);
      const caught = listNatureEvents('chickens');
      expect(caught.length).toBe(1);
      expect(caught[0].kind).toBe('hen-caught');
      expect(caught[0].blockId).toBe(hen.id);
      expect(isHenAway(caught[0].blockId)).toBe(true);
    });
  }

  it('other tools, or no hen in reach, leave the swing alone', () => {
    const hen = getHens()[0];
    standAt(henPoseAt(hen, getEarthPoseTime()).n);
    expect(tryCatchNearbyHen('tool_axe_stone', 'me')).toBe(false);
    standAt([0, -1, 0]);
    expect(tryCatchNearbyHen('tool_knife_stone', 'me')).toBe(false);
    expect(listNatureEvents('chickens').length).toBe(0);
  });

  it('standing at a nest with an egg, any tool takes it for Food', () => {
    const hen = getHens().find((h) => !h.rooster)!;
    let now = Date.UTC(2026, 10, 21, 12);
    while (nestEggs(flockOf(hen), now).length === 0) now += 10_000;
    standAt(hen.nest);
    const before = materialTotals().food ?? 0;
    expect(tryTakeNestEgg('tool_axe_stone', 'me', now)).toBe(true);
    expect((materialTotals().food ?? 0) - before).toBe(FOOD_PER_EGG);
    const taken = listNatureEvents('chickens');
    expect(taken.length).toBe(1);
    expect(taken[0].kind).toBe('egg-taken');
    standAt([0, -1, 0]);
    expect(tryTakeNestEgg('tool_axe_stone', 'me', now)).toBe(false);
  });
});
