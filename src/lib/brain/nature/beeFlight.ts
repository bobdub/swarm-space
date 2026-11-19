/**
 * Bee flight — pure, deterministic foraging paths for the hive's workers.
 *
 * Every worker runs the same loop: leave the hive entrance, fly an arced,
 * wobbling path to a flower, hover over it (pollinating), fly home and
 * rest a moment at the entrance. Same inputs + same clock → same pose on
 * every peer, so no network state is needed to agree on where a bee is.
 *
 * Coordinates are in the HIVE's local frame (x = right, y = up,
 * z = forward), the frame `BuilderBlockView` draws the hive in.
 */

export type V3 = [number, number, number];

/** Seconds spent on each leg of a foraging trip. */
export const BEE_OUT_S = 5.5;
export const BEE_HOVER_S = 3.2;
export const BEE_BACK_S = 5.5;
export const BEE_REST_S = 1.6;
export const BEE_TRIP_S = BEE_OUT_S + BEE_HOVER_S + BEE_BACK_S + BEE_REST_S;

/** How many of the closest flowers a hive forages from. */
export const BEE_FORAGE_FLOWERS = 8;

export type BeePhase = 'out' | 'hover' | 'back' | 'rest';

export interface BeePose {
  pos: V3;
  phase: BeePhase;
  /** Index into the flower list this trip visits (-1 when there are none). */
  flower: number;
}

function hash2(a: number, b: number): number {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

/** Keep only the `limit` flowers closest to the hive entrance. */
export function nearestFlowers(entrance: V3, flowers: V3[], limit = BEE_FORAGE_FLOWERS): V3[] {
  return flowers
    .map((f) => ({ f, d: Math.hypot(f[0] - entrance[0], f[2] - entrance[2]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((e) => e.f);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Point on an arced flight from `a` to `b`: a raised curve with a small
 * side-to-side wobble, so the bee reads as flying rather than sliding.
 */
function flight(a: V3, b: V3, u: number, seed: number, timeS: number): V3 {
  const e = smooth(u);
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz) || 1;
  // Lift of the arc grows with distance, capped so long trips stay low.
  const lift = Math.min(3.2, 0.8 + len * 0.12) * Math.sin(Math.PI * e);
  // Perpendicular wobble, strongest mid-flight, zero at both ends.
  const env = Math.sin(Math.PI * u);
  const wob = Math.sin(timeS * 6.3 + seed) * 0.35 * env;
  const px = -dz / len;
  const pz = dx / len;
  const bob = Math.sin(timeS * 11 + seed * 1.7) * 0.06 * env;
  return [
    a[0] + dx * e + px * wob,
    a[1] + (b[1] - a[1]) * e + lift + bob,
    a[2] + dz * e + pz * wob,
  ];
}

/**
 * Where worker `index` (of `count`) is at time `timeS`.
 * Workers are spread evenly through the trip cycle so the hive always
 * has bees leaving, foraging and returning.
 */
export function beePoseAt(
  index: number,
  count: number,
  timeS: number,
  entrance: V3,
  flowers: V3[],
): BeePose {
  const seed = (index * 2.399) % (Math.PI * 2);
  const offset = (index / Math.max(1, count)) * BEE_TRIP_S;
  const tt = timeS + offset;
  const trip = Math.floor(tt / BEE_TRIP_S);
  const s = tt - trip * BEE_TRIP_S;

  if (flowers.length === 0) {
    // Nothing to forage: drift in a lazy loop around the entrance.
    const a = timeS * 0.9 + seed;
    return {
      pos: [entrance[0] + Math.cos(a) * 0.9, entrance[1] + Math.sin(a * 1.7) * 0.25, entrance[2] + Math.sin(a) * 0.9],
      phase: 'hover',
      flower: -1,
    };
  }

  const flower = hash2(index, trip) % flowers.length;
  const f = flowers[flower];
  // Hover a little above the bloom, circling it.
  const hoverCentre: V3 = [f[0], f[1] + 0.22, f[2]];

  if (s < BEE_OUT_S) {
    return { pos: flight(entrance, hoverCentre, s / BEE_OUT_S, seed, timeS), phase: 'out', flower };
  }
  if (s < BEE_OUT_S + BEE_HOVER_S) {
    const h = s - BEE_OUT_S;
    // Ease into the circle from its centre so the hand-off is seamless.
    const r = 0.18 * Math.min(1, h / 0.6) * Math.min(1, (BEE_HOVER_S - h) / 0.6);
    const a = h * 4.2 + seed;
    return {
      pos: [hoverCentre[0] + Math.cos(a) * r, hoverCentre[1] + Math.sin(h * 7) * 0.05, hoverCentre[2] + Math.sin(a) * r],
      phase: 'hover',
      flower,
    };
  }
  if (s < BEE_OUT_S + BEE_HOVER_S + BEE_BACK_S) {
    const u = (s - BEE_OUT_S - BEE_HOVER_S) / BEE_BACK_S;
    return { pos: flight(hoverCentre, entrance, u, seed + 1.3, timeS), phase: 'back', flower };
  }
  const restU = (s - BEE_OUT_S - BEE_HOVER_S - BEE_BACK_S) / BEE_REST_S;
  const bob = Math.sin(timeS * 9 + seed) * 0.03 * Math.sin(Math.PI * restU);
  return { pos: [entrance[0], entrance[1] + bob, entrance[2]], phase: 'rest', flower };
}
