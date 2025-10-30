import type { Post, PostMetrics } from "../src/types";

export interface TrendingSignal {
  postId: string;
  createdAt: string;
  likeCount: number;
  creditTotal: number;
  viewTotal: number;
  lastCreditAt?: string;
  lastViewAt?: string;
}

export interface TrendingWeights {
  credit: number;
  view: number;
  engagement: number;
}

export interface TrendingScoreBreakdown {
  credit: number;
  view: number;
  engagement: number;
  freshness: number;
  weightedScore: number;
  raw: {
    creditTotal: number;
    viewTotal: number;
    likeCount: number;
    hoursSinceLatestActivity: number;
  };
}

export interface RankedTrendingPost {
  post: Post;
  score: number;
  breakdown: TrendingScoreBreakdown;
}

export const TRENDING_WEIGHTS: TrendingWeights = {
  credit: 0.65,
  view: 0.25,
  engagement: 0.1,
};

const CREDIT_TARGET = 250;
const VIEW_TARGET = 1200;
const ENGAGEMENT_TARGET = 75;
const FRESHNESS_HALFLIFE_HOURS = 18;

function normalize(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const scaled = Math.log10(1 + value);
  const targetScaled = Math.log10(1 + Math.max(target, 1));
  if (targetScaled === 0) {
    return 0;
  }
  return Math.min(1, scaled / targetScaled);
}

function computeFreshnessFactor(latestActivityMs: number, nowMs: number): number {
  const deltaHours = Math.max(0, (nowMs - latestActivityMs) / (1000 * 60 * 60));
  if (!Number.isFinite(deltaHours)) {
    return 1;
  }

  if (deltaHours === 0) {
    return 1;
  }

  const decayConstant = Math.log(2) / FRESHNESS_HALFLIFE_HOURS;
  const freshness = Math.exp(-decayConstant * deltaHours);
  return 0.4 + 0.6 * freshness;
}

function latestActivityTimestamp(signal: TrendingSignal): number {
  const timestamps = [signal.createdAt, signal.lastCreditAt, signal.lastViewAt]
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) {
    return Date.now();
  }

  return Math.max(...timestamps);
}

export function calculateTrendingScore(signal: TrendingSignal, now: Date | number = Date.now()): TrendingScoreBreakdown {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const creditComponent = normalize(signal.creditTotal, CREDIT_TARGET);
  const viewComponent = normalize(signal.viewTotal, VIEW_TARGET);
  const engagementComponent = normalize(signal.likeCount, ENGAGEMENT_TARGET);
  const latestActivityMs = latestActivityTimestamp(signal);
  const freshness = computeFreshnessFactor(latestActivityMs, nowMs);
  const weightedScore =
    (creditComponent * TRENDING_WEIGHTS.credit +
      viewComponent * TRENDING_WEIGHTS.view +
      engagementComponent * TRENDING_WEIGHTS.engagement) *
    freshness;

  const hoursSinceLatestActivity = Math.max(0, (nowMs - latestActivityMs) / (1000 * 60 * 60));

  return {
    credit: creditComponent,
    view: viewComponent,
    engagement: engagementComponent,
    freshness,
    weightedScore,
    raw: {
      creditTotal: signal.creditTotal,
      viewTotal: signal.viewTotal,
      likeCount: signal.likeCount,
      hoursSinceLatestActivity,
    },
  };
}

export function buildTrendingSignal(post: Post, metrics?: PostMetrics): TrendingSignal {
  return {
    postId: post.id,
    createdAt: post.createdAt,
    likeCount: post.likes ?? 0,
    creditTotal: metrics?.creditTotal ?? 0,
    viewTotal: metrics?.viewCount ?? 0,
    lastCreditAt: metrics?.lastCreditAt,
    lastViewAt: metrics?.lastViewAt,
  };
}

export function rankTrendingPosts(params: {
  posts: Post[];
  metricsByPost: Map<string, PostMetrics>;
  now?: Date;
}): RankedTrendingPost[] {
  const now = params.now ?? new Date();
  return params.posts
    .map((post) => {
      const metrics = params.metricsByPost.get(post.id);
      const signal = buildTrendingSignal(post, metrics);
      const breakdown = calculateTrendingScore(signal, now);
      return {
        post,
        score: breakdown.weightedScore,
        breakdown,
      } satisfies RankedTrendingPost;
    })
    .sort((a, b) => b.score - a.score);
}

export function rankTrendingVideos(params: {
  posts: Post[];
  metricsByPost: Map<string, PostMetrics>;
  now?: Date;
}): RankedTrendingPost[] {
  const videos = params.posts.filter((post) => post.type === "video");
  return rankTrendingPosts({ posts: videos, metricsByPost: params.metricsByPost, now: params.now });
}

export interface TrendingAnalyticsRow {
  postId: string;
  score: number;
  credit: number;
  view: number;
  engagement: number;
  freshness: number;
}

export function buildTrendingAnalyticsSnapshot(entries: RankedTrendingPost[]): TrendingAnalyticsRow[] {
  return entries.map((entry) => ({
    postId: entry.post.id,
    score: entry.score,
    credit: entry.breakdown.credit,
    view: entry.breakdown.view,
    engagement: entry.breakdown.engagement,
    freshness: entry.breakdown.freshness,
  }));
}
