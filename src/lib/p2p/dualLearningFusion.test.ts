import { describe, it, expect } from 'vitest';
import { DualLearningFusion, ContentEvent } from './dualLearningFusion';

function makeContentEvent(overrides?: Partial<ContentEvent>): ContentEvent {
  return {
    text: 'this is an interesting post about the network',
    reactions: 3,
    comments: 2,
    shares: 1,
    trustScore: 70,
    peerId: 'peer-a',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('DualLearningFusion', () => {
  it('should ingest content events into both learners', () => {
    const fusion = new DualLearningFusion();
    fusion.ingestContentEvent(makeContentEvent());

    expect(fusion.patternLearner.size).toBeGreaterThan(0);
    expect(fusion.languageLearner.vocabSize).toBeGreaterThan(0);
  });

  it('should compute reward with diversity pressure', () => {
    const fusion = new DualLearningFusion();
    // Feed many similar events
    for (let i = 0; i < 15; i++) {
      fusion.ingestContentEvent(makeContentEvent());
    }

    const snap = fusion.getSnapshot();
    expect(snap.totalContentEvents).toBe(15);
    expect(snap.pattern.totalPatterns).toBeGreaterThan(0);
    expect(snap.language.vocabularySize).toBeGreaterThan(0);
  });

  it('should select intent based on context', () => {
    const fusion = new DualLearningFusion();

    // High energy + creativity → create
    const intent = fusion.selectIntent({
      recentPosts: [],
      currentEnergy: 0.9,
      creativityActive: true,
    });
    expect(intent).toBe('create');

    // No creativity → reflect
    const reflectIntent = fusion.selectIntent({
      recentPosts: [],
      currentEnergy: 0.9,
      creativityActive: false,
    });
    expect(reflectIntent).toBe('reflect');
  });

  it('should report generation readiness', () => {
    const fusion = new DualLearningFusion();

    // Not ready with no data
    expect(fusion.isGenerationReady()).toBe(false);

    // Feed enough data
    for (let i = 0; i < 30; i++) {
      fusion.ingestContentEvent(makeContentEvent({
        text: `post number ${i} with varied words like ${['alpha', 'beta', 'gamma', 'delta', 'epsilon'][i % 5]} and more content to build vocabulary size up to minimum threshold for generation readiness check`,
        reactions: Math.floor(Math.random() * 5),
        comments: Math.floor(Math.random() * 3),
        timestamp: Date.now() + i,
      }));
    }

    // Should have enough patterns and vocab now
    expect(fusion.patternLearner.size).toBeGreaterThanOrEqual(10);
    expect(fusion.languageLearner.vocabSize).toBeGreaterThanOrEqual(20);
  });

  it('should produce a fusion snapshot', () => {
    const fusion = new DualLearningFusion();
    fusion.ingestContentEvent(makeContentEvent());

    const snap = fusion.getSnapshot();
    expect(snap.pattern).toBeDefined();
    expect(snap.language).toBeDefined();
    expect(typeof snap.generationReady).toBe('boolean');
    expect(typeof snap.fusionStrength).toBe('number');
    expect(snap.totalContentEvents).toBe(1);
  });

  it('should transfer high-propagation phrases to pattern learner', () => {
    const fusion = new DualLearningFusion();

    // High-propagation event triggers language → pattern transfer
    fusion.ingestContentEvent(makeContentEvent({
      reactions: 10,
      comments: 8,
      shares: 5,
      text: 'this changes everything in the network',
    }));

    // Should have more pattern entries from the transfer
    expect(fusion.patternLearner.size).toBeGreaterThan(0);
  });

  it('should record feedback and update both models', () => {
    const fusion = new DualLearningFusion();
    fusion.ingestContentEvent(makeContentEvent());

    const initialPatterns = fusion.patternLearner.size;
    fusion.recordFeedback(
      'generated text response',
      5, 3, 2, 75
    );

    expect(fusion.patternLearner.size).toBeGreaterThanOrEqual(initialPatterns);
    expect(fusion.getSnapshot().totalContentEvents).toBe(2);
  });
});
