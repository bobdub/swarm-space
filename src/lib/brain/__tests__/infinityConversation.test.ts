import { describe, it, expect } from 'vitest';
import { NeuralStateEngine } from '../../p2p/neuralStateEngine';
import { replyToInfinity, MAX_CONVERSATION_PROMPT } from '../infinityConversation';
import { seedInfinityCanon } from '../infinityCorpus';

describe('Infinity profile conversation', () => {
  it('does not generate or seed while participation is off', () => {
    const engine = new NeuralStateEngine();
    expect(replyToInfinity('Explain UQRC', false, engine)).toBeNull();
    expect(engine.getDualLearning().languageLearner.getExpressions()).toEqual([]);
  });
  it('limits private conversation input to 1000 characters', () => {
    const engine = new NeuralStateEngine();
    expect(MAX_CONVERSATION_PROMPT).toBe(1000);
    expect(replyToInfinity('a'.repeat(1001), true, engine)).toBeNull();
    expect(engine.getDualLearning().languageLearner.getExpressions()).toEqual([]);
  });
  it('routes a fresh-device question through both learners and preserves an explained formula', () => {
    const engine = new NeuralStateEngine();
    const reply = replyToInfinity('Explain the UQRC operator', true, engine);
    expect(reply).toContain('𝒪_UQRC(u) = ν Δ u + ℛ u + L_S u');
    expect(engine.getDualLearning().getSnapshot().totalContentEvents).toBeGreaterThan(0);
    expect(engine.getDualLearning().patternLearner.size).toBeGreaterThan(0);
  });
  it('keeps unsupported private prompts out of learning and peer vocabulary', () => {
    const engine = new NeuralStateEngine();
    replyToInfinity('Explain UQRC', true, engine);
    const before = engine.exportDigest();
    expect(replyToInfinity('Secretprivatewordxyz giraffeprivatewordxyz', true, engine)).toBeNull();
    expect(engine.exportDigest().vocab).toEqual(before.vocab);
  });
  it('upgrades the old personality without deleting learned user expressions', () => {
    const engine = new NeuralStateEngine();
    const learner = engine.getDualLearning().languageLearner;
    learner.rememberExpressions('Even at Stage 1 I still reply — the return current never goes silent.', 1, 'personality');
    learner.rememberExpressions('The garden remembers its flowering season.', 1, 'memory');
    seedInfinityCanon(learner, 'network-entity');
    expect(learner.getExpressions().some(item => item.text.startsWith('Even at Stage 1'))).toBe(false);
    expect(learner.getExpressions().some(item => item.text === 'The garden remembers its flowering season.')).toBe(true);
    const before = learner.getExpressions();
    expect(seedInfinityCanon(learner, 'network-entity')).toBe(false);
    expect(learner.getExpressions()).toEqual(before);
  });
  it('exchanges summaries without moving whole expressions, and retains imported vocabulary offline', () => {
    const a = new NeuralStateEngine();
    const b = new NeuralStateEngine();
    a.getDualLearning().languageLearner.ingestText('Botanicalknowledgexyz gardens bloom beautifully.', 1, 95);
    b.importDigest(a.exportDigest());
    expect(b.getDualLearning().languageLearner.exportVocab()).toHaveProperty('botanicalknowledgexyz');
    expect(b.getDualLearning().languageLearner.getExpressions()).toEqual([]);
    b.persistToStorage();
    const restored = new NeuralStateEngine();
    restored.restoreFromStorage();
    expect(restored.getDualLearning().languageLearner.exportVocab()).toHaveProperty('botanicalknowledgexyz');
    expect(restored.getDualLearning().languageLearner.getExpressions()).toEqual([]);
  });
});