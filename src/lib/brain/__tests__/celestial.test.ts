import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  EARTH_EPOCH_MS,
  EARTH_ORBIT_PERIOD,
  EARTH_SPIN_PERIOD,
  GAME_DAY_SECONDS,
  GAME_DAYS_PER_REAL_DAY,
  GAME_HOUR_SECONDS,
  LUNAR_CYCLE_DAYS,
  MOON_ORBIT_RADIUS,
  SOLAR_ORBIT_PERIOD,
  SUN_POSITION,
  endEarthFrame,
  getEarthPose,
  getEarthPoseAt,
  getEarthPoseTime,
  getMoonDirectionAt,
  getMoonIllumination,
  getSunDirectionAt,
  quatRotate,
  setEarthPoseTime,
  type Vec3,
} from '../earth';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Earth-local surface normal at latitude `latDeg` on the local +X meridian. */
function localNormal(latDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat), Math.sin(lat), 0];
}

/** Count horizon crossings of a body (sun/moon) seen from a fixed surface site. */
function countRisesAndSets(
  site: Vec3,
  dirAt: (t: number) => Vec3,
  from: number,
  to: number,
  step: number,
): { rises: number; sets: number } {
  let rises = 0;
  let sets = 0;
  let prev: number | null = null;
  for (let t = from; t <= to; t += step) {
    const pose = getEarthPoseAt(t);
    const up = quatRotate(pose.spinQuat, site);
    const h = dot(up, dirAt(t));
    if (prev !== null) {
      if (prev <= 0 && h > 0) rises++;
      if (prev > 0 && h <= 0) sets++;
    }
    prev = h;
  }
  return { rises, sets };
}

describe('shared celestial time (one sky for every peer)', () => {
  afterEach(() => {
    vi.useRealTimers();
    endEarthFrame();
    setEarthPoseTime(null);
  });

  it('defines one game week per real day in one place', () => {
    expect(GAME_DAYS_PER_REAL_DAY).toBe(7);
    expect(GAME_DAY_SECONDS).toBeCloseTo(12342.857, 3);
    expect(GAME_DAY_SECONDS * 7).toBeCloseTo(86400, 6);
    expect(GAME_HOUR_SECONDS * 24).toBeCloseTo(GAME_DAY_SECONDS, 9);
  });

  it('two peers with different local runtimes agree on the sky at the same epoch', () => {
    const T = 3 * 86400 + 1234.5; // a fixed moment, seconds after the epoch
    vi.useFakeTimers();

    // Peer A booted long ago: its local clocks have run for hours.
    vi.setSystemTime(EARTH_EPOCH_MS + (T - 7200) * 1000);
    getEarthPoseAt(getEarthPoseTime());
    vi.advanceTimersByTime(7200 * 1000);
    endEarthFrame();
    const peerA = getEarthPose();

    // Peer B boots right now with fresh local clocks.
    endEarthFrame();
    vi.setSystemTime(EARTH_EPOCH_MS + T * 1000);
    const peerB = getEarthPose();

    for (const key of ['center', 'sun', 'moon'] as const) {
      expect(dist(peerA[key], peerB[key])).toBeLessThan(1e-6);
    }
    expect(peerA.spinAngle).toBeCloseTo(peerB.spinAngle, 9);
    expect(dist(getMoonDirectionAt(T), getMoonDirectionAt(T))).toBe(0);
  });

  it('keeps the boot sky: at the epoch the Sun sits where it always did', () => {
    const pose = getEarthPoseAt(0);
    expect(dist(pose.sun, SUN_POSITION)).toBeLessThan(1e-6);
  });

  it('moves the whole solar system: nothing in the sky is static', () => {
    const a = getEarthPoseAt(1000);
    const b = getEarthPoseAt(1000 + GAME_HOUR_SECONDS);
    expect(dist(a.sun, b.sun)).toBeGreaterThan(1);
    expect(dist(a.moon, b.moon)).toBeGreaterThan(1);
    expect(dist(a.center, b.center)).toBeGreaterThan(1);
  });

  it('keeps the galactic orbit unchanged and Earth circling the Sun at a fixed distance', () => {
    const start = getEarthPoseAt(0);
    const lap = getEarthPoseAt(EARTH_ORBIT_PERIOD);
    expect(EARTH_ORBIT_PERIOD).toBe(21600);
    expect(dist(start.center, lap.center)).toBeLessThan(1e-6);

    const r0 = dist(start.center, start.sun);
    for (const t of [1e4, 5e5, 2e6, SOLAR_ORBIT_PERIOD / 3]) {
      const p = getEarthPoseAt(t);
      expect(dist(p.center, p.sun)).toBeCloseTo(r0, 6);
    }
    // One revolution around the Sun per in-game year.
    const y = getEarthPoseAt(SOLAR_ORBIT_PERIOD);
    expect(dist(getSunDirectionAt(0), getSunDirectionAt(SOLAR_ORBIT_PERIOD))).toBeLessThan(1e-6);
    expect(dist(y.center, y.sun)).toBeCloseTo(r0, 6);
  });

  it('has a solar day of exactly one in-game day (sidereal spin)', () => {
    expect(EARTH_SPIN_PERIOD).toBeLessThan(GAME_DAY_SECONDS);
    const site = localNormal(0);
    for (const t0 of [0, 2.5e5, 9e5]) {
      const p0 = getEarthPoseAt(t0);
      const p1 = getEarthPoseAt(t0 + GAME_DAY_SECONDS);
      const h0 = dot(quatRotate(p0.spinQuat, site), getSunDirectionAt(t0));
      const h1 = dot(quatRotate(p1.spinQuat, site), getSunDirectionAt(t0 + GAME_DAY_SECONDS));
      expect(h1).toBeCloseTo(h0, 6);
    }
  });

  it('gives one sunrise and one sunset per in-game day', () => {
    const days = 7;
    for (const lat of [0, 15, -20]) {
      for (const offset of [0, 1.3e6]) {
        const { rises, sets } = countRisesAndSets(
          localNormal(lat),
          getSunDirectionAt,
          offset,
          offset + days * GAME_DAY_SECONDS,
          30,
        );
        expect(rises).toBe(days);
        expect(sets).toBe(days);
      }
    }
  });

  it('gives about one moonrise and one moonset per in-game day', () => {
    // A prograde Moon rises a little later each day, like the real one:
    // over one lunar cycle there is one fewer moonrise than days.
    const days = LUNAR_CYCLE_DAYS;
    const { rises, sets } = countRisesAndSets(
      localNormal(0),
      getMoonDirectionAt,
      0,
      days * GAME_DAY_SECONDS,
      60,
    );
    expect(rises).toBeGreaterThanOrEqual(days - 2);
    expect(rises).toBeLessThanOrEqual(days);
    expect(Math.abs(rises - sets)).toBeLessThanOrEqual(1);
    for (let d = 0; d < 7; d++) {
      const day = countRisesAndSets(
        localNormal(0),
        getMoonDirectionAt,
        d * GAME_DAY_SECONDS,
        (d + 1) * GAME_DAY_SECONDS,
        60,
      );
      expect(day.rises).toBeLessThanOrEqual(1);
      expect(day.sets).toBeLessThanOrEqual(1);
    }
  });

  it('cycles the Moon through its phases every 28 in-game days', () => {
    const cycle = LUNAR_CYCLE_DAYS * GAME_DAY_SECONDS;
    const t0 = 4e5;
    const k0 = getMoonIllumination(getEarthPoseAt(t0));
    const k1 = getMoonIllumination(getEarthPoseAt(t0 + cycle));
    // The tilted lunar orbit makes successive cycles differ slightly, as
    // on the real Moon; the phase still repeats every lunar cycle.
    expect(Math.abs(k1 - k0)).toBeLessThan(0.02);

    let min = 1;
    let max = 0;
    for (let d = 0; d < LUNAR_CYCLE_DAYS; d += 0.25) {
      const k = getMoonIllumination(getEarthPoseAt(t0 + d * GAME_DAY_SECONDS));
      min = Math.min(min, k);
      max = Math.max(max, k);
    }
    expect(min).toBeLessThan(0.3);
    expect(max).toBeGreaterThan(0.7);
  });

  it('keeps the Moon on its orbit around Earth', () => {
    for (const t of [0, 1e3, 1e5, 3e6]) {
      const p = getEarthPoseAt(t);
      expect(dist(p.center, p.moon)).toBeCloseTo(MOON_ORBIT_RADIUS, 6);
    }
  });
});
