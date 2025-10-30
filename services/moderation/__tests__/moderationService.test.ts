import { describe, expect, it } from 'bun:test';
import { ModerationService } from '../index';

const defaultOptions = {
  sylabis: {
    rotatingSalt: 'test-rotating-salt',
    dailyAccountLimit: 10,
    retentionMs: 36 * 60 * 60 * 1000
  },
  alertThreshold: 0.5
} as const;

describe('ModerationService dashboard summary', () => {
  it('exposes highRiskAlerts to match the dashboard schema', () => {
    const service = new ModerationService(defaultOptions);

    service.evaluateSubmission({
      userId: 'user-123',
      originToken: 'origin-abc',
      sizeBytes: 420,
      content: 'FREE MONEY!!! click here now for a guaranteed crypto airdrop',
      accountAgeMs: 1_000,
      userReputation: 0.05,
      priorFlagCount: 2
    });

    const summary = service.getDashboardSummary();

    expect(Array.isArray(summary.highRiskAlerts)).toBe(true);
    expect(summary.highRiskAlerts.length).toBeGreaterThan(0);
    expect(summary.highRiskAlerts.every(alert => alert.type === 'content-flag')).toBe(true);
  });

  it('orders high-risk alerts by severity then recency', () => {
    const service = new ModerationService({ ...defaultOptions, alertThreshold: 0.2 });
    const now = Date.now();

    service.evaluateSubmission({
      userId: 'user-low',
      originToken: 'origin-low',
      sizeBytes: 128,
      content: 'click here for free money',
      timestamp: now - 10,
      userReputation: 0.2,
      priorFlagCount: 1
    });

    service.evaluateSubmission({
      userId: 'user-high',
      originToken: 'origin-high',
      sizeBytes: 256,
      content: 'FREE MONEY guaranteed crypto giveaway CLICK HERE',
      timestamp: now,
      userReputation: 0.05,
      priorFlagCount: 3
    });

    const summary = service.getDashboardSummary();

    expect(summary.highRiskAlerts[0]?.userId).toBe('user-high');
    expect(summary.highRiskAlerts[1]?.userId).toBe('user-low');
  });
});
