import { createHash } from 'crypto';
import { scoreContent } from './scoring';
import type {
  AccountLimitEvaluation,
  AlertRecord,
  AlertType,
  ModerationServiceOptions,
  SubmissionEvaluation,
  SubmissionInput
} from './types';

export type {
  AccountLimitEvaluation,
  AlertRecord,
  AlertType,
  ModerationServiceOptions,
  SubmissionEvaluation,
  SubmissionInput
} from './types';
export type { PostRateLimitConfig, SylabisTokenConfig } from './types';

const DEFAULT_DAILY_ACCOUNT_LIMIT = 10;
const DEFAULT_RETENTION_MS = 36 * 60 * 60 * 1000; // 36h gives leeway for delayed pruning
const DEFAULT_POST_INTERVAL_MS = 300;
const DEFAULT_POST_DAILY_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const DEFAULT_ALERT_THRESHOLD = 0.6;
const DEFAULT_MAX_ALERTS = 200;

interface TokenCounter {
  count: number;
  windowExpiresAt: number;
}

interface PostWindow {
  lastPostAt: number;
  dailyBytes: number;
  dailyWindowExpiresAt: number;
}

export class ModerationService {
  private readonly rotatingSalt: string;
  private readonly dailyAccountLimit: number;
  private readonly retentionMs: number;
  private readonly minIntervalMs: number;
  private readonly dailyBytesLimit: number;
  private readonly alertThreshold: number;
  private readonly maxAlerts: number;

  private readonly sylabisTokens = new Map<string, TokenCounter>();
  private readonly postWindows = new Map<string, PostWindow>();
  private readonly alerts: AlertRecord[] = [];

  constructor(options: ModerationServiceOptions) {
    const sylabis = options.sylabis;
    this.rotatingSalt = sylabis.rotatingSalt;
    this.dailyAccountLimit = sylabis.dailyAccountLimit ?? DEFAULT_DAILY_ACCOUNT_LIMIT;
    this.retentionMs = sylabis.retentionMs ?? DEFAULT_RETENTION_MS;

    this.minIntervalMs = options.posting?.minIntervalMs ?? DEFAULT_POST_INTERVAL_MS;
    this.dailyBytesLimit = options.posting?.dailyBytesLimit ?? DEFAULT_POST_DAILY_BYTES;
    this.alertThreshold = options.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;
    this.maxAlerts = options.maxAlerts ?? DEFAULT_MAX_ALERTS;
  }

  evaluateAccountCreation(originIdentifier: string, timestamp = Date.now()): AccountLimitEvaluation {
    const token = generateSylabisToken(originIdentifier, timestamp, this.rotatingSalt, 24 * 60 * 60 * 1000);
    const entry = this.sylabisTokens.get(token);
    const windowExpiresAt = bucketExpiresAt(timestamp, 24 * 60 * 60 * 1000);

    if (!entry) {
      this.sylabisTokens.set(token, { count: 1, windowExpiresAt });
      this.pruneSylabis(timestamp);
      return {
        ok: true,
        remaining: this.dailyAccountLimit - 1,
        windowExpiresAt
      };
    }

    if (entry.windowExpiresAt !== windowExpiresAt) {
      // bucket rotated; reset counter
      entry.count = 0;
      entry.windowExpiresAt = windowExpiresAt;
    }

    entry.count += 1;
    this.pruneSylabis(timestamp);

    if (entry.count > this.dailyAccountLimit) {
      this.pushAlert({
        type: 'sylabis-limit',
        createdAt: timestamp,
        originToken: token,
        description: `Sylabis limit exceeded: ${entry.count} signups in rolling 24h window`,
        metadata: { limit: this.dailyAccountLimit }
      });

      return {
        ok: false,
        remaining: 0,
        reason: 'daily-signup-limit',
        windowExpiresAt
      };
    }

    return {
      ok: true,
      remaining: Math.max(this.dailyAccountLimit - entry.count, 0),
      windowExpiresAt
    };
  }

  evaluateSubmission(input: SubmissionInput): SubmissionEvaluation {
    const timestamp = input.timestamp ?? Date.now();
    const reasons: string[] = [];
    let blocked = false;
    let rateLimited = false;

    const postWindow = this.getPostWindow(input.userId, timestamp);

    if (timestamp - postWindow.lastPostAt < this.minIntervalMs) {
      blocked = true;
      rateLimited = true;
      reasons.push('posting-too-fast');
      this.pushAlert({
        type: 'post-interval',
        createdAt: timestamp,
        userId: input.userId,
        originToken: input.originToken,
        description: `Post attempted ${timestamp - postWindow.lastPostAt}ms after previous submission`,
        metadata: { minIntervalMs: this.minIntervalMs }
      });
    }

    const bytesAfter = postWindow.dailyBytes + input.sizeBytes;
    if (!blocked && bytesAfter > this.dailyBytesLimit) {
      blocked = true;
      rateLimited = true;
      reasons.push('daily-volume-exceeded');
      this.pushAlert({
        type: 'post-volume',
        createdAt: timestamp,
        userId: input.userId,
        originToken: input.originToken,
        description: `Daily posting volume ${bytesAfter} bytes exceeds limit`,
        metadata: { dailyLimit: this.dailyBytesLimit }
      });
    }

    const score = scoreContent(input.content, input);
    if (score.riskScore >= this.alertThreshold) {
      this.pushAlert({
        type: 'content-flag',
        createdAt: timestamp,
        userId: input.userId,
        originToken: input.originToken,
        description: `Content flagged with risk score ${score.riskScore.toFixed(2)}`,
        score: score.riskScore,
        metadata: { triggers: score.triggers }
      });
    }

    if (!blocked) {
      postWindow.lastPostAt = timestamp;
      postWindow.dailyBytes = bytesAfter;
    }

    const action: SubmissionEvaluation['action'] = blocked
      ? 'throttle'
      : score.riskScore >= this.alertThreshold
        ? 'flag'
        : 'allow';

    if (blocked) {
      reasons.push('rate-limited');
    }

    return {
      action,
      score,
      rateLimited,
      blocked,
      reasons
    };
  }

  getAlerts(): AlertRecord[] {
    return [...this.alerts];
  }

  getDashboardSummary(): {
    totals: Record<AlertType, number>;
    recentAlerts: AlertRecord[];
    highRiskAlerts: AlertRecord[];
  } {
    const totals: Record<AlertType, number> = {
      'sylabis-limit': 0,
      'post-interval': 0,
      'post-volume': 0,
      'content-flag': 0
    };

    for (const alert of this.alerts) {
      totals[alert.type] += 1;
    }

    const highRiskAlerts = this.alerts
      .filter(alert => alert.type === 'content-flag' && (alert.score ?? 0) >= this.alertThreshold)
      .slice(-20);

    return {
      totals,
      recentAlerts: this.alerts.slice(-50),
      highRiskAlerts
    };
  }

  reset(): void {
    this.sylabisTokens.clear();
    this.postWindows.clear();
    this.alerts.length = 0;
  }

  private getPostWindow(userId: string, timestamp: number): PostWindow {
    const entry = this.postWindows.get(userId);
    const windowExpiresAt = bucketExpiresAt(timestamp, 24 * 60 * 60 * 1000);
    if (entry && entry.dailyWindowExpiresAt === windowExpiresAt) {
      return entry;
    }

    const window: PostWindow = entry
      ? { ...entry, dailyBytes: 0, dailyWindowExpiresAt: windowExpiresAt }
      : { lastPostAt: 0, dailyBytes: 0, dailyWindowExpiresAt: windowExpiresAt };

    this.postWindows.set(userId, window);
    return window;
  }

  private pushAlert(alert: Omit<AlertRecord, 'id'>): void {
    const id = `${alert.type}:${alert.createdAt}:${Math.random().toString(36).slice(2, 8)}`;
    this.alerts.push({ ...alert, id });

    if (this.alerts.length > this.maxAlerts) {
      this.alerts.splice(0, this.alerts.length - this.maxAlerts);
    }
  }

  private pruneSylabis(now: number): void {
    const cutoff = now - this.retentionMs;
    for (const [token, entry] of this.sylabisTokens.entries()) {
      if (entry.windowExpiresAt < cutoff) {
        this.sylabisTokens.delete(token);
      }
    }
  }
}

export function generateSylabisToken(originIdentifier: string, timestamp: number, rotatingSalt: string, bucketMs: number): string {
  const bucket = Math.floor(timestamp / bucketMs);
  const hash = createHash('sha256');
  hash.update(originIdentifier);
  hash.update(rotatingSalt);
  hash.update(bucket.toString());
  return hash.digest('hex');
}

export function bucketExpiresAt(timestamp: number, bucketMs: number): number {
  const bucket = Math.floor(timestamp / bucketMs);
  return (bucket + 1) * bucketMs;
}
