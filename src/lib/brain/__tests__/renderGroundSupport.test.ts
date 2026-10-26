import { afterEach, describe, expect, it } from 'vitest';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { BODY_CENTER_HEIGHT, EARTH_RADIUS, getEarthPose, quatRotate, setEarthPoseTime, type Vec3 } from '../earth';
import { feetRadiusAt, groundElevationAt } from '../groundHeight';
import { getBarGroundNormal } from '../barTerrain';

afterEach(() => setEarthPoseTime(null));

function setup(normal: Vec3, radius: number) {
  setEarthPoseTime(0);
  const physics = new UqrcPhysics();
  const pose = getEarthPose();
  const local: Vec3 = normal.map(value => value * radius) as Vec3;
  const relative = quatRotate(pose.spinQuat, local);
  physics.addBody({ id: 'self', kind: 'self', pos: relative.map((value, i) => value + pose.center[i]) as Vec3,
    vel: [0, 0, 0], mass: 1.8, trust: 1, meta: { attachedTo: 'earth-surface' } });
  return { physics, pose, local };
}

function renderRadius(physics: UqrcPhysics) {
  const result = physics.getBodyRenderPos('self', 500 / PHYSICS_HZ);
  if (!result) throw new Error('Missing render pose');
  const pose = getEarthPose();
  return Math.hypot(...result.map((value, i) => value - pose.center[i]));
}

describe('shared camera/avatar ground support', () => {
  it('keeps feet on dry bar ground even before the first physics tick', () => {
    const normal = getBarGroundNormal();
    const { physics } = setup(normal, EARTH_RADIUS);
    const body = physics.getBody('self');
    if (!body) throw new Error('Missing body');
    const authoritative = [...body.pos];
    expect(renderRadius(physics) - BODY_CENTER_HEIGHT).toBeCloseTo(feetRadiusAt(normal), 7);
    expect(body.pos).toEqual(authoritative);
  });

  it('checks the interpolated direction against its own ground, not the endpoint floors', () => {
    const normal = getBarGroundNormal();
    const floor = feetRadiusAt(normal) + BODY_CENTER_HEIGHT;
    const { physics } = setup(normal, floor);
    const body = physics.getBody('self');
    if (!body) throw new Error('Missing body');
    const tangent: Vec3 = [-normal[2], 0, normal[0]];
    const length = Math.hypot(...tangent);
    const angle = 0.05;
    const endpoint = (sign: number): Vec3 => normal.map((value, i) =>
      floor * (value * Math.cos(angle) + sign * tangent[i] / length * Math.sin(angle))) as Vec3;
    body.prevPos = [...body.pos];
    body.prevLocal = endpoint(-1);
    body.local = endpoint(1);
    expect(renderRadius(physics) - BODY_CENTER_HEIGHT).toBeCloseTo(feetRadiusAt(normal), 7);
  });

  it('keeps an underwater floor below sea level rather than lifting walkers onto water', () => {
    const normal: Vec3 = [-1, 0, 0];
    expect(groundElevationAt(normal)).toBeLessThan(0);
    const { physics } = setup(normal, EARTH_RADIUS - 10);
    expect(renderRadius(physics) - BODY_CENTER_HEIGHT).toBeCloseTo(feetRadiusAt(normal), 7);
    expect(renderRadius(physics) - BODY_CENTER_HEIGHT).toBeLessThan(EARTH_RADIUS);
  });

  it('preserves above-ground height and exclusive spaceship positions', () => {
    const normal = getBarGroundNormal();
    const { physics } = setup(normal, EARTH_RADIUS + 100);
    expect(renderRadius(physics)).toBeCloseTo(EARTH_RADIUS + 100, 7);
    const lease = physics.acquireBodyControl('self');
    if (!lease) throw new Error('Missing body lease');
    lease.update([1, 2, 3]);
    expect(physics.getBodyRenderPos('self', 0)).toEqual([1, 2, 3]);
    lease.release();
  });
});