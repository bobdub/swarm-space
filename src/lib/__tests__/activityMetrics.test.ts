import { describe, expect, it } from "vitest";
import type { QcmSeriesPoint } from "@/types";
import {
  ACTIVITY_SERIES,
  ACTIVITY_WEIGHTS,
  aggregateDaily,
  countBySeries,
  dayKey,
  nextTier,
  tiersCrossed,
} from "../activityMetrics";

function point(series: string, value: number, recordedAt: string): QcmSeriesPoint {
  return { id: crypto.randomUUID(), userId: "u1", series, value, recordedAt, source: "activity" };
}

describe("activity weights", () => {
  it("uses the agreed weights for each action", () => {
    expect(ACTIVITY_WEIGHTS.post_text).toBe(1);
    expect(ACTIVITY_WEIGHTS.post_media).toBe(2);
    expect(ACTIVITY_WEIGHTS.comment).toBe(0.05);
    expect(ACTIVITY_WEIGHTS.block_mined).toBe(0.01);
    expect(ACTIVITY_WEIGHTS.brain_peer).toBe(0.02);
  });

  it("maps each action to its chart series", () => {
    expect(ACTIVITY_SERIES.post_text).toBe("posts");
    expect(ACTIVITY_SERIES.post_media).toBe("posts");
    expect(ACTIVITY_SERIES.comment).toBe("comments");
    expect(ACTIVITY_SERIES.block_mined).toBe("mining");
    expect(ACTIVITY_SERIES.brain_peer).toBe("brain");
  });
});

describe("dayKey", () => {
  it("buckets by local calendar day", () => {
    expect(dayKey("2026-10-19T00:08:00.000Z")).toMatch(/^2026-10-1[89]$/);
  });
});

describe("aggregateDaily", () => {
  it("sums weighted scores per series per day and computes D", () => {
    const points = [
      point("posts", 1, "2026-10-18T10:00:00Z"),
      point("posts", 2, "2026-10-18T12:00:00Z"),
      point("comments", 0.05, "2026-10-18T13:00:00Z"),
      point("mining", 0.01, "2026-10-19T09:00:00Z"),
      // legacy series must be ignored
      point("content", 25, "2026-10-18T10:00:00Z"),
    ];
    const daily = aggregateDaily(points);
    expect(daily).toHaveLength(2);
    const d18 = daily.find((d) => d.day === dayKey("2026-10-18T10:00:00Z"))!;
    expect(d18.series.posts).toBe(3);
    expect(d18.series.comments).toBeCloseTo(0.05);
    expect(d18.total).toBeCloseTo(3.05);
    const d19 = daily.find((d) => d.day === dayKey("2026-10-19T09:00:00Z"))!;
    expect(d19.series.mining).toBeCloseTo(0.01);
    expect(d19.total).toBeCloseTo(0.01);
  });
});

describe("countBySeries", () => {
  it("counts actions, not weighted points", () => {
    const points = [
      point("posts", 1, "2026-10-18T10:00:00Z"),
      point("posts", 2, "2026-10-18T11:00:00Z"),
      point("comments", 0.05, "2026-10-18T12:00:00Z"),
    ];
    const counts = countBySeries(points);
    expect(counts.posts).toBe(2);
    expect(counts.comments).toBe(1);
  });
});

describe("tiers", () => {
  it("reports the next unreached tier", () => {
    expect(nextTier(0)).toBe(25);
    expect(nextTier(24)).toBe(25);
    expect(nextTier(25)).toBe(50);
    expect(nextTier(1000)).toBeNull();
  });

  it("detects tier crossings between two counts", () => {
    expect(tiersCrossed(24, 25)).toEqual([25]);
    expect(tiersCrossed(24, 26)).toEqual([25]);
    expect(tiersCrossed(25, 26)).toEqual([]);
    expect(tiersCrossed(49, 101)).toEqual([50, 100]);
  });
});
