/**
 * wildClock — local solar time anywhere on Earth, from the shared clock.
 *
 * Wildlife keeps the same kind of day the villagers do
 * (`npc/villageSchedule.ts`): hens roost at dusk and walk out at dawn,
 * bees stay in the hive overnight. Each creature reads the solar hour at
 * its own home, so a flock on the far side of the planet sleeps while the
 * village is in daylight.
 *
 * Earth spins about its local Y axis, so the solar hour at a point is the
 * village's solar hour shifted by the longitude (angle about Y) between
 * the point and the village. Everything here is a pure function of the
 * point and the shared epoch seconds (`getEarthPoseTime()`), so every peer
 * agrees without sending anything.
 */
import { SHARED_VILLAGE_ISLAND_ANCHOR, getEarthLocalSiteFrame, type Vec3 } from '@/lib/brain/earth';
import { villageSolarHour } from '@/lib/brain/npc/villageSchedule';

let _villageLon: number | null = null;

function longitude(n: Vec3): number {
  return Math.atan2(n[0], n[2]);
}

function villageLon(): number {
  if (_villageLon === null) _villageLon = longitude(getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal);
  return _villageLon;
}

/** Solar hour in [0, 24) at Earth-local unit normal `n`, epoch `seconds` (12 = noon). */
export function solarHourAt(n: Vec3, seconds: number): number {
  const h = villageSolarHour(seconds) + ((longitude(n) - villageLon()) / (Math.PI * 2)) * 24;
  return ((h % 24) + 24) % 24;
}

/**
 * Hours from `from` forward to `to` on the 24 h dial, in [0, 24).
 * `hoursSince(h, 19)` is how long ago 19:00 was at hour `h`.
 */
export function hoursSince(hour: number, from: number): number {
  return (((hour - from) % 24) + 24) % 24;
}

/** True when `hour` falls in the window [start, end) on the 24 h dial (wrapping midnight). */
export function inHourWindow(hour: number, start: number, end: number): boolean {
  return hoursSince(hour, start) < hoursSince(end, start);
}

/** Test seam. */
export function _resetWildClockForTest(): void {
  _villageLon = null;
}
