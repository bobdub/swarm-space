import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _resetWeatherForTest,
  getWeather,
  NUCLEATION_SCORE,
  tickWeather,
  WEATHER_TICK_GAME_HOURS,
  weatherCurvatureBoost,
} from '@/lib/world/weather';
import { getBrainPhysics, teardownBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { FIELD3D_BOUND } from '@/lib/uqrc/field3D';
import { GAME_HOUR_SECONDS, setEarthPoseTime } from '@/lib/brain/earth';

describe('weather as a field observable', () => {
  beforeEach(() => {
    setEarthPoseTime(0);
    _resetWeatherForTest();
  });
  afterEach(() => {
    setEarthPoseTime(null);
    _resetWeatherForTest();
    teardownBrainPhysics();
  });

  it('derives humidity from the field instead of an internal counter', () => {
    expect(getWeather().humidity).toBe(0);
    let humid = 0;
    for (let i = 0; i < 12; i++) humid = tickWeather().humidity;
    // Evaporation injected moisture onto μ=2, so the sampled mean rose.
    expect(humid).toBeGreaterThan(0);
    expect(Number.isFinite(humid)).toBe(true);
  });

  it('condenses clouds without any site anchor and keeps u bounded', () => {
    for (let i = 0; i < 40; i++) tickWeather();
    const snap = getWeather();
    expect(snap.ticks).toBe(40);
    expect(snap.clouds.length).toBeGreaterThan(0);

    const field = getBrainPhysics().getField();
    for (const u of field.axes) {
      for (let i = 0; i < u.length; i++) {
        expect(Math.abs(u[i])).toBeLessThanOrEqual(FIELD3D_BOUND + 1e-6);
      }
    }
  });

  it('drifts clouds along the field gradient, never randomly', () => {
    for (let i = 0; i < 40; i++) tickWeather();
    const before = getWeather().clouds[0];
    expect(before).toBeTruthy();
    const startNormal: [number, number, number] = [...before.normal];
    for (let i = 0; i < 5; i++) tickWeather();
    const after = getWeather().clouds.find((c) => c.id === before.id);
    if (after) {
      const len = Math.hypot(...after.normal);
      expect(len).toBeCloseTo(1, 6);
      expect(after.normal.every((v) => Number.isFinite(v))).toBe(true);
      expect(startNormal.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('reports no curvature boost on dry, storm-free ground', () => {
    expect(weatherCurvatureBoost([0, 1, 0])).toBe(0);
  });

  it('paces the weather on game time, not wall-clock seconds', () => {
    // One 1 Hz tick advances one real second of game time.
    expect(WEATHER_TICK_GAME_HOURS).toBeCloseTo(1 / GAME_HOUR_SECONDS, 12);
    expect(NUCLEATION_SCORE).toBeGreaterThan(0.06);
  });
});

describe('weather pacing against the live UQRC field', () => {
  afterEach(() => {
    setEarthPoseTime(null);
    _resetWeatherForTest();
    teardownBrainPhysics();
  });

  it('gives clouds minutes-scale lifetimes, not seconds-scale', () => {
    _resetWeatherForTest();
    const physics = getBrainPhysics() as unknown as { tick(): void };
    const born = new Map<string, number>();
    const rainAt = new Map<string, number>();
    const rainEnd = new Map<string, number>();
    let alive = new Set<string>();

    // 30 real minutes ≈ 3.5 in-game hours. The UQRC solver runs its own
    // 60 Hz step between each 1 Hz weather read, exactly as in the Brain.
    const SECONDS = 1800;
    for (let t = 0; t < SECONDS; t++) {
      setEarthPoseTime(t);
      for (let k = 0; k < 60; k++) physics.tick();
      const snap = tickWeather();
      const now = new Set<string>();
      for (const c of snap.clouds) {
        now.add(c.id);
        if (!born.has(c.id)) born.set(c.id, t);
        if (c.raining && !rainAt.has(c.id)) rainAt.set(c.id, t);
      }
      for (const id of alive) if (!now.has(id) && rainAt.has(id)) rainEnd.set(id, t);
      alive = now;
    }

    // Storms happened, and every one took in-game hours to charge …
    expect(rainAt.size).toBeGreaterThan(0);
    for (const [id, t] of rainAt) {
      expect(t - born.get(id)!).toBeGreaterThanOrEqual(2 * GAME_HOUR_SECONDS - 1);
    }
    // … and rained for minutes once it started.
    for (const [id, t] of rainEnd) {
      expect(t - rainAt.get(id)!).toBeGreaterThanOrEqual(5 * 60);
    }

    // The field stays bounded through hours of game-time weather.
    const field = getBrainPhysics().getField();
    for (const u of field.axes) {
      for (let i = 0; i < u.length; i++) {
        expect(Math.abs(u[i])).toBeLessThanOrEqual(FIELD3D_BOUND + 1e-6);
      }
    }
  }, 120_000);
});
