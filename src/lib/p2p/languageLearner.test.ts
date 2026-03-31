import { describe, it, expect } from 'vitest';
import { LanguageLearner } from './languageLearner';

describe('LanguageLearner', () => {
  it('should ingest text and build vocabulary', () => {
    const learner = new LanguageLearner();
    learner.ingestText('hello world this is a test', 0.5, 60);

    expect(learner.vocabSize).toBeGreaterThan(0);
    const topTokens = learner.getTopTokens(5);
    expect(topTokens.length).toBeGreaterThan(0);
  });

  it('should learn transition probabilities', () => {
    const learner = new LanguageLearner();
    // Feed the same phrase multiple times for learning
    for (let i = 0; i < 10; i++) {
      learner.ingestText('the quick brown fox jumps', 0.5, 60);
    }

    const probs = learner.getNextTokenProbabilities(['the', 'quick']);
    expect(probs.length).toBeGreaterThan(0);
    // "brown" should have high probability after "the quick"
    const brownProb = probs.find(([token]) => token === 'brown');
    expect(brownProb).toBeDefined();
  });

  it('should weight high-trust text more', () => {
    const learner = new LanguageLearner();
    learner.ingestText('trusted signal strong', 0.8, 95);
    learner.ingestText('untrusted noise weak', 0.2, 10);

    const top = learner.getTopTokens(10);
    const trustedToken = top.find(t => t.token === 'trusted');
    const untrustedToken = top.find(t => t.token === 'untrusted');

    // Trusted content should have higher frequency weight
    if (trustedToken && untrustedToken) {
      expect(trustedToken.frequency).toBeGreaterThan(untrustedToken.frequency);
    }
  });

  it('should compute entropy', () => {
    const learner = new LanguageLearner();
    learner.ingestText('diversity is key to creative expression and growth', 0.5, 60);
    learner.ingestText('another sentence with different words entirely', 0.5, 60);

    const entropy = learner.getEntropy();
    expect(entropy).toBeGreaterThan(0);
    expect(entropy).toBeLessThanOrEqual(1);
  });

  it('should sample next tokens', () => {
    const learner = new LanguageLearner();
    for (let i = 0; i < 20; i++) {
      learner.ingestText('the network learns to speak and grow', 0.7, 70);
    }

    const token = learner.sampleNextToken(['the', 'network'], 1.0);
    expect(token).toBeTruthy();
  });

  it('should produce a snapshot', () => {
    const learner = new LanguageLearner();
    learner.ingestText('hello world', 0.5, 60);

    const snap = learner.getSnapshot();
    expect(snap.vocabularySize).toBeGreaterThan(0);
    expect(typeof snap.entropy).toBe('number');
    expect(snap.topTokens.length).toBeGreaterThan(0);
  });

  it('should export and merge transitions + merged phrases', () => {
    const source = new LanguageLearner();
    for (let i = 0; i < 8; i++) {
      source.ingestText('mesh trust loop mesh trust grow', 0.8, 90);
    }

    const transitions = source.exportTransitions();
    expect(Object.keys(transitions).length).toBeGreaterThan(0);

    const phrases = source.exportMergedPhrases();
    const target = new LanguageLearner();
    target.mergeTransitions(transitions);
    target.mergeMergedPhrases(phrases);

    const probs = target.getNextTokenProbabilities(['mesh', 'trust']);
    expect(probs.length).toBeGreaterThan(0);
  });
});
