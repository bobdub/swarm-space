import { describe, it, expect } from 'vitest';
import { echoesPrompt, extractExpressions, rankExpressions } from '../infinityPersonality';
import { LanguageLearner } from '../../p2p/languageLearner';
import { seedInfinityCanon } from '../infinityCorpus';

describe('Infinity personality realization', () => {
  it('preserves the full derivative expression and subscripts', () => {
    const formula = '𝒟_μ u(x) := ( u(x + ℓ_min e_μ) - u(x) ) / ℓ_min;';
    expect(extractExpressions(formula)).toEqual([formula]);
  });

  it('does not split Ember decimal notation', () => {
    const ember = 'Ember 0.9: a system becomes conscious when it asks a question.';
    expect(extractExpressions(ember)).toEqual([ember]);
  });

  it('rejects a copied two-word opening hidden after notation', () => {
    expect(echoesPrompt('|Ψ_Infinity⟩ hello old of to when.', 'Hello old friend')).toBe(true);
    expect(echoesPrompt('The field remembers friendship.', 'Hello old friend')).toBe(false);
  });

  it('declines fragments rather than treating a large vocabulary as a sentence', () => {
    expect(extractExpressions('hello old of to when ember am it field is my')).toEqual([]);
    expect(extractExpressions('𝒪_UQRC(u = ν Δ u')).toEqual([]);
  });

  it('requires topical support, not just personality glyphs', () => {
    const expressions = [{ text: 'The UQRC operator is 𝒪_UQRC(u) = ν Δ u + ℛ u + L_S u.', weight: 1, source: 'personality' as const }];
    expect(rankExpressions(expressions, { recentPosts: ['Hello old friend'], maxChars: 1000 })).toEqual([]);
    expect(rankExpressions(expressions, { recentPosts: ['Explain UQRC'], maxChars: 1000 })).toEqual(expressions);
  });

  it('restores whole expressions locally without adding them to vocabulary digests', () => {
    const learner = new LanguageLearner();
    const formula = 'λ(a) = a · 10^-100 is the action coupling — small but never zero.';
    learner.rememberExpressions(formula);
    const restored = new LanguageLearner();
    restored.restoreExpressions(learner.getExpressions());
    expect(restored.getExpressions()[0]?.text).toBe(formula);
    expect(restored.exportVocab()).toEqual({});
  });

  it('restores canon once when an old vocabulary snapshot already contains its glyphs', () => {
    const learner = new LanguageLearner();
    learner.mergeVocab({ '|Ψ_Infinity⟩': 10 });
    seedInfinityCanon(learner, 'network-entity');
    const before = learner.getExpressions();
    expect(before.some(expression => expression.text.includes('𝒪_UQRC(u) = ν Δ u'))).toBe(true);
    seedInfinityCanon(learner, 'network-entity');
    expect(learner.getExpressions()).toEqual(before);
  });
});