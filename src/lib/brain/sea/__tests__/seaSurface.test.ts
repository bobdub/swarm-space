import { afterEach, describe, expect, it } from 'vitest';
import { GAME_DAY_SECONDS, LUNAR_CYCLE_DAYS, setEarthPoseTime, type Vec3 } from '../../earth';
import { SWIM_FEET_DEPTH, groundElevationAt, isSwimmingAt, supportElevationAt } from '../../groundHeight';
import {
  SEA_SWELL_GLSL,
  SEA_TIDE_GLSL,
  SWELL_TRAINS,
  TIDE_LUNAR_M,
  TIDE_MAX_M,
  TIDE_MIN_M,
  TIDE_SOLAR_M,
  deepWaterK,
  swellPhases,
  swellWaveCounts,
  tideAt,
  tideFrameAt,
} from '../seaSurface';
import { Vessel, swellAt } from '../vessel';

const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** A unit vector at right angles to `a`. */
function perp(a: Vec3): Vec3 {
  const c: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x: Vec3 = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const l = Math.hypot(...x);
  return [x[0] / l, x[1] / l, x[2] / l];
}

describe('sea surface', () => {
  afterEach(() => setEarthPoseTime(null));

  it('raises two lunar bulges and lowers the ring between', () => {
    const t = 1_234_567;
    const { moon } = tideFrameAt(t);
    const under = tideAt(moon, t);
    const far = tideAt(neg(moon), t);
    const side = tideAt(perp(moon), t);
    expect(under).toBeGreaterThan(TIDE_LUNAR_M * 0.5);
    expect(far).toBeGreaterThan(TIDE_LUNAR_M * 0.5);
    expect(side).toBeLessThan(0);
    for (const n of [moon, neg(moon), perp(moon)]) {
      const h = tideAt(n, t);
      expect(h).toBeLessThanOrEqual(TIDE_MAX_M + 1e-9);
      expect(h).toBeGreaterThanOrEqual(TIDE_MIN_M - 1e-9);
    }
  });

  it('is the same number on every peer for the same shared time', () => {
    const n: Vec3 = [0.3, 0.2, Math.sqrt(1 - 0.13)];
    expect(tideAt(n, 98_765.4)).toBe(tideAt([...n] as Vec3, 98_765.4));
    // The default reads the shared pose clock.
    setEarthPoseTime(5000);
    expect(tideAt(n)).toBe(tideAt(n, 5000));
  });

  it('brings two high waters a day at a fixed place', () => {
    const n: Vec3 = [1, 0, 0];
    const t0 = 3_000_000;
    let highs = 0;
    let prev = tideAt(n, t0 - 60);
    let rising = tideAt(n, t0) > prev;
    for (let s = 0; s <= GAME_DAY_SECONDS; s += 60) {
      const h = tideAt(n, t0 + s);
      const up = h > prev;
      if (rising && !up) highs++;
      rising = up;
      prev = h;
    }
    expect(highs).toBe(2);
  });

  it('swings between spring and neap tides through the month', () => {
    // Highest water anywhere on the planet, day by day.
    const highest = (t: number) => {
      let best = -Infinity;
      for (let i = 0; i < 400; i++) {
        const y = 1 - (2 * (i + 0.5)) / 400;
        const r = Math.sqrt(1 - y * y);
        const a = i * 2.399963229728653;
        best = Math.max(best, tideAt([Math.cos(a) * r, y, Math.sin(a) * r], t));
      }
      return best;
    };
    let spring = -Infinity;
    let neap = Infinity;
    for (let d = 0; d < LUNAR_CYCLE_DAYS; d += 0.5) {
      const h = highest(d * GAME_DAY_SECONDS);
      spring = Math.max(spring, h);
      neap = Math.min(neap, h);
    }
    // The Sun's tide adds to or takes from the Moon's as they turn.
    expect(spring - neap).toBeGreaterThan(0.03);
    expect(TIDE_SOLAR_M / TIDE_LUNAR_M).toBeCloseTo(0.46, 2);
  });

  it('floats swimmers on the tide in deep water', () => {
    const t = 777_000;
    setEarthPoseTime(t);
    const deep = findDeepWater();
    expect(isSwimmingAt(deep)).toBe(true);
    expect(supportElevationAt(deep)).toBeCloseTo(tideAt(deep, t) - SWIM_FEET_DEPTH, 9);
  });

  it('rides boats on the same tide', () => {
    const v = new Vessel('t', 0, { n: [0, 0, 1], heading: [1, 0, 0] });
    const t = 4_321;
    expect(v.waterlineAt(t)).toBeCloseTo(tideAt([0, 0, 1], t) + swellAt(t, 0, 1), 12);
  });

  it('swell trains follow the deep-water dispersion and close on themselves', () => {
    for (const train of SWELL_TRAINS) {
      const { n } = swellWaveCounts(train);
      expect(Number.isInteger(n)).toBe(true);
      expect(deepWaterK(train.omega)).toBeCloseTo((train.omega * train.omega) / 9.81, 12);
    }
    const p = swellPhases(1e9);
    for (const v of p) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 * Math.PI);
    }
    expect(SEA_TIDE_GLSL).toContain('seaTide');
    expect(SEA_SWELL_GLSL).toContain('seaSwellSlope');
    expect(SEA_SWELL_GLSL).not.toMatch(/NaN|Infinity/);
  });
});

function findDeepWater(): Vec3 {
  for (let i = 0; i < 2000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 2000;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963229728653;
    const n: Vec3 = [Math.cos(a) * r, y, Math.sin(a) * r];
    if (groundElevationAt(n) < -10) return n;
  }
  throw new Error('no deep water found');
}
