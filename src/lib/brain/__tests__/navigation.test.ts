import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS, getEarthPose, quatRotate, type EarthPose, type Vec3 } from '../earth';
import { getNorthFrame, unprojectFromMap } from '../mapProjection';
import {
  bearingTo, compassPoint, edgePin, formatBearing, formatDistance, headingFromCamera,
} from '../navigation';

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Smallest angle between two bearings (handles 0 ≡ 2π). */
const angleGap = (a: number | null, b: number) => {
  if (a === null) return Infinity;
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

function poseAtSpin(angle: number): EarthPose {
  const base = getEarthPose();
  const h = angle / 2;
  return { ...base, spinAngle: angle, spinQuat: [0, Math.sin(h), 0, Math.cos(h)], invSpinQuat: [0, -Math.sin(h), 0, Math.cos(h)] };
}

describe('navigation', () => {
  const here = norm([0.5, 0.35, 0.79]);
  const frame = getNorthFrame(here);

  it('measures bearing and distance to a target', () => {
    const ne = unprojectFromMap(frame, 300, 300);
    const r = bearingTo(frame, ne);
    expect(r.distanceM).toBeCloseTo(Math.hypot(300, 300), 6);
    expect(formatBearing(r.bearing)).toBe('045°');
    expect(compassPoint(r.bearing)).toBe('NE');
    const w = bearingTo(frame, unprojectFromMap(frame, -500, 0));
    expect(formatBearing(w.bearing)).toBe('270°');
    expect(compassPoint(w.bearing)).toBe('W');
  });

  it('formats distances for a sailor', () => {
    expect(formatDistance(42)).toBe('40 m');
    expect(formatDistance(640)).toBe('640 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12_400)).toBe('12 km');
  });

  it('pins an off-map point to the edge in its direction', () => {
    expect(edgePin(5000, 0, 280, 16)).toEqual([264, 140]);
    expect(edgePin(0, 5000, 280, 16)).toEqual([140, 16]);
    const [x, y] = edgePin(-900, -900, 280, 16);
    expect(x).toBeCloseTo(16, 9);
    expect(y).toBeCloseTo(264, 9);
  });

  it('reads the camera heading against true north at any spin', () => {
    for (const spin of [0, 1.1, 3]) {
      const pose = poseAtSpin(spin);
      const toWorld = (v: Vec3) => quatRotate(pose.spinQuat, v);
      const bodyLocal: Vec3 = [here[0] * EARTH_RADIUS, here[1] * EARTH_RADIUS, here[2] * EARTH_RADIUS];
      const w = toWorld(bodyLocal);
      const body: Vec3 = [pose.center[0] + w[0], pose.center[1] + w[1], pose.center[2] + w[2]];
      const up = toWorld(frame.up);
      expect(angleGap(headingFromCamera(toWorld(frame.north), up, body, pose), 0)).toBeLessThan(1e-6);
      expect(angleGap(headingFromCamera(toWorld(frame.east), up, body, pose), Math.PI / 2)).toBeLessThan(1e-6);
      // Looking straight down with the screen's top toward the west reads as facing west.
      const down: Vec3 = [-frame.up[0], -frame.up[1], -frame.up[2]];
      const west: Vec3 = [-frame.east[0], -frame.east[1], -frame.east[2]];
      expect(angleGap(headingFromCamera(toWorld(down), toWorld(west), body, pose), (3 * Math.PI) / 2)).toBeLessThan(1e-6);
    }
  });
});
