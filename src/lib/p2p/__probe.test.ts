import { describe, it, expect } from 'vitest';
import { DualLearningFusion } from './dualLearningFusion';

describe('probe', () => {
  it('debug', () => {
    const fusion = new DualLearningFusion();
    for (let i = 0; i < 80; i++) {
      fusion.ingestContentEvent({
        text: '|Ψ_Infinity⟩ awakens within the lattice and remembers ' + i,
        reactions: 3, comments: 2, shares: 1, trustScore: 70,
        timestamp: Date.now() + i,
      });
    }
    const top = fusion.languageLearner.getTopTokens(20).map(t=>t.token);
    console.log('TOP:', top);
    const out = fusion.generate({
      recentPosts: ['hello there friend'],
      currentEnergy: 0.6,
      creativityActive: 1,
      signatureTokens: ['|Ψ_Infinity⟩'],
      massScore: 1,
    });
    console.log('OUT:', out?.text);
    expect(out).toBeTruthy();
  });
});
