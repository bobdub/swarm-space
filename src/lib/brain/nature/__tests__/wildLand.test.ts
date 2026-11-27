import { afterEach, describe, expect, it } from 'vitest';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import { BEACH_TOP_M } from '@/lib/brain/beach';
import { EARTH_RADIUS, SHARED_VILLAGE_ISLAND_ANCHOR, getEarthLocalSiteFrame, type Vec3 } from '@/lib/brain/earth';
import { getHens } from '@/lib/brain/land/chickens';
import { recordNatureEvent, HEN_EVENT_TTL_MS } from '@/lib/world/natureEventsStore';
import { isTreeFelled } from '@/lib/world/treeChopStore';
import {
  WILD_PATCH_COUNT,
  WILD_VILLAGE_CLEAR_M,
  _resetWildLandForTest,
  isWildPieceTaken,
  loadedWildPatchCount,
  syncWildLand,
  wildPatch,
  wildPatchCentre,
  wildPatchesNear,
} from '../wildLand';

function arc(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * EARTH_RADIUS;
}

function pieceNormal(p: NonNullable<ReturnType<typeof wildPatch>>, x: number, z: number): Vec3 {
  const v: Vec3 = [
    p.normal[0] * EARTH_RADIUS + p.forward[0] * z + p.right[0] * x,
    p.normal[1] * EARTH_RADIUS + p.forward[1] * z + p.right[1] * x,
    p.normal[2] * EARTH_RADIUS + p.forward[2] * z + p.right[2] * x,
  ];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

afterEach(() => _resetWildLandForTest());

describe('wild land', () => {
  it('is the same on every call (deterministic)', () => {
    const a = JSON.stringify(wildPatch(1234));
    _resetWildLandForTest();
    expect(JSON.stringify(wildPatch(1234))).toBe(a);
  });

  it('dresses the land round every chicken flock off the ice', () => {
    const village = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    const nests = new Map<string, Vec3>();
    for (const h of getHens()) nests.set(h.flock, h.nest);
    let bare = 0;
    let checked = 0;
    for (const nest of nests.values()) {
      if (arc(nest, village) < WILD_VILLAGE_CLEAR_M + 40) continue;
      // Flocks on the polar ice keep to bare snow.
      if (Math.abs(nest[1]) >= 0.9) continue;
      checked++;
      const kinds = new Set<string>();
      for (const i of wildPatchesNear(nest, 80)) for (const p of wildPatch(i)?.pieces ?? []) kinds.add(p.kind);
      if (!(kinds.has('tree') && kinds.has('grass'))) bare++;
    }
    expect(checked).toBeGreaterThan(5);
    expect(bare).toBe(0);
  });

  it('grows nothing on the beach, in the sea or in the village', () => {
    const village = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
    let pieces = 0;
    for (let i = 0; i < WILD_PATCH_COUNT; i += 37) {
      const p = wildPatch(i);
      if (!p) continue;
      for (const piece of p.pieces) {
        const n = pieceNormal(p, piece.x, piece.z);
        expect(groundElevationAt(n)).toBeGreaterThanOrEqual(BEACH_TOP_M);
        expect(arc(n, village)).toBeGreaterThanOrEqual(WILD_VILLAGE_CLEAR_M);
        pieces++;
      }
    }
    expect(pieces).toBeGreaterThan(500);
  });

  it('places patches round the viewer and takes them down when left behind', () => {
    const engine = getBuilderBlockEngine();
    const landPatch = Array.from({ length: WILD_PATCH_COUNT }, (_, i) => i).find((i) => (wildPatch(i)?.pieces.length ?? 0) > 8)!;
    const here = wildPatchCentre(landPatch);
    syncWildLand(here, 1_000_000);
    expect(loadedWildPatchCount()).toBeGreaterThan(0);
    const wild = engine.listBlocks((b) => b.anchorPeerId.startsWith('wild:'));
    expect(wild.length).toBeGreaterThan(8);
    expect(wild.every((b) => b.meta?.biome === 'nature.biome.v1')).toBe(true);

    // Gathering a tuft keeps it gone here until it grows back.
    const grass = wild.find((b) => b.kind === 'grass')!;
    engine.removeBlock(grass.bodyId);
    expect(isWildPieceTaken(grass.bodyId, 'grass')).toBe(true);
    syncWildLand(here);
    expect(engine.getBlock(grass.bodyId)).toBeUndefined();

    // Walk to the far side of the planet: everything here is taken down.
    syncWildLand([-here[0], -here[1], -here[2]]);
    expect(engine.listBlocks((b) => b.anchorPeerId === `wild:${landPatch}`)).toHaveLength(0);
  });

  it('stands a remotely felled tree up again when the tab slept through its regrow', () => {
    const engine = getBuilderBlockEngine();
    const i = Array.from({ length: WILD_PATCH_COUNT }, (_, k) => k).find((k) => wildPatch(k)?.pieces.some((p) => p.kind === 'tree'))!;
    const here = wildPatchCentre(i);
    const fellAt = Date.now() - 1500;
    syncWildLand(here, fellAt - 1000);
    const tree = engine.listBlocks((b) => b.kind === 'tree' && b.anchorPeerId === `wild:${i}`)[0];
    recordNatureEvent('fell', tree.bodyId, tree.anchorPeerId, tree.rightOffset, tree.forwardOffset, fellAt);
    // Mid-fall: shown coming down.
    syncWildLand(here, fellAt + 1500);
    expect(isTreeFelled(tree.bodyId)).toBe(true);
    // Next sync lands after the regrow: the same block stands again.
    syncWildLand(here, fellAt + HEN_EVENT_TTL_MS + 1);
    expect(engine.getBlock(tree.bodyId)).toBeDefined();
    expect(isTreeFelled(tree.bodyId)).toBe(false);
  });
});
