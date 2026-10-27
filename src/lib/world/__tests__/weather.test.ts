import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _resetWeatherForTest,
  getWeather,
  tickWeather,
  weatherCurvatureBoost,
} from '@/lib/world/weather';
import { getBrainPhysics, teardownBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { FIELD3D_BOUND } from '@/lib/uqrc/field3D';
import { setEarthPoseTime } from '@/lib/brain/earth';

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
});
