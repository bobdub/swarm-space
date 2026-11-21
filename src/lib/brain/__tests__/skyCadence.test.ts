import { afterEach, describe, expect, it } from 'vitest';
import { ATMOSPHERE_RADIUS, EARTH_RADIUS, getEarthPose, setEarthPoseTime } from '../earth';
import { skyCadenceAt } from '../skyCadence';

const pose = { center: [0, 0, 0] as [number, number, number], sun: [1e9, 0, 0] as [number, number, number] };

describe('local sky cadence', () => {
  afterEach(() => setEarthPoseTime(null));

  it('has a bright opaque daytime atmosphere and hides stars on the sunlit side', () => {
    const sky = skyCadenceAt([EARTH_RADIUS, 0, 0], pose);
    expect(sky.daylight).toBe(1);
    expect(sky.atmosphereOpacity).toBeCloseTo(0.92);
    expect(sky.starOpacity).toBe(0);
    expect(sky.twilight).toBe(0);
  });

  it('reveals stars with a thin dark atmosphere when the Sun is across the planet', () => {
    const sky = skyCadenceAt([-EARTH_RADIUS, 0, 0], pose);
    expect(sky.solarElevation).toBe(-1);
    expect(sky.daylight).toBe(0);
    expect(sky.atmosphereOpacity).toBeCloseTo(0.08);
    expect(sky.starOpacity).toBeCloseTo(0.85);
    expect(sky.twilight).toBe(0);
  });

  it('warms the local horizon at sunset before astronomical stars emerge', () => {
    const sky = skyCadenceAt([0, EARTH_RADIUS, 0], pose);
    expect(sky.twilight).toBeCloseTo(1);
    expect(sky.daylight).toBeGreaterThan(0);
    expect(sky.daylight).toBeLessThan(1);
    expect(sky.starOpacity).toBe(0);
  });

  it('reveals stars gradually between civil and astronomical twilight', () => {
    const atDegrees = (degrees: number) => {
      const a = degrees * Math.PI / 180;
      return skyCadenceAt([Math.sin(a) * EARTH_RADIUS, Math.cos(a) * EARTH_RADIUS, 0], pose);
    };
    expect(atDegrees(-6).starOpacity).toBeCloseTo(0, 4);
    expect(atDegrees(-12).starOpacity).toBeGreaterThan(0.3);
    expect(atDegrees(-12).starOpacity).toBeLessThan(0.6);
    expect(atDegrees(-18).starOpacity).toBeCloseTo(0.85, 4);
    expect(atDegrees(-12).atmosphereOpacity).toBeGreaterThan(atDegrees(-18).atmosphereOpacity);
  });

  it('keeps space stars visible even above the sunlit hemisphere', () => {
    const sky = skyCadenceAt([ATMOSPHERE_RADIUS, 0, 0], pose);
    expect(sky.spaceMix).toBe(1);
    expect(sky.starOpacity).toBeCloseTo(0.85);
    expect(sky.atmosphereOpacity).toBeCloseTo(0.02);
  });

  it('uses translated shared Sun and Earth positions, not an origin or a calendar hour', () => {
    setEarthPoseTime(42);
    const live = getEarthPose();
    const d = live.sun.map((v, i) => v - live.center[i]);
    const length = Math.hypot(...d);
    const surface = (side: number): [number, number, number] => [
      live.center[0] + side * d[0] / length * EARTH_RADIUS,
      live.center[1] + side * d[1] / length * EARTH_RADIUS,
      live.center[2] + side * d[2] / length * EARTH_RADIUS,
    ];
    expect(skyCadenceAt(surface(1), live).starOpacity).toBeCloseTo(0, 12);
    expect(skyCadenceAt(surface(-1), live).starOpacity).toBeCloseTo(0.85);
  });
});