import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { groundElevationAt } from '../../groundHeight';
import { _resetDecksForTest } from '../deckSupport';
import { toBoatFrame } from '../boatDeck';
import { getVillageDockSite, starboardOf, travel } from '../dockSite';
import { BOAT_DRAFT } from '../boatSpec';
import {
  BOAT_MAX_SPEED,
  Vessel,
  _resetVillageBoatForTest,
  getVillageBoat,
  keelClearance,
  sailPolar,
  type HelmCommand,
} from '../vessel';
import {
  ROW_METRES_PER_FOOD,
  _resetCrewForTest,
  isOutOfFood,
  setCrewInput,
  setFoodPurse,
  takeRole,
} from '../crew';
import { OARS_SPOT, HELM_SPOT, deckWorldPos, mountVillageBoat, villageBoatFrame } from '../villageBoat';
import { _resetWeatherForTest, getWeather, tickWeather, windAt } from '@/lib/world/weather';
import { getBrainPhysics, teardownBrainPhysics } from '../../uqrcPhysics';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;
const DT = 1 / PHYSICS_HZ;
const CALM: Vec3 = [0, 0, 0];

function scale(v: Vec3, k: number): Vec3 { return [v[0] * k, v[1] * k, v[2] * k]; }
function angle(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

/** A boat out in open water off the berth, bow seaward. */
function openWaterBoat(): Vessel {
  const site = getVillageDockSite()!;
  const n = travel(site.boatCenter, site.boatHeading, 60);
  const h = site.boatHeading;
  const heading = (() => {
    const d = h[0] * n[0] + h[1] * n[1] + h[2] * n[2];
    const t: Vec3 = [h[0] - n[0] * d, h[1] - n[1] * d, h[2] - n[2] * d];
    const l = Math.hypot(...t);
    return [t[0] / l, t[1] / l, t[2] / l] as Vec3;
  })();
  return new Vessel('test', 0, { n, heading });
}

function run(v: Vessel, cmd: Partial<HelmCommand>, wind: Vec3 | ((v: Vessel) => Vec3), steps: number) {
  Object.assign(v.cmd, { wheel: 0, sail: 0, row: 0, rowTurn: 0 }, cmd);
  for (let i = 0; i < steps; i++) v.stepMotion(DT, typeof wind === 'function' ? wind(v) : wind);
}

describe('the wind the boat feels', () => {
  beforeEach(() => { setEarthPoseTime(1e7); _resetWeatherForTest(); });
  afterEach(() => { setEarthPoseTime(null); _resetWeatherForTest(); teardownBrainPhysics(); });

  it('is the wind the clouds ride at the same point', () => {
    const p = getBrainPhysics() as unknown as { tick(): void };
    for (let k = 0; k < 40; k++) { tickWeather(); for (let j = 0; j < 10; j++) p.tick(); }
    const cloud = getWeather().clouds[0];
    expect(cloud).toBeTruthy();
    const n0 = cloud.normal;
    tickWeather();
    const moved = getWeather().clouds.find((c) => c.id === cloud.id)!;
    // The tick's evaporation writes the field before the clouds drift, so
    // read the wind from the field as the cloud saw it: after the tick.
    const w = windAt(n0, cloud.altitude);
    expect(Math.hypot(...w)).toBeGreaterThan(0);
    const v: Vec3 = [n0[0] + w[0] / EARTH_RADIUS, n0[1] + w[1] / EARTH_RADIUS, n0[2] + w[2] / EARTH_RADIUS];
    const l = Math.hypot(...v);
    const expected: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    expect(angle(moved.normal, expected) * EARTH_RADIUS).toBeLessThan(1e-3);
  });
});

describe('sailing by wind, sail, keel and rudder', () => {
  it('sail polar: nothing inside 40° of the wind, best on a reach', () => {
    expect(sailPolar(0)).toBe(0);
    expect(sailPolar((39 * Math.PI) / 180)).toBe(0);
    expect(sailPolar(Math.PI / 2)).toBe(1);
    expect(sailPolar(Math.PI)).toBeCloseTo(0.7, 6);
  });

  it('no sail, no push', () => {
    const v = openWaterBoat();
    const n0 = v.motion.n;
    const wind = scale(starboardOf(v.motion.n, v.motion.heading), 2);
    run(v, { sail: 0 }, wind, 600);
    expect(Math.hypot(...v.motion.vel)).toBe(0);
    expect(angle(v.motion.n, n0)).toBe(0);
  });

  it('head to wind, no push', () => {
    const v = openWaterBoat();
    const wind = scale(v.motion.heading, -2); // blowing from dead ahead
    run(v, { sail: 1 }, wind, 600);
    expect(Math.hypot(...v.motion.vel)).toBeLessThan(1e-9);
  });

  it('no way on, no turn from the wheel', () => {
    const v = openWaterBoat();
    const h0 = v.motion.heading;
    run(v, { wheel: 1, sail: 0 }, CALM, 300);
    expect(angle(v.motion.heading, h0)).toBeLessThan(1e-6);
  });

  it('a beam reach in a normal wind (0.9 m/s field wind) sails at 6–9 m/s, and the wheel turns her', () => {
    const v = openWaterBoat();
    const beam = (b: Vessel) => scale(starboardOf(b.motion.n, b.motion.heading), 0.9);
    run(v, { sail: 1 }, beam, 60 * 40);
    expect(v.speed()).toBeGreaterThan(6);
    expect(v.speed()).toBeLessThan(9);
    // Sideways slip stays small: the keel.
    const s = starboardOf(v.motion.n, v.motion.heading);
    const slip = v.motion.vel[0] * s[0] + v.motion.vel[1] * s[1] + v.motion.vel[2] * s[2];
    expect(Math.abs(slip)).toBeLessThan(0.05);
    const h0 = v.motion.heading;
    run(v, { sail: 1, wheel: 1 }, beam, 60);
    expect(angle(v.motion.heading, h0)).toBeGreaterThan(0.25);
    // A gale is capped.
    run(v, { sail: 1 }, (b) => scale(starboardOf(b.motion.n, b.motion.heading), 5), 60 * 40);
    expect(Math.hypot(...v.motion.vel)).toBeLessThanOrEqual(BOAT_MAX_SPEED + 1e-9);
  });

  it('runs aground where the water is as shallow as her draft', () => {
    const site = getVillageDockSite()!;
    // Point the boat back up the jetty toward the beach and sail in.
    const v = new Vessel('test', 0, {
      n: site.boatCenter,
      heading: scale(site.boatHeading, -1),
    });
    const astern = (b: Vessel) => scale(b.motion.heading, 1.2); // wind from astern
    run(v, { sail: 1 }, astern, 60 * 120);
    expect(v.motion.aground).toBe(true);
    expect(Math.hypot(...v.motion.vel)).toBe(0);
    const clear = keelClearance(v.motion.n, v.motion.heading);
    expect(clear).toBeGreaterThan(-0.3);
    expect(clear).toBeLessThan(0.3);
    expect(-groundElevationAt(v.motion.n)).toBeGreaterThan(BOAT_DRAFT - 0.3);
    // Backing off works: back water with the oars.
    run(v, { row: -1 }, CALM, 60 * 10);
    expect(v.motion.aground).toBe(false);
  });

  it('a boat driven ashore under sail can be pushed off and sailed away', () => {
    const site = getVillageDockSite()!;
    const v = new Vessel('test', 0, { n: site.boatCenter, heading: scale(site.boatHeading, -1) });
    const astern = (b: Vessel) => scale(b.motion.heading, 1.2);
    run(v, { sail: 1 }, astern, 60 * 120);
    expect(v.motion.aground).toBe(true);
    // At the wheel alone she can't steer off: no way on.
    const stuckAt = v.motion.n;
    run(v, { sail: 1, wheel: 1 }, astern, 60 * 5);
    expect(v.motion.aground).toBe(true);
    expect(angle(v.motion.n, stuckAt) * EARTH_RADIUS).toBeLessThan(0.05);
    // Push off: she moves off into deeper water with the sail let down.
    const before = keelClearance(v.motion.n, v.motion.heading);
    expect(v.pushOff()).toBe(true);
    expect(v.cmd.sail).toBe(0);
    for (let i = 0; i < 60 * 4; i++) v.stepMotion(DT, astern(v));
    expect(v.motion.aground).toBe(false);
    expect(keelClearance(v.motion.n, v.motion.heading)).toBeGreaterThan(before + 0.2);
    expect(angle(v.motion.n, stuckAt) * EARTH_RADIUS).toBeGreaterThan(1.5);
    // Afloat, a push off does nothing.
    expect(v.pushOff()).toBe(false);
  });

  it('the oars can turn a grounded boat where she lies', () => {
    const site = getVillageDockSite()!;
    const v = new Vessel('test', 0, { n: site.boatCenter, heading: scale(site.boatHeading, -1) });
    run(v, { sail: 1 }, (b) => scale(b.motion.heading, 1.2), 60 * 120);
    expect(v.motion.aground).toBe(true);
    const h0 = v.motion.heading;
    run(v, { rowTurn: 1 }, CALM, 60 * 6);
    expect(angle(v.motion.heading, h0)).toBeGreaterThan(0.3);
  });
});

describe('aboard while she sails', () => {
  type P = UqrcPhysics & { tick(): void };
  let t = T0;
  let physics: P;
  let unmount: () => void;
  let food = 0;
  let wind: Vec3 | null = null;

  beforeEach(() => {
    t = T0;
    setEarthPoseTime(t); endEarthFrame(); beginEarthFrame();
    _resetVillageBoatForTest();
    _resetCrewForTest();
    food = 3;
    setFoodPurse({ has: () => food > 0, spendOne: () => (food > 0 ? (food--, true) : false) });
    physics = new UqrcPhysics() as P;
    wind = null;
    unmount = mountVillageBoat(physics, {
      wind: (n) => wind ? wind : scale(n, 0),
    });
  });
  afterEach(() => { unmount(); _resetDecksForTest(); _resetCrewForTest(); setEarthPoseTime(null); });

  function step(n: number, each?: () => void) {
    for (let i = 0; i < n; i++) {
      t += DT; setEarthPoseTime(t); endEarthFrame(); beginEarthFrame();
      each?.();
      physics.tick();
    }
  }
  function add(id: string, x: number, z: number) {
    physics.addBody({ id, kind: id === 'self' ? 'self' : 'avatar', pos: deckWorldPos(x, z)!, vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
  }
  function place(id: string) {
    const pose = getEarthPose();
    const b = physics.getBody(id)!;
    const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
    const { x, z } = toBoatFrame(villageBoatFrame()!, worldPosToLocalNormal(b.pos, pose), EARTH_RADIUS);
    return { x, z, feet: r - BODY_SHELL_RADIUS - FOOT_CUSHION };
  }

  it('the helmsman sails her off the berth and an idle passenger rides along', () => {
    add('self', 0, 2.5);
    add('guest', 0.3, -0.3);
    step(30);
    takeRole('helm', 'self');
    // Wind on the starboard beam, raise the sail with W, steer a little.
    const site = getVillageDockSite()!;
    wind = scale(starboardOf(site.boatCenter, site.boatHeading), 0.9);
    setCrewInput({ sail: 1 });
    const g0 = place('guest');
    const n0 = villageBoatFrame()!.center;
    let maxSlide = 0;
    step(60 * 20, () => {
      const g = place('guest');
      maxSlide = Math.max(maxSlide, Math.hypot(g.x - g0.x, g.z - g0.z));
    });
    const travelled = angle(villageBoatFrame()!.center, n0) * EARTH_RADIUS;
    expect(getVillageBoat().cmd.sail).toBe(1);
    expect(travelled).toBeGreaterThan(40);
    expect(maxSlide).toBeLessThan(0.1);
    const h = place('self');
    expect(Math.hypot(h.x - HELM_SPOT[0], h.z - HELM_SPOT[1])).toBeLessThan(0.05);
    expect(Math.abs(place('guest').feet - getVillageBoat().deckTopAt(t))).toBeLessThan(0.08);
  });

  it('rows at about 2 m/s in a calm, turns with one oar, and burns 1 Food per 60 m until it runs out', () => {
    add('self', 0, 1.2);
    step(30);
    takeRole('oars', 'self');
    setCrewInput({ row: 1 });
    const n0 = villageBoatFrame()!.center;
    step(60 * 30);
    const speed = getVillageBoat().speed();
    expect(speed).toBeGreaterThan(1.7);
    expect(speed).toBeLessThan(2.3);
    const metres = angle(villageBoatFrame()!.center, n0) * EARTH_RADIUS;
    expect(3 - food).toBe(Math.floor(metres / ROW_METRES_PER_FOOD));
    // Pull the starboard oar only: she turns at rest too.
    setCrewInput({ row: 0, rowTurn: 1 });
    const h0 = villageBoatFrame()!.heading;
    step(60 * 3);
    expect(angle(villageBoatFrame()!.heading, h0)).toBeGreaterThan(0.3);
    // Row on until the Food is gone: the oars stop pushing and the note shows.
    setCrewInput({ row: 1, rowTurn: 0 });
    step(60 * 120);
    expect(food).toBe(0);
    expect(isOutOfFood()).toBe(true);
    step(60 * 60);
    expect(getVillageBoat().speed()).toBeLessThan(0.2);
  });
});

void OARS_SPOT;
