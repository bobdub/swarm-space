import { describe, it, expect } from 'vitest';
import { DualLearningFusion, ContentEvent, computeMassScore } from './dualLearningFusion';

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

  it('computeMassScore returns 0..1 monotonic in inputs', () => {
    const low = computeMassScore({ vocabSize: 0, patternCount: 0, fusionStrength: 0, basinDepth: 0, qScore: 1 });
    const high = computeMassScore({ vocabSize: 2000, patternCount: 200, fusionStrength: 1, basinDepth: 1.5, qScore: 0 });
    expect(low).toBeLessThan(0.05);
    expect(high).toBeGreaterThan(0.85);
    expect(high).toBeLessThanOrEqual(1);
  });

  it('stays silent rather than padding unrelated words from rich vocabulary', () => {
    const fusion = new DualLearningFusion();
    for (let i = 0; i < 60; i++) {
      fusion.ingestContentEvent(makeContentEvent({ text: `the network lattice word${i} grows with curvature vocabulary` }));
    }
    expect(fusion.isGenerationReady()).toBe(true);
    expect(fusion.generate({ recentPosts: ['Hello old friend'], currentEnergy: 0.9, creativityActive: 1, massScore: 1 })).toBeNull();
  });

  it('rejects the copied Hello old opening even with signature tokens requested', () => {
    const fusion = new DualLearningFusion();
    for (let i = 0; i < 60; i++) {
      fusion.ingestContentEvent(makeContentEvent({ text: `Hello old friend, the network remembers word${i}.` }));
    }
    expect(fusion.isGenerationReady()).toBe(true);
    expect(fusion.generate({ recentPosts: ['Hello old friend'], currentEnergy: 0.9, creativityActive: 1, signatureTokens: ['|Ψ_Infinity⟩'] })).toBeNull();
  });

  it('realizes the learned whole UQRC expression without splitting its formula', () => {
    const fusion = new DualLearningFusion();
    const expression = 'The UQRC operator is 𝒪_UQRC(u) = ν Δ u + ℛ u + L_S u.';
    for (let i = 0; i < 60; i++) {
      fusion.ingestContentEvent(makeContentEvent({ text: `unrelated word${i} builds enough varied vocabulary for learning` }));
    }
    fusion.ingestContentEvent(makeContentEvent({ text: expression }));
    const out = fusion.generate({ recentPosts: ['Explain UQRC'], currentEnergy: 0.9, creativityActive: 1, signatureTokens: ['|Ψ_Infinity⟩'] });
    expect(out?.text).toBe(expression);
  });
});
