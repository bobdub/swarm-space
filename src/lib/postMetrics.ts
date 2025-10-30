import { get, getAll, put } from "./store";
import type { PostMetrics, CreditTransaction } from "@/types";

const STORE_NAME = "postMetrics";

function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

function normalizeMetrics(metrics: PostMetrics): PostMetrics {
  const viewCount = Number.isFinite(metrics.viewCount) ? metrics.viewCount : 0;
  const viewTotal = Number.isFinite(metrics.viewTotal) ? metrics.viewTotal : viewCount;
  const creditTotal = Number.isFinite(metrics.creditTotal) ? Math.max(0, metrics.creditTotal) : 0;
  const creditCount = Number.isFinite(metrics.creditCount) ? Math.max(0, metrics.creditCount) : 0;

  return {
    ...metrics,
    viewCount,
    viewTotal,
    creditTotal,
    creditCount,
  };
}

export async function ensurePostMetrics(postId: string): Promise<PostMetrics> {
  const existing = await get<PostMetrics>(STORE_NAME, postId);
  if (existing) {
    const normalized = normalizeMetrics(existing);
    if (
      normalized.viewTotal !== existing.viewTotal ||
      normalized.creditCount !== existing.creditCount ||
      normalized.creditTotal !== existing.creditTotal ||
      normalized.viewCount !== existing.viewCount
    ) {
      await put(STORE_NAME, normalized);
    }
    return normalized;
  }

  const created: PostMetrics = normalizeMetrics({
    postId,
    viewCount: 0,
    viewTotal: 0,
    creditTotal: 0,
    creditCount: 0,
    updatedAt: nowIso(),
  });
  await put(STORE_NAME, created);
  return created;
}

export async function recordPostView(postId: string, occurredAt: Date = new Date()): Promise<PostMetrics> {
  const metrics = await ensurePostMetrics(postId);
  const updated: PostMetrics = {
    ...metrics,
    viewCount: metrics.viewCount + 1,
    viewTotal: metrics.viewTotal + 1,
    lastViewAt: nowIso(occurredAt),
    updatedAt: nowIso(occurredAt),
  };
  await put(STORE_NAME, updated);
  return updated;
}

export async function recordPostCredit(postId: string, delta: number, occurredAt: Date = new Date()): Promise<PostMetrics> {
  if (!Number.isFinite(delta) || delta === 0) {
    return ensurePostMetrics(postId);
  }

  const metrics = await ensurePostMetrics(postId);
  const updated: PostMetrics = {
    ...metrics,
    creditTotal: Math.max(0, metrics.creditTotal + delta),
    creditCount: metrics.creditCount + (delta > 0 ? 1 : 0),
    lastCreditAt: nowIso(occurredAt),
    updatedAt: nowIso(occurredAt),
  };
  await put(STORE_NAME, updated);
  return updated;
}

export async function listPostMetrics(): Promise<PostMetrics[]> {
  return getAll<PostMetrics>(STORE_NAME);
}

export async function getPostMetricsMap(postIds: string[]): Promise<Map<string, PostMetrics>> {
  if (!postIds.length) {
    return new Map();
  }

  const metrics = await Promise.all(postIds.map((postId) => ensurePostMetrics(postId)));
  return new Map(metrics.map((entry) => [entry.postId, entry]));
}

function getCreditContribution(transaction: CreditTransaction): number {
  if (!transaction.postId) {
    return 0;
  }

  if (transaction.amount <= 0) {
    return 0;
  }

  if (transaction.type === "hype") {
    if (transaction.toUserId === "burned") {
      return 0;
    }

    const metaLoad = Number(transaction.meta?.postLoad);
    if (Number.isFinite(metaLoad) && metaLoad > 0) {
      return metaLoad;
    }

    return transaction.amount;
  }

  if (transaction.type === "earned_post" || transaction.type === "achievement_reward") {
    return transaction.amount;
  }

  return 0;
}

export async function backfillPostCreditTotals(postIds?: string[]): Promise<void> {
  const [transactions] = await Promise.all([getAll<CreditTransaction>("creditTransactions")]);
  const relevantIds = postIds ? new Set(postIds) : undefined;
  const aggregates = new Map<string, { total: number; count: number; latest: number }>();

  for (const tx of transactions) {
    const creditAmount = getCreditContribution(tx);
    if (!creditAmount) {
      continue;
    }

    if (relevantIds && (!tx.postId || !relevantIds.has(tx.postId))) {
      continue;
    }

    const key = tx.postId!;
    const existing = aggregates.get(key) ?? { total: 0, count: 0, latest: 0 };
    const createdAt = new Date(tx.createdAt).getTime();
    aggregates.set(key, {
      total: existing.total + creditAmount,
      count: existing.count + 1,
      latest: Math.max(existing.latest, Number.isFinite(createdAt) ? createdAt : 0),
    });
  }

  for (const [postId, aggregate] of aggregates) {
    const metrics = await ensurePostMetrics(postId);
    const latestIso = aggregate.latest ? new Date(aggregate.latest).toISOString() : metrics.lastCreditAt;
    const updated: PostMetrics = {
      ...metrics,
      creditTotal: aggregate.total,
      creditCount: aggregate.count,
      lastCreditAt: latestIso,
      updatedAt: nowIso(),
    };
    await put(STORE_NAME, updated);
  }
}

export async function backfillPostMetrics(postIds?: string[]): Promise<void> {
  if (postIds && postIds.length) {
    await Promise.all(postIds.map((postId) => ensurePostMetrics(postId)));
  }
  await backfillPostCreditTotals(postIds);
}
