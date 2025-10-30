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
});
