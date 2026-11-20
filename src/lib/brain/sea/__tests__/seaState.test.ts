import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { isSwimmingAt } from '../../groundHeight';
import { _resetDecksForTest } from '../deckSupport';
import { SEA_CALM, SEA_MAX, _resetVillageBoatForTest, seaStateFor, swellAt } from '../vessel';
import { getFleet } from '../fleet';
import { _resetCrewForTest } from '../crew';
import { deckWorldPos, mountVillageBoat } from '../villageBoat';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;
type P = UqrcPhysics & { tick(): void };

let t = T0;
beforeEach(() => {
  t = T0;
  setEarthPoseTime(t); endEarthFrame(); beginEarthFrame();
  _resetVillageBoatForTest();
  _resetCrewForTest();
});
afterEach(() => {
  _resetDecksForTest();
  _resetCrewForTest();
  setEarthPoseTime(null);
});

describe('the sea answers the weather', () => {
  it('builds with wind and rain, within bounds', () => {
    expect(seaStateFor(0)).toBe(SEA_CALM);
    expect(seaStateFor(1)).toBeCloseTo(1.5, 6);
    expect(seaStateFor(1, 0.85)).toBeGreaterThan(seaStateFor(1));
    expect(seaStateFor(4, 0.85)).toBe(SEA_MAX);
    // The swell is the calm swell scaled.
    expect(swellAt(12.3, 0.4, 3)).toBeCloseTo(3 * swellAt(12.3, 0.4), 9);
  });

  it('rises slowly under a squall and keeps a passenger on the deck', () => {
    const physics = new UqrcPhysics() as P;
    const squall = (n: Vec3): Vec3 => { void n; return [0, 0, 0]; };
    const unmount = mountVillageBoat(physics, { wind: squall, sea: () => 0.85 });
    const boat = getFleet().dock()!;
    physics.addBody({ id: 'self', kind: 'self', pos: deckWorldPos(0.2, -0.5)!, vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
    let worstGap = 0;
    let swam = false;
    let after1s = 0;
    for (let i = 0; i < 60 * 40; i++) {
      t += 1 / PHYSICS_HZ;
      setEarthPoseTime(t); endEarthFrame(); beginEarthFrame();
      physics.tick();
      if (i === 60) after1s = boat.vessel.sea;
      if (i < 60) continue;
      const pose = getEarthPose();
      const b = physics.getBody('self')!;
      const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
      const feet = r - BODY_SHELL_RADIUS - FOOT_CUSHION;
      worstGap = Math.max(worstGap, Math.abs(feet - boat.vessel.deckTopAt(t)));
      if (isSwimmingAt(worldPosToLocalNormal(b.pos, pose), feet)) swam = true;
    }
    // Slow to build (no lurch), then near the squall's sea.
    expect(after1s).toBeLessThan(1.3);
    expect(boat.vessel.sea).toBeGreaterThan(seaStateFor(0, 0.85) - 0.05);
    expect(swam).toBe(false);
    expect(worstGap).toBeLessThan(0.02);
    unmount();
  });
});
