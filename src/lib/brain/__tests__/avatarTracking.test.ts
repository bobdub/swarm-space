import { afterEach, describe, expect, it } from 'vitest';
import { avatarLocalTarget, avatarTrackingAlpha } from '../avatarTracking';
import { earthLocalToWorld, getEarthPose, setEarthPoseTime, worldDisplacementToEarthLocal, HUMAN_HEIGHT } from '../earth';
import { feetRadiusAt } from '../groundHeight';

afterEach(() => setEarthPoseTime(null));

describe('avatars follow the co-rotating surface', () => {
  it('keeps a stationary received target on the same soil between presence updates', () => {
    setEarthPoseTime(0);
    const original = getEarthPose();
    const local: [number, number, number] = [120, 220, 90];
    const target = avatarLocalTarget(earthLocalToWorld(local, original), original, true, false);
    for (const time of [0.016, 0.05, 0.1, 1, 30]) {
      setEarthPoseTime(time);
      const pose = getEarthPose();
      const world = earthLocalToWorld(target, pose);
      const recovered = worldDisplacementToEarthLocal([
        world[0] - pose.center[0], world[1] - pose.center[1], world[2] - pose.center[2],
      ], pose);
      recovered.forEach((value, axis) => expect(value).toBeCloseTo(local[axis], 8));
    }
  });

  it('grounds stale peers but preserves current raised poses and exact seats', () => {
    setEarthPoseTime(0);
    const pose = getEarthPose();
    const normal: [number, number, number] = [0, 1, 0];
    const floor = feetRadiusAt(normal) + HUMAN_HEIGHT / 2;
    const raised = earthLocalToWorld([0, floor + 4, 0], pose);
    expect(Math.hypot(...avatarLocalTarget(raised, pose, false, true))).toBeCloseTo(floor, 8);
    expect(Math.hypot(...avatarLocalTarget(raised, pose, false, false))).toBeCloseTo(floor + 4, 8);
    const seat = earthLocalToWorld([0, floor - 1, 0], pose);
    expect(Math.hypot(...avatarLocalTarget(seat, pose, true, true))).toBeCloseTo(floor - 1, 8);
  });

  it('never adds position lag to the self or a seated avatar', () => {
    for (const delta of [0, 1 / 120, 1 / 60, 0.1]) expect(avatarTrackingAlpha(delta, true)).toBe(1);
  });

  it('damps remote travel equally at 30, 60 and 120 frames per second', () => {
    const remaining = (fps: number) => Math.pow(1 - avatarTrackingAlpha(1 / fps, false), fps);
    expect(remaining(30)).toBeCloseTo(remaining(60), 12);
    expect(remaining(120)).toBeCloseTo(remaining(60), 12);
    expect(remaining(60)).toBeCloseTo(Math.exp(-12), 12);
  });

  it('keeps the same pace when the governor throttles a remote avatar to 8 Hz', () => {
    const remaining = (fps: number) => Math.pow(1 - avatarTrackingAlpha(1 / fps, false), fps);
    expect(remaining(8)).toBeCloseTo(remaining(60), 12);
    expect(remaining(20)).toBeCloseTo(remaining(60), 12);
  });

  it('treats bad deltas as no motion', () => {
    expect(avatarTrackingAlpha(-1, false)).toBe(0);
    expect(avatarTrackingAlpha(Number.NaN, false)).toBe(0);
  });
});