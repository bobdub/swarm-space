import { describe, it, expect, beforeEach } from 'vitest';
import {
  BOX_PRICE_SWARM,
  PLOT_CELL,
  cellRectFromTrail,
  priceForRect,
  rectBoxCount,
  rectOverlapsForeign,
  getPlotAtTangent,
  claimLandPlot,
  tangentToCell,
  cellInRect,
} from '../landPlots';
import { CELL, WALL_PITCH } from '../buildGrid';

const NS = 'landPlots-test';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('brain-land-plots-v1')) localStorage.removeItem(k);
    }
  }
});

describe('landPlots — pure helpers', () => {
  it('plot cell, wall pitch, and build grid cell are locked together', () => {
    // Regression: any future drift breaks the "4 walls = 1 plot box" invariant.
    expect(PLOT_CELL).toBe(WALL_PITCH);
    expect(CELL).toBe(WALL_PITCH);
  });

  it('snaps a tangent point to its containing cell', () => {
    expect(tangentToCell(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(tangentToCell(PLOT_CELL - 0.001, PLOT_CELL - 0.001)).toEqual({ cx: 0, cz: 0 });
    expect(tangentToCell(PLOT_CELL, PLOT_CELL)).toEqual({ cx: 1, cz: 1 });
    expect(tangentToCell(-0.5, -0.5)).toEqual({ cx: -1, cz: -1 });
  });

  it('cellRectFromTrail produces an AABB snapped outward to whole cells', () => {
    const trail = [
      { tx: 0.5, tz: 0.5 },
      { tx: PLOT_CELL * 1.5, tz: 0.5 },
      { tx: PLOT_CELL * 1.5, tz: PLOT_CELL * 1.5 },
      { tx: 0.5, tz: PLOT_CELL * 1.5 },
    ];
    const rect = cellRectFromTrail(trail);
    expect(rect).not.toBeNull();
    expect(rect!.cx1 - rect!.cx0).toBeGreaterThanOrEqual(1);
    expect(rect!.cz1 - rect!.cz0).toBeGreaterThanOrEqual(1);
    expect(rectBoxCount(rect!)).toBeGreaterThanOrEqual(1);
  });

  it('returns null for a trail shorter than 3 samples', () => {
    expect(cellRectFromTrail([])).toBeNull();
    expect(cellRectFromTrail([{ tx: 0, tz: 0 }, { tx: 1, tz: 1 }])).toBeNull();
  });

  it('prices each box at exactly BOX_PRICE_SWARM (3 SWARM)', () => {
    const rect = { cx0: 0, cz0: 0, cx1: 2, cz1: 2 };
    expect(rectBoxCount(rect)).toBe(4);
    expect(priceForRect(rect)).toBe(4 * BOX_PRICE_SWARM);
    expect(BOX_PRICE_SWARM).toBe(3);
  });

  it('cellInRect uses inclusive-min, exclusive-max bounds', () => {
    const rect = { cx0: 0, cz0: 0, cx1: 2, cz1: 2 };
    expect(cellInRect(0, 0, rect)).toBe(true);
    expect(cellInRect(1, 1, rect)).toBe(true);
    expect(cellInRect(2, 2, rect)).toBe(false);
    expect(cellInRect(-1, 0, rect)).toBe(false);
  });
});

describe('landPlots — ownership and overlap', () => {
  it('claimLandPlot persists and getPlotAtTangent locates it', () => {
    const rect = { cx0: 0, cz0: 0, cx1: 2, cz1: 2 };
    const plot = claimLandPlot({
      ownerId: 'peer-A',
      cellRect: rect,
      anchorId: 'world-origin',
      priceSwarm: priceForRect(rect),
      ns: NS,
    });
    expect(plot.id).toMatch(/^plot:/);
    expect(plot.ownerId).toBe('peer-A');
    const hit = getPlotAtTangent(PLOT_CELL * 0.5, PLOT_CELL * 0.5, NS);
    expect(hit?.id).toBe(plot.id);
    const miss = getPlotAtTangent(PLOT_CELL * 5, PLOT_CELL * 5, NS);
    expect(miss).toBeNull();
  });

  it('rectOverlapsForeign is true only when another peer owns overlapping cells', () => {
    const ownedByA = { cx0: 0, cz0: 0, cx1: 2, cz1: 2 };
    claimLandPlot({ ownerId: 'peer-A', cellRect: ownedByA, anchorId: 'world-origin', priceSwarm: 12, ns: NS });
    // B tries to claim an overlapping rect → blocked
    const bOverlapping = { cx0: 1, cz0: 1, cx1: 3, cz1: 3 };
    expect(rectOverlapsForeign(bOverlapping, 'peer-B', NS)).toBe(true);
    // A overlapping their own land → allowed
    expect(rectOverlapsForeign(bOverlapping, 'peer-A', NS)).toBe(false);
    // Disjoint area → allowed for anyone
    const disjoint = { cx0: 10, cz0: 10, cx1: 12, cz1: 12 };
    expect(rectOverlapsForeign(disjoint, 'peer-B', NS)).toBe(false);
  });
});