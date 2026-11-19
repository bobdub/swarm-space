import { describe, it, expect, afterEach } from 'vitest';
import {
  BODY_CENTER_HEIGHT,
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  beginEarthFrame,
  earthLocalToWorld,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { JETTY_TOP, JETTY_WIDTH, getVillageDockSite, travel } from '../dockSite';
import { _resetDecksForTest, registerDeckSurface, straightDeck } from '../deckSupport';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;

function walkerAt(localN: [number, number, number]) {
  const p = new UqrcPhysics();
  setEarthPoseTime(T0);
  endEarthFrame();
  const pose = getEarthPose();
  const r = BODY_SHELL_RADIUS + JETTY_TOP + 0.05;
  const w = earthLocalToWorld([localN[0] * r, localN[1] * r, localN[2] * r], pose);
  p.addBody({
    id: 'self', kind: 'self', pos: [...w] as [number, number, number],
    vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' },
  });
  return p;
}

function feet(p: UqrcPhysics) {
  const pose = getEarthPose();
  const b = p.getBody('self')!;
  const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
  return { feet: r - BODY_CENTER_HEIGHT - EARTH_RADIUS, n: worldPosToLocalNormal(b.pos, pose) };
}

describe('standing on the jetty', () => {
  afterEach(() => { _resetDecksForTest(); setEarthPoseTime(null); });

  it('holds an idle walker on the planks over the water', () => {
    const site = getVillageDockSite()!;
    registerDeckSurface(straightDeck({
      id: 'jetty', start: site.jettyStart, dir: site.jettyDir,
      length: site.jettyLength, width: JETTY_WIDTH, top: JETTY_TOP, radius: EARTH_RADIUS,
    }));
    const spot = travel(site.jettyStart, site.jettyDir, site.jettyLength - 12);
    const p = walkerAt(spot);
    const tick = (p as unknown as { tick(): void }).tick.bind(p);
    let lowest = Infinity;
    for (let i = 0; i < PHYSICS_HZ * 6; i++) {
      setEarthPoseTime(T0 + (i + 1) / PHYSICS_HZ);
      endEarthFrame(); beginEarthFrame();
      tick();
      if (i > PHYSICS_HZ) lowest = Math.min(lowest, feet(p).feet);
    }
    expect(lowest).toBeGreaterThan(JETTY_TOP - 1e-3);
  });
});
