/**
 * mapLandmarks — the named places a map should show, in Earth-local space.
 *
 * Every entry is read from the live world sources (village site frame,
 * volcano organ, builder blocks, chicken flocks), so the map shows what
 * is really there. Positions are Earth-local unit normals, ready for
 * `mapProjection.projectToMap`.
 */
import { EARTH_RADIUS, getEarthLocalSiteFrame, SHARED_VILLAGE_ISLAND_ANCHOR, type Vec3 } from './earth';
import { getBuilderBlockEngine, type BuilderBlock } from './builderBlockEngine';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from './volcanoOrgan';
import { FIRE_PIT_ID } from './prefabHouseCatalog';
import { getHens } from './land/chickens';
import { isFireLit } from '@/lib/world/fireStore';

export type LandmarkKind = 'home' | 'volcano' | 'bar' | 'firePit' | 'hive' | 'nest' | 'mountain';

export interface MapLandmark {
  kind: LandmarkKind;
  /** Stable key (for de-duplication and React-free diffing). */
  key: string;
  /** Earth-local unit normal. */
  n: Vec3;
  /** Short name shown beside the icon. */
  label: string;
  /** Fire pits only: burning right now. */
  lit?: boolean;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Earth-local unit normal under a builder block (its anchor frame + tangent offset). */
export function blockLocalNormal(b: Pick<BuilderBlock, 'anchorPeerId' | 'rightOffset' | 'forwardOffset'>): Vec3 {
  const lf = getEarthLocalSiteFrame(b.anchorPeerId);
  return normalize([
    lf.normal[0] * EARTH_RADIUS + lf.forward[0] * b.forwardOffset + lf.right[0] * b.rightOffset,
    lf.normal[1] * EARTH_RADIUS + lf.forward[1] * b.forwardOffset + lf.right[1] * b.rightOffset,
    lf.normal[2] * EARTH_RADIUS + lf.forward[2] * b.forwardOffset + lf.right[2] * b.rightOffset,
  ]);
}

/** Earth-local normal of home: the shared village, where everyone spawns. */
export function getHomeNormal(): Vec3 {
  return getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
}

/** Every landmark currently in the world. Each source is best-effort. */
export function getMapLandmarks(now = Date.now()): MapLandmark[] {
  const out: MapLandmark[] = [];
  const attempt = (fn: () => void) => { try { fn(); } catch { /* source not ready */ } };

  attempt(() => out.push({ kind: 'home', key: 'home', n: getHomeNormal(), label: 'Home' }));
  attempt(() => out.push({
    kind: 'volcano', key: 'volcano', n: getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID).centerNormal, label: 'Volcano',
  }));

  attempt(() => {
    const blocks = getBuilderBlockEngine().listBlocks();
    // The bar is many pieces; show one icon at the middle of its counters.
    const counters = blocks.filter((b) => b.kind === 'bar-counter');
    if (counters.length > 0) {
      const sum: Vec3 = [0, 0, 0];
      for (const b of counters) {
        const n = blockLocalNormal(b);
        sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2];
      }
      out.push({ kind: 'bar', key: 'bar', n: normalize(sum), label: 'Bar' });
    }
    for (const b of blocks) {
      if (b.kind === FIRE_PIT_ID) {
        out.push({ kind: 'firePit', key: `fire:${b.id}`, n: blockLocalNormal(b), label: 'Fire pit', lit: isFireLit(b.id, now) });
      } else if (b.kind === 'hive') {
        out.push({ kind: 'hive', key: `hive:${b.id}`, n: blockLocalNormal(b), label: 'Hive' });
      } else if (b.kind === 'mountain') {
        out.push({ kind: 'mountain', key: `mountain:${b.id}`, n: blockLocalNormal(b), label: 'Mountain' });
      }
    }
  });

  attempt(() => {
    const seen = new Set<string>();
    for (const h of getHens()) {
      if (seen.has(h.flock)) continue;
      seen.add(h.flock);
      out.push({ kind: 'nest', key: `nest:${h.flock}`, n: h.nest, label: 'Nest' });
    }
  });

  return out;
}
