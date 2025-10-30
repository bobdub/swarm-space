import { get, getAll, put } from "./store";
import type { PostMetrics, CreditTransaction } from "@/types";

const STORE_NAME = "postMetrics";

function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

export async function ensurePostMetrics(postId: string): Promise<PostMetrics> {
  const existing = await get<PostMetrics>(STORE_NAME, postId);
  if (existing) {
    return existing;
  }

  const created: PostMetrics = {
    postId,
    viewCount: 0,
    creditTotal: 0,
    updatedAt: nowIso(),
  };
  await put(STORE_NAME, created);
  return created;
}

export async function recordPostView(postId: string, occurredAt: Date = new Date()): Promise<PostMetrics> {
  const metrics = await ensurePostMetrics(postId);
  const updated: PostMetrics = {
    ...metrics,
    viewCount: metrics.viewCount + 1,
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

function shouldCountTransaction(transaction: CreditTransaction): boolean {
  if (!transaction.postId) {
    return false;
  }

  if (transaction.amount <= 0) {
    return false;
  }

  if (transaction.type === "hype") {
    return transaction.toUserId !== "burned";
  }

  return transaction.type === "earned_post" || transaction.type === "achievement_reward";
}

export async function backfillPostCreditTotals(postIds?: string[]): Promise<void> {
  const [transactions] = await Promise.all([getAll<CreditTransaction>("creditTransactions")]);
  const relevantIds = postIds ? new Set(postIds) : undefined;
  const aggregates = new Map<string, { total: number; latest: number }>();

  for (const tx of transactions) {
    if (!shouldCountTransaction(tx)) {
      continue;
    }

    if (relevantIds && (!tx.postId || !relevantIds.has(tx.postId))) {
      continue;
    }

    const key = tx.postId!;
    const existing = aggregates.get(key) ?? { total: 0, latest: 0 };
    const createdAt = new Date(tx.createdAt).getTime();
    aggregates.set(key, {
      total: existing.total + tx.amount,
      latest: Math.max(existing.latest, Number.isFinite(createdAt) ? createdAt : 0),
    });
  }

  for (const [postId, aggregate] of aggregates) {
    const metrics = await ensurePostMetrics(postId);
    const latestIso = aggregate.latest ? new Date(aggregate.latest).toISOString() : metrics.lastCreditAt;
    const updated: PostMetrics = {
      ...metrics,
      creditTotal: aggregate.total,
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
