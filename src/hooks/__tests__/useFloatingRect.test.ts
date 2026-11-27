import { describe, expect, it } from 'vitest';
import { clampFloatingRect } from '../useFloatingRect';

describe('clampFloatingRect', () => {
  it('keeps a dragged window on screen', () => {
    Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
    expect(clampFloatingRect({ x: 2000, y: -50, w: 600, h: 400 }, 520, 360)).toEqual({ x: 592, y: 8, w: 600, h: 400 });
  });

  it('never shrinks below the minimum size', () => {
    Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
    expect(clampFloatingRect({ x: 10, y: 10, w: 100, h: 100 }, 520, 360)).toMatchObject({ w: 520, h: 360 });
  });
});

describe('clampFloatingRect in a short window', () => {
  it('lets the viewport win over the minimum height', () => {
    Object.assign(window, { innerWidth: 1280, innerHeight: 320 });
    const r = clampFloatingRect({ x: 100, y: 100, w: 600, h: 500 }, 520, 360);
    expect(r.y + r.h).toBeLessThanOrEqual(320 - 8);
  });
});
