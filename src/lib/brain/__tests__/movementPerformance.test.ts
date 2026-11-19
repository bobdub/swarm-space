import { describe, it, expect, vi } from 'vitest';
import { needsBoomClearance } from '../cameraClearance';
import { UqrcPhysics, WORLD_SIZE } from '../uqrcPhysics';
import { FIELD3D_N } from '../../uqrc/field3D';
import { groundWalkScaleAt, groundElevationAt } from '../groundHeight';
import { getEarthLocalSiteFrame } from '../earth';
import { WATER_WALK_SCALE } from '../surfaceProfile';

describe('movement work stays bounded without detaching world support', () => {
  it('never applies boom rescue to first-person eyes, including after transitions finish', () => {
    expect(needsBoomClearance(0, 0, 0)).toBe(false);
    for (const values of [[0.01, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      expect(needsBoomClearance(values[0], values[1], values[2])).toBe(true);
    }
  });

  it('does not recompose support for sub-cell motion but repins on crossing a cell', () => {
    const physics = new UqrcPhysics();
    const cell = WORLD_SIZE / FIELD3D_N;
    const previous: [number, number, number] = [cell * 5, cell * 5, cell * 5];
    const support = physics.pinSupportBasin(previous, 10);
    const unpin = vi.spyOn(physics, 'unpinSupportBasin');
    const pin = vi.spyOn(physics, 'pinSupportBasin');
    for (let tick = 0; tick < 60; tick++) {
      expect(physics.moveSupportBasin(support, previous, [previous[0] + tick / 60, previous[1], previous[2]], 10)).toBe(support);
    }
    expect(unpin).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    const moved = physics.moveSupportBasin(support, previous, [previous[0] + cell, previous[1], previous[2]], 10);
    expect(moved.id).not.toBe(support.id);
    expect(unpin).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(moved.cells.length).toBeGreaterThan(0);
  });

  it('gives the village full land speed from the drawn terrain, not the underlying ocean mask', () => {
    const normal = getEarthLocalSiteFrame('swarm-shared-village').normal;
    expect(groundElevationAt(normal)).toBeGreaterThan(1);
    expect(groundWalkScaleAt(normal)).toBe(1);
    let sea: [number, number, number] | undefined;
    for (let i = 0; i < 100; i++) {
      const y = 1 - (2 * (i + 0.5)) / 100;
      const r = Math.sqrt(1 - y * y);
      const normal: [number, number, number] = [Math.cos(i * 2.4) * r, y, Math.sin(i * 2.4) * r];
      if (groundElevationAt(normal) < -10) { sea = normal; break; }
    }
    expect(sea).toBeDefined();
    if (!sea) throw new Error('Expected deep ocean fixture');
    expect(groundWalkScaleAt(sea)).toBe(WATER_WALK_SCALE);
  });
});