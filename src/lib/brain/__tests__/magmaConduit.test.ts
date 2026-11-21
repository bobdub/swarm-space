import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS } from '../earth';
import {
  CONDUIT_BASE_FRAC,
  SLUG_SWELL_M,
  STROMBOLIAN_PERIOD_S,
  UPWELL_AXIS_SPEED,
  conduitDepth,
  conduitProfile,
  conduitRadiusAt,
  magmaHeadAt,
  slugPhaseAt,
  throatRadius,
  upwellSpeedAt,
} from '../magmaConduit';
import { tideAt } from '../sea/seaSurface';
import { volcanoLavaRadius } from '../volcanoEffects';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';

describe('magma conduit', () => {
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);

  it('runs from the lake down to the core-mantle boundary', () => {
    const depth = conduitDepth(organ);
    expect(volcanoLavaRadius(organ) - depth).toBeCloseTo(CONDUIT_BASE_FRAC * EARTH_RADIUS, 6);
    const pts = conduitProfile(organ);
    expect(pts[0][1]).toBeCloseTo(-depth, 6);
    expect(pts[pts.length - 1][1]).toBe(-0);
    // A neck at the top that opens with depth (hyperboloid).
    expect(pts[pts.length - 1][0]).toBeCloseTo(throatRadius(organ), 9);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][1]).toBeGreaterThan(pts[i - 1][1]);
      expect(pts[i][0]).toBeLessThanOrEqual(pts[i - 1][0]);
    }
    expect(conduitRadiusAt(organ, depth)).toBeGreaterThan(3 * throatRadius(organ));
    // The neck fits inside the crater.
    expect(throatRadius(organ)).toBeLessThan(organ.craterRadius * 0.5);
  });

  it('rises fastest on the axis and is held back at the walls', () => {
    expect(upwellSpeedAt(0)).toBe(UPWELL_AXIS_SPEED);
    expect(upwellSpeedAt(1)).toBe(0);
    expect(upwellSpeedAt(0.5)).toBeCloseTo(UPWELL_AXIS_SPEED * 0.75, 12);
  });

  it('breathes on the shared clock with slug bursts and the tide', () => {
    const t0 = 47 * 21_000; // a burst
    expect(slugPhaseAt(t0)).toBeCloseTo(0, 9);
    // Just before the burst the lake is swollen; just after it has dropped.
    const before = magmaHeadAt(organ, t0 - 0.01) - tideAt(organ.centerNormal, t0 - 0.01);
    const after = magmaHeadAt(organ, t0 + 0.01) - tideAt(organ.centerNormal, t0 + 0.01);
    expect(before).toBeGreaterThan(SLUG_SWELL_M * 0.95);
    expect(after).toBeCloseTo(0, 9);
    // Same instant, same lake, on any peer.
    expect(magmaHeadAt(organ, t0 + 12.3)).toBe(magmaHeadAt(organ, t0 + 12.3));
    expect(slugPhaseAt(t0 + STROMBOLIAN_PERIOD_S / 2)).toBeCloseTo(0.5, 9);
  });
});
