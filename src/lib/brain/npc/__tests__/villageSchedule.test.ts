import { describe, it, expect } from 'vitest';
import {
  GAME_DAY_SECONDS,
  SHARED_VILLAGE_ISLAND_ANCHOR,
  getEarthLocalSiteFrame,
  getEarthPoseAt,
  getSunDirection,
  quatRotate,
} from '@/lib/brain/earth';
import { homeSpot, villageNoonSeconds, villagePlan, villageSolarHour, workDrives } from '../villageSchedule';
import { npcIdForName } from '../npcIdentity';
import { seedFromString } from '../personalitySeed';
import { INITIAL_NPCS } from '../seedCommunity';
import { register, _resetRegistryForTest } from '../npcRegistry';
import type { Npc } from '../npcTypes';

const SPEED = 4.8;
const villager = (name: string) => ({ name, seed: seedFromString(`npc:${name}`) });

function elevation(seconds: number): number {
  const pose = getEarthPoseAt(seconds);
  const n = quatRotate(pose.spinQuat, getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal);
  const s = getSunDirection(pose);
  return n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
}

/** Epoch seconds of solar `hour` on solar day `day`. */
const at = (day: number, hour: number) => villageNoonSeconds() + (day + (hour - 12) / 24) * GAME_DAY_SECONDS;

describe('village solar time', () => {
  it('puts noon at the highest sun and midnight at the lowest, months later too', () => {
    for (const day of [0, 40, 300]) {
      const noon = elevation(at(day, 12));
      for (const h of [6, 9, 15, 18]) expect(noon).toBeGreaterThan(elevation(at(day, h)));
      const midnight = elevation(at(day, 0));
      for (const h of [3, 9, 15, 21]) expect(midnight).toBeLessThan(elevation(at(day, h)));
    }
  });

  it('has the sun rising in the morning and setting in the evening', () => {
    expect(elevation(at(5, 9) + 60)).toBeGreaterThan(elevation(at(5, 9)));
    expect(elevation(at(5, 15) + 60)).toBeLessThan(elevation(at(5, 15)));
  });

  it('reads the hour back from epoch seconds', () => {
    expect(villageSolarHour(at(12, 7.25))).toBeCloseTo(7.25, 6);
  });
});

describe('villagePlan', () => {
  it('is the same answer for the same villager and instant', () => {
    const t = at(3, 8.3);
    expect(villagePlan(villager('Aria'), t, SPEED)).toEqual(villagePlan(villager('Aria'), t, SPEED));
  });

  it('keeps everyone at home asleep at night and in the circle at twilight', () => {
    for (const spec of INITIAL_NPCS) {
      const v = villager(spec.name);
      const night = villagePlan(v, at(9, 2), SPEED);
      expect(night.drive).toBe('rest');
      expect(night.arrived).toBe(true);
      expect({ tx: night.tx, tz: night.tz }).toEqual(homeSpot(spec.name));
      const dusk = villagePlan(v, at(9, 20), SPEED);
      expect(dusk.drive).toBe('socialise');
      expect(Math.hypot(dusk.tx, dusk.tz)).toBeCloseTo(3.5, 6);
    }
  });

  it('walks continuously: never faster than its speed, through a whole day', () => {
    const v = villager('Bren');
    let prev = villagePlan(v, at(4, 0), SPEED);
    let moved = 0;
    for (let s = 1; s <= GAME_DAY_SECONDS; s += 1) {
      const p = villagePlan(v, at(4, 0) + s, SPEED);
      const step = Math.hypot(p.tx - prev.tx, p.tz - prev.tz);
      expect(step).toBeLessThanOrEqual(SPEED + 1e-6);
      moved += step;
      prev = p;
    }
    expect(moved).toBeGreaterThan(50);
  });

  it('works at real resource sites by day and eats food it can find', () => {
    const v = villager('Cleo');
    const morning = villagePlan(v, at(6, 9), SPEED);
    const [w1, w2] = workDrives(v.seed);
    expect([w1, w2]).toContain(morning.drive);
    const dawn = villagePlan(v, at(6, 6.5), SPEED);
    expect(dawn.drive).toBe('drink');
    expect(dawn.siteId).toMatch(/^water-/);
  });

  it('always gives a villager one food-bringing work', () => {
    for (const spec of INITIAL_NPCS) {
      const [a, b] = workDrives(seedFromString(spec.baseString));
      expect(a).not.toBe(b);
      expect(['hunt', 'fish'].includes(a) || ['hunt', 'fish'].includes(b)).toBe(true);
    }
  });

  it('spreads the village out instead of moving in lockstep', () => {
    const spots = new Set(INITIAL_NPCS.map((s) => {
      const p = villagePlan(villager(s.name), at(2, 13), SPEED);
      return `${p.tx.toFixed(2)},${p.tz.toFixed(2)}`;
    }));
    expect(spots.size).toBeGreaterThan(4);
  });
});

describe('npc identity', () => {
  it('gives each starter a stable, distinct id', () => {
    const ids = INITIAL_NPCS.map((s) => npcIdForName(s.name));
    expect(new Set(ids).size).toBe(ids.length);
    expect(npcIdForName('Aria')).toBe(npcIdForName('Aria'));
  });

  it('refuses a second villager with a taken id instead of replacing the first', () => {
    _resetRegistryForTest();
    const make = (seedString: string): Npc => ({
      id: npcIdForName('Aria'), name: 'Aria', sex: 'female', seed: seedFromString(seedString),
      anchorPeerId: 'a', tx: 0, tz: 0, body: [], skills: {}, ageYears: 0, bornAt: '',
    });
    expect(register(make('one')).ok).toBe(true);
    expect(register(make('two'))).toEqual({ ok: false, reason: 'duplicate-id' });
    _resetRegistryForTest();
  });
});
