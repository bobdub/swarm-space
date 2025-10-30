import { describe, expect, it } from 'bun:test';
import { calculateTrendingScore, rankTrendingPosts, buildTrendingSignal, buildTrendingAnalyticsSnapshot } from '../trending';
import type { Post, PostMetrics } from '../../src/types';

const now = new Date('2024-04-12T12:00:00.000Z');

function createPost(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    author: `user-${id}`,
    type: 'text',
    content: 'sample',
    createdAt: '2024-04-12T08:00:00.000Z',
    likes: 0,
    ...overrides
  } as Post;
}

function createMetrics(overrides: Partial<PostMetrics> = {}): PostMetrics {
  const metrics: PostMetrics = {
    postId: overrides.postId ?? 'p1',
    viewCount: 0,
    viewTotal: 0,
    creditTotal: 0,
    creditCount: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  if (overrides.viewTotal === undefined && metrics.viewTotal === 0 && metrics.viewCount > 0) {
    metrics.viewTotal = metrics.viewCount;
  }
  return metrics;
}

describe('calculateTrendingScore', () => {
  it('prioritises credits over views and engagement', () => {
    const baseSignal = buildTrendingSignal(createPost('a'), createMetrics({ postId: 'a' }));
    const creditHeavy = { ...baseSignal, creditTotal: 300, creditCount: 24, viewTotal: 150, likeCount: 10 };
    const viewHeavy = { ...baseSignal, creditTotal: 50, creditCount: 6, viewTotal: 1800, likeCount: 40 };

    const creditScore = calculateTrendingScore(creditHeavy, now);
    const viewScore = calculateTrendingScore(viewHeavy, now);

    expect(creditScore.weightedScore).toBeGreaterThan(viewScore.weightedScore);
    expect(creditScore.creditTotal).toBeGreaterThan(viewScore.creditTotal);
    expect(creditScore.creditCount).toBeGreaterThan(viewScore.creditCount);
  });

  it('rewards posts with sustained credit counts', () => {
    const baseSignal = buildTrendingSignal(
      createPost('b'),
      createMetrics({ postId: 'b', creditTotal: 200, creditCount: 5, viewTotal: 400 })
    );

    const sustainedCredits = { ...baseSignal, creditCount: 30, creditTotal: 240 };
    const burstCredits = { ...baseSignal, creditCount: 6, creditTotal: 240 };

    const sustainedScore = calculateTrendingScore(sustainedCredits, now);
    const burstScore = calculateTrendingScore(burstCredits, now);

    expect(sustainedScore.creditCount).toBeGreaterThan(burstScore.creditCount);
    expect(sustainedScore.weightedScore).toBeGreaterThan(burstScore.weightedScore);
  });

  it('applies freshness decay for stale posts', () => {
    const recent = buildTrendingSignal(
      createPost('recent', { createdAt: '2024-04-12T11:00:00.000Z' }),
      createMetrics({ postId: 'recent', creditTotal: 120, viewCount: 600, lastViewAt: '2024-04-12T11:30:00.000Z' })
    );
    const stale = buildTrendingSignal(
      createPost('stale', { createdAt: '2024-03-29T11:00:00.000Z' }),
      createMetrics({ postId: 'stale', creditTotal: 120, viewCount: 600, lastViewAt: '2024-03-29T11:30:00.000Z' })
    );

    const recentScore = calculateTrendingScore(recent, now);
    const staleScore = calculateTrendingScore(stale, now);

    expect(recentScore.freshness).toBeGreaterThan(staleScore.freshness);
    expect(recentScore.weightedScore).toBeGreaterThan(staleScore.weightedScore);
  });
});

describe('rankTrendingPosts', () => {
  it('returns posts sorted by weighted score with analytics snapshot', () => {
    const posts: Post[] = [
      createPost('p1', { likes: 12 }),
      createPost('p2', { likes: 6 })
    ];

    const metrics = new Map<string, PostMetrics>([
      [
        'p1',
        createMetrics({
          postId: 'p1',
          creditTotal: 50,
          creditCount: 4,
          viewCount: 200,
          viewTotal: 200,
          lastCreditAt: '2024-04-12T10:00:00.000Z'
        })
      ],
      [
        'p2',
        createMetrics({
          postId: 'p2',
          creditTotal: 150,
          creditCount: 12,
          viewCount: 60,
          viewTotal: 60,
          lastCreditAt: '2024-04-12T09:00:00.000Z'
        })
      ]
    ]);

    const ranked = rankTrendingPosts({ posts, metricsByPost: metrics, now });

    expect(ranked).toHaveLength(2);
    expect(ranked[0].post.id).toBe('p2');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);

    const snapshot = buildTrendingAnalyticsSnapshot(ranked);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].postId).toBe('p2');
    expect(snapshot[0].creditTotal).toBeGreaterThan(snapshot[0].view);
    expect(snapshot[0].creditCount).toBeGreaterThan(0);
  });
});
