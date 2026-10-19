/**
 * Activity Metrics — real user-driven scoring for the Quantum Metrics panel.
 *
 * Every point on the chart comes from a tangible action:
 *   P  Posting   text post +1, media post +2
 *   C  Comment   +0.05 each
 *   A  Axe       +0.01 per SWARM block mined
 *   B  Brain     +0.02 per brain session joined with a peer
 *
 * D (daily score) is the weighted sum of that day's activity.
 * Tier milestones (25/50/100/...) unlock achievements automatically.
 */

import type { QcmSeriesPoint } from "@/types";
import { getQcmSeriesForUser, recordQcmPoint } from "./achievementsStore";

export type ActivityKind = "post_text" | "post_media" | "comment" | "block_mined" | "brain_peer";

export const ACTIVITY_WEIGHTS: Record<ActivityKind, number> = {
  post_text: 1,
  post_media: 2,
  comment: 0.05,
  block_mined: 0.01,
  brain_peer: 0.02,
};

/** Chart series each activity kind feeds. */
export const ACTIVITY_SERIES_KEYS = ["posts", "comments", "mining", "brain"] as const;
export type ActivitySeriesKey = (typeof ACTIVITY_SERIES_KEYS)[number];

export const ACTIVITY_SERIES: Record<ActivityKind, ActivitySeriesKey> = {
  post_text: "posts",
  post_media: "posts",
  comment: "comments",
  block_mined: "mining",
  brain_peer: "brain",
};

/** Tier milestones per category (count of actions, not weighted points). */
export const ACTIVITY_TIERS = [25, 50, 100, 250, 500, 1000] as const;

/** Local calendar day key (YYYY-MM-DD) for daily bucketing. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next un-reached tier for a count, or null when all tiers are passed. */
export function nextTier(count: number): number | null {
  for (const tier of ACTIVITY_TIERS) {
    if (count < tier) return tier;
  }
  return null;
}

/** Tiers crossed by moving from `before` to `after` actions. */
export function tiersCrossed(before: number, after: number): number[] {
  return ACTIVITY_TIERS.filter((t) => before < t && after >= t);
}

export interface DailyActivity {
  /** YYYY-MM-DD */
  day: string;
  /** Weighted score per series for that day. */
  series: Record<string, number>;
  /** D — total weighted score for the day. */
  total: number;
}

/** Aggregate raw activity points into per-day weighted buckets. */
export function aggregateDaily(points: QcmSeriesPoint[]): DailyActivity[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const point of points) {
    if (!ACTIVITY_SERIES_KEYS.includes(point.series as ActivitySeriesKey)) continue;
    const key = dayKey(point.recordedAt);
    const bucket = byDay.get(key) ?? {};
    bucket[point.series] = (bucket[point.series] ?? 0) + point.value;
    byDay.set(key, bucket);
  }
  return Array.from(byDay.entries())
    .map(([day, series]) => ({
      day,
      series,
      total: Object.values(series).reduce((sum, v) => sum + v, 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Count of actions per series (each point = one action). */
export function countBySeries(points: QcmSeriesPoint[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const point of points) {
    if (!ACTIVITY_SERIES_KEYS.includes(point.series as ActivitySeriesKey)) continue;
    counts[point.series] = (counts[point.series] ?? 0) + 1;
  }
  return counts;
}

/** Record one real activity action and check tier milestones. */
export async function recordActivity(
  userId: string,
  kind: ActivityKind,
  meta?: Record<string, unknown>
): Promise<void> {
  const series = ACTIVITY_SERIES[kind];
  const point: QcmSeriesPoint = {
    id: crypto.randomUUID(),
    userId,
    series,
    value: ACTIVITY_WEIGHTS[kind],
    recordedAt: new Date().toISOString(),
    source: "activity",
    meta: { kind, ...meta },
  };

  // Live bus first: listeners update instantly; the disk write is only the archive.
  emitLiveActivity(point);
  await recordQcmPoint(point);
  try {
    await checkTierMilestones(userId, series);
  } catch (error) {
    console.warn("[activityMetrics] Tier check failed", error);
  }
}

async function checkTierMilestones(userId: string, series: string): Promise<void> {
  const all = await getQcmSeriesForUser(userId);
  const points = (all[series] ?? []).filter((p) => p.source === "activity");
  const count = points.length;
  const crossed = tiersCrossed(count - 1, count);
  if (!crossed.length) return;

  const { unlockActivityTier } = await import("./achievements");
  for (const tier of crossed) {
    await unlockActivityTier(userId, series as ActivitySeriesKey, tier);
  }
}

export const LIVE_ACTIVITY_EVENT = "swarm-activity-recorded";
let liveChannel: BroadcastChannel | null = null;
function getLiveChannel(): BroadcastChannel | null {
  if (liveChannel || typeof BroadcastChannel === "undefined") return liveChannel;
  liveChannel = new BroadcastChannel("swarm-activity-live");
  liveChannel.onmessage = (e) => {
    const point = e.data as QcmSeriesPoint | undefined;
    if (point?.id) window.dispatchEvent(new CustomEvent(LIVE_ACTIVITY_EVENT, { detail: { point, remote: true } }));
  };
  return liveChannel;
}

/** Push an activity point onto the live bus (this tab + other open tabs). */
export function emitLiveActivity(point: QcmSeriesPoint): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_ACTIVITY_EVENT, { detail: { point, userId: point.userId } }));
  try { getLiveChannel()?.postMessage(point); } catch { /* ignore */ }
}

/** Subscribe to live activity points. Returns unsubscribe. */
export function subscribeLiveActivity(fn: (point: QcmSeriesPoint) => void): () => void {
  if (typeof window === "undefined") return () => {};
  getLiveChannel();
  const handler = (e: Event) => {
    const point = (e as CustomEvent).detail?.point as QcmSeriesPoint | undefined;
    if (point) fn(point);
  };
  window.addEventListener(LIVE_ACTIVITY_EVENT, handler);
  return () => window.removeEventListener(LIVE_ACTIVITY_EVENT, handler);
}

let listenersInitialized = false;

/**
 * Wire window-level activity sources (mining). Safe to call multiple times.
 * Post/comment/brain activities are recorded at their call sites.
 */
export function initActivityMetricsListeners(): void {
  if (listenersInitialized || typeof window === "undefined") return;
  listenersInitialized = true;

  window.addEventListener("swarm-block-mined", () => {
    void (async () => {
      try {
        const { getCurrentUser } = await import("./auth");
        const user = await getCurrentUser();
        if (!user) return;
        await recordActivity(user.id, "block_mined");
      } catch (error) {
        console.warn("[activityMetrics] Failed to record mined block", error);
      }
    })();
  });
}
