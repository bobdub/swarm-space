/**
 * Main Brain activity gate — 5 days.
 *
 * Separate from the 15-day author fadeout in `contentLifecycle.ts` (which
 * follows the author's presence). This gate follows the placement itself:
 * a placement in the shared Main Brain (`universeKey === 'global'`) that
 * sees no activity for 5 days goes idle. Peers then stop carrying it — it
 * leaves their room persistence, their lobby snapshots and their render —
 * until its author refreshes it.
 *
 * Activity is the newest of:
 *   - placing it (`createdAt`),
 *   - any author update: move, edit, re-decorate or an explicit refresh
 *     (`activityAt`, gossiped with the record),
 *   - the pinned post's decoration time (`decoration.updatedAt`),
 *   - any wall interaction from anyone: view, reinforce (tip) or graffiti.
 *
 * Project hubs and live rooms are never gated.
 */
import { latestWallInteractionAt } from './wallInteractionsStore';

export const MAIN_BRAIN_IDLE_MS = 5 * 24 * 60 * 60 * 1000;

export interface ActivityFields {
  placementId: string;
  createdAt: number;
  universeKey?: string;
  activityAt?: number;
  decoration?: { postId: string; updatedAt: number };
}

/** Allowed clock skew between peers. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** A usable timestamp, or 0 — future stamps are ignored so a wrong (or
 *  hostile) clock can't keep a placement "active" forever. */
function stamp(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > now + MAX_SKEW_MS ? 0 : value;
}

export function isMainBrainScope(rec: { universeKey?: string }): boolean {
  return !rec.universeKey || rec.universeKey === 'global';
}

/** Newest activity time for a placement (future stamps ignored). */
export function lastPlacementActivityAt(rec: ActivityFields, now = Date.now()): number {
  const latest = Math.max(
    stamp(rec.createdAt, now),
    stamp(rec.activityAt, now),
    stamp(rec.decoration?.updatedAt, now),
    stamp(latestWallInteractionAt(rec.placementId), now),
  );
  return Math.min(latest, now);
}

/** True when a Main Brain placement has had no activity for 5 days. */
export function isPlacementIdle(rec: ActivityFields, now = Date.now()): boolean {
  if (!isMainBrainScope(rec)) return false;
  return now - lastPlacementActivityAt(rec, now) > MAIN_BRAIN_IDLE_MS;
}

/** Whole days since the last activity (0 for anything under a day). */
export function idleDays(rec: ActivityFields, now = Date.now()): number {
  return Math.floor((now - lastPlacementActivityAt(rec, now)) / (24 * 60 * 60 * 1000));
}
