/**
 * sharks — what a shark does when it meets a player.
 *
 * Where each shark swims is shared (`seaLife.ts`). On top of that:
 *
 * - Bite: a shark that comes within SHARK_BITE_M of a swimmer bites once.
 *   It costs SHARK_BITE_FOOD Food and shoves the swimmer SHARK_SHOVE_M
 *   away, and then that shark backs off (dives) for SHARK_BACKOFF_S.
 *   A warning comes first at SHARK_WARN_M.
 * - Knife: a Stone Knife swung at a shark within KNIFE_REACH_M of its body
 *   drives it off (it dives away) for SHARK_FLEE_S.
 * - Catching: in water at least SHARK_CATCH_DEPTH deep with a shark within
 *   SHARK_HOOK_RANGE_M, about one bite in ten is that shark (see
 *   `fishing.ts`). A landed shark is recorded as a shared nature event, so
 *   it is gone from the sea for everyone for SHARK_GONE_MS.
 *
 * Backing off and fleeing are this device's own: they matter to the
 * player the shark met, and other peers keep seeing it on its usual path.
 * A catch is shared.
 */

import type { Vec3 } from '../earth';
import { lastCaughtAt, recordNatureEvent } from '@/lib/world/natureEventsStore';
import { starboardOf, travel } from './dockSite';
import { arcMetres, seaLifeNear, seaPoseAt, type SeaCreature } from './seaLife';

/** A swimmer this close to a shark (m, centre to centre) is bitten. */
export const SHARK_BITE_M = 3;
/** Food a bite costs. */
export const SHARK_BITE_FOOD = 2;
/** How far a bite shoves the swimmer (m). */
export const SHARK_SHOVE_M = 2;
/** Seconds a shark backs off after biting. */
export const SHARK_BACKOFF_S = 30;
/** Knife reach to a shark's body (m): the knife's 0.95 m and a bit more in water. */
export const KNIFE_REACH_M = 1.5;
/** Seconds a knifed shark keeps away. */
export const SHARK_FLEE_S = 60;
/** How long a caught shark is gone for everyone (ms). */
export const SHARK_GONE_MS = 10 * 60_000;
/** Water (m) deep enough to hook a shark, and how near one must be (m). */
export const SHARK_CATCH_DEPTH = 15;
export const SHARK_HOOK_RANGE_M = 120;
/** Share of bites that are the shark, where one can be hooked. */
export const SHARK_BITE_CHANCE = 0.1;
/** Half the shark's length (m): its body runs this far ahead and behind. */
const SHARK_HALF_LEN = 1.3;
/** How deep (m) a shark dives while it keeps away. */
export const SHARK_DIVE_M = 3.5;

/** Shared-clock time (s) until which each shark keeps away, on this device. */
const calmUntil = new Map<string, number>();

/** Nature-event block id for a shark. */
export function sharkBlockId(id: string): string {
  return `shark:${id}`;
}

/** True while a caught shark is still gone from the sea. */
export function sharkGone(id: string, nowMs: number): boolean {
  const at = lastCaughtAt(sharkBlockId(id));
  return at !== undefined && nowMs - at < SHARK_GONE_MS && nowMs >= at - 5 * 60_000;
}

/** True while a shark is backing off or fleeing (this device). */
export function sharkKeepingAway(id: string, t: number): boolean {
  return (calmUntil.get(id) ?? -Infinity) > t;
}

/** Extra depth (m) a keeping-away shark is drawn at: it dives, then comes back up. */
export function sharkDiveAt(id: string, t: number): number {
  const until = calmUntil.get(id);
  if (until === undefined || t >= until) return 0;
  const left = until - t;
  const down = Math.min(1, left / 3); // rise over the last 3 s
  return SHARK_DIVE_M * down;
}

/** Surface distance (m) from `n` to the nearest point of a shark's body. */
export function distanceToShark(n: Vec3, c: SeaCreature, t: number): number {
  const p = seaPoseAt(c, t);
  let best = arcMetres(n, p.n);
  for (const along of [-SHARK_HALF_LEN, -SHARK_HALF_LEN / 2, SHARK_HALF_LEN / 2, SHARK_HALF_LEN]) {
    best = Math.min(best, arcMetres(n, travel(p.n, p.heading, along)));
  }
  return best;
}

function nearestShark(
  n: Vec3,
  t: number,
  nowMs: number,
  withinM: number,
  ok: (c: SeaCreature) => boolean,
  dist: (c: SeaCreature) => number = (c) => arcMetres(n, seaPoseAt(c, t).n),
): { c: SeaCreature; d: number } | null {
  let best: { c: SeaCreature; d: number } | null = null;
  for (const c of seaLifeNear(n, withinM, 'shark')) {
    if (sharkGone(c.id, nowMs) || !ok(c)) continue;
    const d = dist(c);
    if (d <= withinM && (!best || d < best.d)) best = { c, d };
  }
  return best;
}

/** The nearest shark that would come at a swimmer at `n` (not gone, not keeping away). */
export function threateningShark(n: Vec3, t: number, nowMs: number, withinM: number): { c: SeaCreature; d: number } | null {
  return nearestShark(n, t, nowMs, withinM, (c) => !sharkKeepingAway(c.id, t));
}

export interface SharkBite {
  sharkId: string;
  /** Where the swimmer ends up after the shove (Earth-local unit normal). */
  shoveTo: Vec3;
}

/**
 * A swimmer at `n` at shared time `t`: if a shark is close enough it bites
 * (once; then it backs off). The caller takes the Food and moves the body.
 */
export function trySharkBite(n: Vec3, t: number, nowMs: number): SharkBite | null {
  const hit = threateningShark(n, t, nowMs, SHARK_BITE_M);
  if (!hit) return null;
  calmUntil.set(hit.c.id, t + SHARK_BACKOFF_S);
  // Shove straight away from the shark (sideways off its nose if it's on top of us).
  const from = seaPoseAt(hit.c, t);
  let away: Vec3 = [n[0] - from.n[0], n[1] - from.n[1], n[2] - from.n[2]];
  const d = away[0] * n[0] + away[1] * n[1] + away[2] * n[2];
  away = [away[0] - n[0] * d, away[1] - n[1] * d, away[2] - n[2] * d];
  let l = Math.hypot(away[0], away[1], away[2]);
  if (l < 1e-9) {
    away = starboardOf(from.n, from.heading);
    l = 1;
  }
  away = [away[0] / l, away[1] / l, away[2] / l];
  return { sharkId: hit.c.id, shoveTo: travel(n, away, SHARK_SHOVE_M) };
}

/** A knife swung by a player at `n`: drives off a shark in reach. Returns its id. */
export function knifeShark(n: Vec3, t: number, nowMs: number): string | null {
  const hit = nearestShark(n, t, nowMs, KNIFE_REACH_M, () => true, (c) => distanceToShark(n, c, t));
  if (!hit) return null;
  calmUntil.set(hit.c.id, t + SHARK_FLEE_S);
  return hit.c.id;
}

/** A shark that a line over `depth` m of water at `n` could hook, if any. */
export function hookableShark(n: Vec3, depth: number, t: number, nowMs: number): string | null {
  if (depth < SHARK_CATCH_DEPTH) return null;
  return nearestShark(n, t, nowMs, SHARK_HOOK_RANGE_M, () => true)?.c.id ?? null;
}

/** True when shark `id` could still take a bait cast over `depth` m at `n`. */
export function sharkStillHookable(id: string, n: Vec3, depth: number, t: number, nowMs: number): boolean {
  if (depth < SHARK_CATCH_DEPTH || sharkGone(id, nowMs)) return false;
  const c = seaLifeNear(n, SHARK_HOOK_RANGE_M, 'shark').find((x) => x.id === id);
  return !!c && arcMetres(n, seaPoseAt(c, t).n) <= SHARK_HOOK_RANGE_M;
}

/** A landed shark: gone from the sea for everyone for a while. */
export function recordSharkCaught(id: string, nowMs = Date.now()): void {
  calmUntil.delete(id);
  recordNatureEvent('shark-caught', sharkBlockId(id), 'sea', 0, 0, nowMs);
}

export function _resetSharksForTest(): void {
  calmUntil.clear();
}
