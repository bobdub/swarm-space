import { describe, expect, it } from 'vitest';
import {
  barStoolOffsets,
  barStoolTableId,
  barTableForStool,
  counterColliderOffsets,
  isBarStoolTable,
} from '../barStools';
import { solidRadiusFor } from '@/lib/brain/uqrcPhysics';
import { findBarInteractionByTag } from '@/lib/world/barInteractions';

describe('bar counter stools', () => {
  it('spread along the whole 10 m counter', () => {
    const xs = barStoolOffsets(10);
    expect(xs.length).toBeGreaterThanOrEqual(8);
    expect(xs[0]).toBeCloseTo(-4.55);
    expect(xs[xs.length - 1]).toBeCloseTo(4.55);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      // Stools are 0.7 m wide and the sit radius is 1 m: every point along
      // the counter is within reach of a stool, and stools never overlap.
      expect(gap).toBeGreaterThan(0.8);
      expect(gap).toBeLessThan(2);
    }
  });

  it('get their own one-seat table ids', () => {
    const t = barStoolTableId('bar-1', 3);
    expect(isBarStoolTable(t)).toBe(true);
    expect(isBarStoolTable('pub:cards:bar-1')).toBe(false);
    expect(isBarStoolTable(null)).toBe(false);
  });

  it('have a live Sit interaction', () => {
    expect(findBarInteractionByTag('bar-stool')?.status).not.toBe('planned');
  });
});

describe('bar counter collision', () => {
  // Mirrors SurfaceBar: 10 m x 1 m counter, stools 1.2 m in front of its centre line.
  const AVATAR_R = 0.45;
  const minD = 0.5 + AVATAR_R;
  const cols = counterColliderOffsets(10);
  const nearest = (x: number, z: number) =>
    Math.min(...cols.map((cx) => Math.hypot(x - cx, z)));

  it('leaves no gap to walk through anywhere along the counter', () => {
    for (let x = -5; x <= 5; x += 0.05) {
      // Crossing the counter means passing its centre line; every point
      // there must sit inside a collider's push-out radius.
      expect(nearest(x, 0)).toBeLessThan(minD);
      // And well inside the counter's front face too.
      expect(nearest(x, 0.4)).toBeLessThan(minD);
    }
  });

  it('does not push players off the stools', () => {
    for (const x of barStoolOffsets(10)) {
      expect(nearest(x, -1.2)).toBeGreaterThanOrEqual(minD);
    }
  });

  it('uses solidRadius so the physics push-out picks the colliders up', () => {
    expect(solidRadiusFor({ meta: { structure: 'bar-counter-solid', solidRadius: 0.5 } } as never)).toBe(0.5);
  });
});

describe('ordering from a stool', () => {
  it('maps a stool to the drinks menu of its own bar', () => {
    expect(barTableForStool(barStoolTableId('bar-01', 4))).toBe('pub:bar:bar-01');
    expect(barTableForStool('pub:cards:bar-01')).toBeNull();
  });
});
