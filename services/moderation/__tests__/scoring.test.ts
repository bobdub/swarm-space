import { describe, expect, it } from 'bun:test';
import { scoreContent } from '../scoring';

describe('scoreContent', () => {
  it('returns a low score for benign content', () => {
    const score = scoreContent('Hello friends, excited to share our new project update!', {
      content: 'Hello friends, excited to share our new project update!',
      userReputation: 0.8,
      accountAgeMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(score.riskScore).toBeLessThan(0.3);
    expect(score.severity).toBe('low');
    expect(score.triggers.length).toBe(0);
  });

  it('detects keyword-driven spam', () => {
    const content = 'FREE MONEY!!! click here to earn $$$ visit this link for a crypto giveaway';
    const score = scoreContent(content, {
      content,
      userReputation: 0.05,
      accountAgeMs: 2 * 60 * 60 * 1000,
      priorFlagCount: 3
    });

    expect(score.riskScore).toBeGreaterThanOrEqual(0.8);
    expect(score.severity).toBe('high');
    expect(score.triggers.map(trigger => trigger.type)).toContain('keyword');
    expect(score.triggers.map(trigger => trigger.type)).toContain('metadata');
  });

  it('penalizes link heavy short posts', () => {
    const content = 'https://malicious.example https://phish.example';
    const score = scoreContent(content, {
      content,
      accountAgeMs: 5000,
      userReputation: 0.2
    });

    expect(score.riskScore).toBeGreaterThan(0.4);
    expect(score.triggers.find(trigger => trigger.type === 'link-density')).toBeTruthy();
    expect(score.triggers.find(trigger => trigger.type === 'length')).toBeTruthy();
  });
});
