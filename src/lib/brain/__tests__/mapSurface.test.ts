import { describe, expect, it } from 'vitest';
import { getEarthLocalSiteFrame, SHARED_VILLAGE_ISLAND_ANCHOR, type Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { sampleMapSurface } from '../mapSurface';

describe('sampleMapSurface', () => {
  it('paints water exactly where the ground is below sea level', () => {
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const z = 1 - (2 * (i + 0.5)) / 400;
      const r = Math.sqrt(1 - z * z);
      const a = i * 2.399963;
      const n: Vec3 = [r * Math.cos(a), z, r * Math.sin(a)];
      const kind = sampleMapSurface(n);
      const wet = kind === 'deep' || kind === 'shallow';
      expect(wet).toBe(groundElevationAt(n) < 0);
      checked++;
    }
    expect(checked).toBe(400);
  });

  it('shows the village as dry land', () => {
    const home = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    expect(['land', 'beach']).toContain(sampleMapSurface(home));
  });

  it('paints both land and sea somewhere on the planet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const z = 1 - (2 * (i + 0.5)) / 400;
      const r = Math.sqrt(1 - z * z);
      const a = i * 2.399963;
      seen.add(sampleMapSurface([r * Math.cos(a), z, r * Math.sin(a)]));
    }
    expect(seen.has('land')).toBe(true);
    expect(seen.has('deep') || seen.has('shallow')).toBe(true);
  });
});
