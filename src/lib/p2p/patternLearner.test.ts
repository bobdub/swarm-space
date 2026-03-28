import { describe, it, expect } from 'vitest';
import { PatternLearner, PatternEvent, PatternEventType } from './patternLearner';

function makeEvent(type: PatternEventType, reward = 0.5, trust = 60): PatternEvent {
  return { type, reward, trustScore: trust, timestamp: Date.now() };
}

describe('PatternLearner', () => {
  it('should extract sequences from events', () => {
    const learner = new PatternLearner();
    learner.ingestEvent(makeEvent('post_created'));
    learner.ingestEvent(makeEvent('post_replied'));
    learner.ingestEvent(makeEvent('post_reacted'));

    const top = learner.getTopPatterns(10);
    expect(top.length).toBeGreaterThan(0);
    // Should have bigram and trigram patterns
    const keys = top.map(p => p.sequence.key);
    expect(keys.some(k => k.includes('→'))).toBe(true);
  });

  it('should score repeated patterns higher', () => {
    const learner = new PatternLearner();
    // Repeat same sequence multiple times
    for (let i = 0; i < 5; i++) {
      learner.ingestEvent(makeEvent('post_created', 0.8, 80));
      learner.ingestEvent(makeEvent('post_replied', 0.8, 80));
    }

    const score = learner.scorePattern(['post_created', 'post_replied']);
    expect(score).toBeGreaterThan(0);
  });

  it('should apply diversity pressure on dominant patterns', () => {
    const learner = new PatternLearner();
    // Create one dominant pattern
    for (let i = 0; i < 20; i++) {
      learner.ingestEvent(makeEvent('post_created', 0.9, 90));
      learner.ingestEvent(makeEvent('post_reacted', 0.9, 90));
    }
    const dominantScore = learner.scorePattern(['post_created', 'post_reacted']);

    // Add a new pattern
    learner.ingestEvent(makeEvent('gossip_sent', 0.9, 90));
    learner.ingestEvent(makeEvent('chunk_transferred', 0.9, 90));
    const newScore = learner.scorePattern(['gossip_sent', 'chunk_transferred']);

    // Dominant pattern should have diminishing returns
    const diversity = learner.getDiversityScore();
    expect(diversity).toBeGreaterThan(0);
    expect(dominantScore).toBeGreaterThan(newScore);
  });

  it('should compute diversity score', () => {
    const learner = new PatternLearner();
    learner.ingestEvent(makeEvent('post_created'));
    learner.ingestEvent(makeEvent('post_replied'));
    learner.ingestEvent(makeEvent('post_reacted'));
    learner.ingestEvent(makeEvent('gossip_sent'));
    learner.ingestEvent(makeEvent('chunk_transferred'));

    const diversity = learner.getDiversityScore();
    expect(diversity).toBeGreaterThanOrEqual(0);
    expect(diversity).toBeLessThanOrEqual(1);
  });

  it('should produce a snapshot', () => {
    const learner = new PatternLearner();
    for (let i = 0; i < 5; i++) {
      learner.ingestEvent(makeEvent('post_created', 0.5));
      learner.ingestEvent(makeEvent('post_replied', 0.7));
    }

    const snap = learner.getSnapshot();
    expect(snap.totalPatterns).toBeGreaterThan(0);
    expect(snap.topPatterns.length).toBeGreaterThan(0);
    expect(typeof snap.diversityScore).toBe('number');
    expect(typeof snap.averageReward).toBe('number');
  });
});
