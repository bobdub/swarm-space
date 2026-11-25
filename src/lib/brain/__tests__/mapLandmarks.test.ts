import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS, getEarthLocalSiteFrame, SHARED_VILLAGE_ISLAND_ANCHOR } from '../earth';
import { getBuilderBlockEngine } from '../builderBlockEngine';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';
import { FIRE_PIT_ID } from '../prefabHouseCatalog';
import { getHens } from '../land/chickens';
import { blockLocalNormal, getHomeNormal, getMapLandmarks } from '../mapLandmarks';

const arcM = (a: number[], b: number[]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * EARTH_RADIUS;

describe('mapLandmarks', () => {
  it('puts home on the shared village', () => {
    const home = getMapLandmarks().find((l) => l.kind === 'home');
    expect(home).toBeDefined();
    expect(arcM(home!.n, getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal)).toBeLessThan(1e-3);
    expect(getHomeNormal()).toEqual(home!.n);
  });

  it('puts the volcano on its vent', () => {
    const v = getMapLandmarks().find((l) => l.kind === 'volcano');
    expect(v).toBeDefined();
    expect(arcM(v!.n, getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID).centerNormal)).toBeLessThan(1e-3);
  });

  it('shows one nest per flock', () => {
    const flocks = new Set(getHens().map((h) => h.flock));
    expect(getMapLandmarks().filter((l) => l.kind === 'nest')).toHaveLength(flocks.size);
  });

  it('places a block landmark at its tangent offset from the anchor', () => {
    const block = { anchorPeerId: SHARED_VILLAGE_ISLAND_ANCHOR, rightOffset: 30, forwardOffset: 40 };
    expect(arcM(blockLocalNormal(block), getHomeNormal())).toBeCloseTo(50, 0);
  });

  it('lists fire pits, hives and the bar from the builder blocks', () => {
    const engine = getBuilderBlockEngine();
    engine.placeBlock({ id: 'test-pit', kind: FIRE_PIT_ID, anchorPeerId: SHARED_VILLAGE_ISLAND_ANCHOR, rightOffset: 5 });
    engine.placeBlock({ id: 'test-hive', kind: 'hive', anchorPeerId: SHARED_VILLAGE_ISLAND_ANCHOR, forwardOffset: 9 });
    engine.placeBlock({ id: 'test-bar-a', kind: 'bar-counter', anchorPeerId: SHARED_VILLAGE_ISLAND_ANCHOR, rightOffset: -20 });
    engine.placeBlock({ id: 'test-bar-b', kind: 'bar-counter', anchorPeerId: SHARED_VILLAGE_ISLAND_ANCHOR, rightOffset: -24 });
    const lms = getMapLandmarks();
    const pit = lms.find((l) => l.key === 'fire:test-pit');
    expect(pit?.kind).toBe('firePit');
    expect(pit?.lit).toBe(false);
    expect(lms.some((l) => l.key === 'hive:test-hive')).toBe(true);
    const bars = lms.filter((l) => l.kind === 'bar');
    expect(bars).toHaveLength(1);
    expect(arcM(bars[0].n, getHomeNormal())).toBeCloseTo(22, 0);
  });
});
