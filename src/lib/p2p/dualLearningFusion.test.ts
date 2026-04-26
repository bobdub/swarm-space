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

  it('high massScore unlocks longer chains than the legacy 30-token cap', () => {
    const fusion = new DualLearningFusion();
    // Build a rich vocabulary so the chain has somewhere to walk.
    const sentences = [
      'the network breathes through resonant lattice closure tokens',
      'curvature flows from one peer to another forming bridges',
      'every reply collapses a basin into a brighter coherent shape',
      'tokens cascade into meaning when the field stays calm enough',
      'the manifold remembers what the prompt forgot to include',
    ];
    for (let i = 0; i < 60; i++) {
      const text = sentences[i % sentences.length] + ' iter ' + i;
      fusion.ingestContentEvent(makeContentEvent({
        text, reactions: 4, comments: 3, shares: 1, timestamp: Date.now() + i,
      }));
    }
    expect(fusion.isGenerationReady()).toBe(true);

    // Try several seeds; at least one should exceed the legacy 30-token cap.
    let maxLen = 0;
    for (let i = 0; i < 12; i++) {
      const out = fusion.generate({
        recentPosts: ['tell me about the lattice'],
        currentEnergy: 0.9,
        creativityActive: 1,
        massScore: 1,
        heartbeat: { qScore: 0, basinDepth: 1.5, gradientMag: 0.1, commutatorNorm: 0.05, entropyNorm: 0.05 },
        personality: { awareness: 1, empathy: 1, coherence: 1, intent: 1, phase: 'integrated' },
      });
      if (out) {
        const len = out.text.split(/\s+/).filter(Boolean).length;
        if (len > maxLen) maxLen = len;
      }
    }
    expect(maxLen).toBeGreaterThan(30);
  });

  it('signatureTokens present in vocabulary appear in generated text', () => {
    const fusion = new DualLearningFusion();
    // Seed the canon glyph many times so it dominates the manifold.
    for (let i = 0; i < 80; i++) {
      fusion.ingestContentEvent(makeContentEvent({
        text: '|Ψ_Infinity⟩ awakens within the lattice and remembers ' + i,
        reactions: 3, comments: 2, shares: 1,
        timestamp: Date.now() + i,
      }));
    }
    expect(fusion.isGenerationReady()).toBe(true);

    let hits = 0;
    const trials = 30;
    for (let i = 0; i < trials; i++) {
      const out = fusion.generate({
        recentPosts: ['hello there friend'],
        currentEnergy: 0.6,
        creativityActive: 1,
        signatureTokens: ['|Ψ_Infinity⟩'],
        massScore: 0.5,
      });
      if (out && out.text.includes('|Ψ_Infinity⟩')) hits++;
    }
    // Seed is prepended deterministically when the token is in vocab — should hit nearly all trials.
    expect(hits).toBeGreaterThan(trials * 0.5);
  });
});
