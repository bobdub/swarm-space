import { describe, it, expect, beforeEach } from 'vitest';
import { GAME_DAY_SECONDS, getEarthPoseAt, getSunDirection, quatRotate, type Vec3 } from '@/lib/brain/earth';
import { villageNoonSeconds } from '@/lib/brain/npc/villageSchedule';
import { arcMetres } from '@/lib/brain/sea/seaLife';
import { inHourWindow, solarHourAt } from '../wildClock';
import { beePoseAt, beeWorkingHours, BEE_TRIP_S, type V3 } from '../beeFlight';
import {
  HEN_COMMUTE_S,
  _resetChickensForTest,
  getHens,
  henLoopPoseAt,
  henPoseAt,
} from '@/lib/brain/land/chickens';
import { _resetNatureEventsForTest } from '@/lib/world/natureEventsStore';

function sunElevation(n: Vec3, seconds: number): number {
  const pose = getEarthPoseAt(seconds);
  const w = quatRotate(pose.spinQuat, n);
  const s = getSunDirection(pose);
  return w[0] * s[0] + w[1] * s[1] + w[2] * s[2];
}

/** Epoch seconds when it is solar `hour` at `n`, on or after day `day`. */
function whenHourAt(n: Vec3, day: number, hour: number): number {
  const base = villageNoonSeconds() + day * GAME_DAY_SECONDS;
  const now = solarHourAt(n, base);
  return base + ((((hour - now) % 24) + 24) % 24) / 24 * GAME_DAY_SECONDS;
}

beforeEach(() => {
  _resetNatureEventsForTest();
  _resetChickensForTest();
});

describe('wild solar clock', () => {
  it('puts local noon under the highest sun anywhere on the planet', () => {
    const points: Vec3[] = [[1, 0, 0], [0, 0.3, -0.95], [-0.6, -0.2, 0.77], [0.5, 0.5, 0.707]];
    for (const raw of points) {
      const l = Math.hypot(...raw);
      const n: Vec3 = [raw[0] / l, raw[1] / l, raw[2] / l];
      for (const day of [3, 120]) {
        const noon = whenHourAt(n, day, 12);
        expect(Math.abs(solarHourAt(n, noon) - 12)).toBeLessThan(1e-6);
        const peak = sunElevation(n, noon);
        for (const dh of [-2, -0.5, 0.5, 2]) {
          expect(peak).toBeGreaterThan(sunElevation(n, noon + (dh / 24) * GAME_DAY_SECONDS));
        }
      }
    }
  });

  it('wraps hour windows over midnight', () => {
    expect(inHourWindow(23, 19, 6)).toBe(true);
    expect(inHourWindow(3, 19, 6)).toBe(true);
    expect(inHourWindow(12, 19, 6)).toBe(false);
    expect(inHourWindow(12, 6, 19)).toBe(true);
  });
});

describe('hens keep a day', () => {
  const hens = () => getHens().filter((_, i) => i % 9 === 0);

  it('forage their loop at noon and roost by the nest at midnight', () => {
    for (const h of hens()) {
      const noon = whenHourAt(h.nest, 10, 12);
      const day = henPoseAt(h, noon);
      expect(day.roosting).toBe(false);
      expect(day.n).toEqual(henLoopPoseAt(h, noon).n);

      const midnight = whenHourAt(h.nest, 10, 0);
      const night = henPoseAt(h, midnight);
      expect(night.roosting).toBe(true);
      expect(arcMetres(night.n, h.nest)).toBeLessThan(h.rooster ? 1.5 : 0.8);
      // Still all night: the same spot an hour later.
      expect(henPoseAt(h, midnight + GAME_DAY_SECONDS / 24).n).toEqual(night.n);
    }
  });

  it('walks home at dusk and out at dawn without jumping', () => {
    for (const h of hens()) {
      for (const [from, to] of [[18.5, 20.5], [5, 7]] as const) {
        const t0 = whenHourAt(h.nest, 4, from);
        const t1 = t0 + ((to - from) / 24) * GAME_DAY_SECONDS;
        let prev = henPoseAt(h, t0).n;
        let changes = 0;
        for (let t = t0 + 0.25; t < t1; t += 0.25) {
          const p = henPoseAt(h, t);
          const step = arcMetres(prev, p.n);
          // A loop walk is under 1 m/s; the commute is a few metres in HEN_COMMUTE_S.
          expect(step).toBeLessThan(0.5);
          if (p.roosting !== henPoseAt(h, t - 0.25).roosting) changes++;
          prev = p.n;
        }
        expect(changes).toBe(1);
      }
    }
    expect(HEN_COMMUTE_S).toBeGreaterThan(0);
  });

  it('is the same on every peer', () => {
    const h = getHens()[5];
    const t = whenHourAt(h.nest, 2, 19.4);
    const a = henPoseAt(h, t);
    _resetChickensForTest();
    expect(henPoseAt(getHens()[5], t)).toEqual(a);
  });
});

describe('bees keep a day', () => {
  const door: V3 = [0, 2, 0];
  const flowers: V3[] = [[3, 0.5, 2], [-2, 0.5, 4], [4, 0.5, -3]];
  const hourOf = (seconds: number) => ((seconds / 3600) % 24 + 24) % 24; // a test dial: 1 h per hour

  it('fly by day and stay in the hive at night', () => {
    const count = 8;
    let flying = 0;
    for (let i = 0; i < count; i++) {
      expect(beePoseAt(i, count, 12 * 3600, door, flowers, hourOf).phase).not.toBe('home');
      expect(beePoseAt(i, count, 2 * 3600, door, flowers, hourOf).phase).toBe('home');
      if (beePoseAt(i, count, 12 * 3600, door, flowers).phase !== 'home') flying++;
    }
    expect(flying).toBe(count);
  });

  it('finish the trip they are on before going in', () => {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const { bed } = beeWorkingHours(i, count);
      let prev = beePoseAt(i, count, bed * 3600 - BEE_TRIP_S, door, flowers, hourOf);
      for (let t = bed * 3600 - BEE_TRIP_S + 0.1; t < bed * 3600 + BEE_TRIP_S * 2; t += 0.1) {
        const p = beePoseAt(i, count, t, door, flowers, hourOf);
        // Only ever goes in from resting at the door.
        if (p.phase === 'home' && prev.phase !== 'home') expect(prev.phase).toBe('rest');
        prev = p;
      }
      expect(prev.phase).toBe('home');
    }
  });

  it('come out at different times', () => {
    const wakes = new Set(Array.from({ length: 8 }, (_, i) => beeWorkingHours(i, 8).wake.toFixed(3)));
    expect(wakes.size).toBeGreaterThan(4);
  });
});
