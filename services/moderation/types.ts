import type { ContentScore, ContentScoreContext } from './scoring';

export interface SylabisTokenConfig {
  rotatingSalt: string;
  dailyAccountLimit?: number;
  retentionMs?: number;
}

export interface PostRateLimitConfig {
  minIntervalMs?: number;
  dailyBytesLimit?: number;
}

export interface ModerationServiceOptions {
  sylabis: SylabisTokenConfig;
  posting?: PostRateLimitConfig;
  alertThreshold?: number;
  maxAlerts?: number;
}

export interface AccountLimitEvaluation {
  ok: boolean;
  remaining: number;
  reason?: string;
  windowExpiresAt: number;
}

export interface SubmissionEvaluation {
  action: 'allow' | 'flag' | 'throttle';
  score: ContentScore;
  reasons: string[];
  rateLimited: boolean;
  blocked: boolean;
}

export interface SubmissionInput extends ContentScoreContext {
  userId: string;
  originToken: string;
  sizeBytes: number;
  timestamp?: number;
}

export type AlertType = 'sylabis-limit' | 'post-interval' | 'post-volume' | 'content-flag';

export interface AlertRecord {
  id: string;
  type: AlertType;
  createdAt: number;
  userId?: string;
  originToken?: string;
  description: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export type { ContentScore, ContentScoreContext };
