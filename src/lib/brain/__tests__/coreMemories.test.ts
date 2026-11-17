import { describe, it, expect } from 'vitest';
import {
  CoreMemoryStore, qualifiesForCore, routingFromNeurons, routeCandidates, MAX_CORE_MEMORIES,
} from '../coreMemories';
import { LanguageLearner } from '../../p2p/languageLearner';
import { DualLearningFusion } from '../../p2p/dualLearningFusion';
import { composeArc } from '../discursiveArc';
import { SemanticLattice } from '../../uqrc/semanticBasins';

const deep = (text: string, voices = ['a', 'b'], weight = 4) => ({ text, weight, source: 'memory' as const, voices });

describe('Engraved core memories (Phase 4)', () => {
  it('records distinct voices on learned expressions and restores them', () => {
    const learner = new LanguageLearner();
    learner.ingestText('Patience carries the mesh through winter.', 0.8, 90, 'peer-a');
    learner.ingestText('Patience carries the mesh through winter.', 0.8, 90, 'peer-b');
    learner.ingestText('Patience carries the mesh through winter.', 0.8, 90, 'peer-a');
    const [line] = learner.getExpressions();
    expect(line.voices).toEqual(['peer-a', 'peer-b']);
    const restored = new LanguageLearner();
    restored.restoreExpressions(JSON.parse(JSON.stringify(learner.getExpressions())));
    expect(restored.getExpressions()[0].voices).toEqual(['peer-a', 'peer-b']);
  });

  it('engraves only deep, multi-voice, calm memory lines', () => {
    expect(qualifiesForCore(deep('Patience carries the mesh through winter.'))).toBe(true);
    expect(qualifiesForCore(deep('Patience carries the mesh through winter.', ['a']))).toBe(false);
    expect(qualifiesForCore(deep('Patience carries the mesh through winter.', ['a', 'b'], 1))).toBe(false);
    expect(qualifiesForCore({ ...deep('Patience carries the mesh through winter.'), source: 'personality' })).toBe(false);
    expect(qualifiesForCore(deep('So it goes.'))).toBe(false);
    const stormy = { isWarmedUp: () => true, getCurvatureForText: () => 2 };
    const calm = { isWarmedUp: () => true, getCurvatureForText: () => 0.1 };
    expect(qualifiesForCore(deep('Patience carries the mesh through winter.'), stormy)).toBe(false);
    expect(qualifiesForCore(deep('Patience carries the mesh through winter.'), calm)).toBe(true);
  });

  it('seals once, never rewrites, and survives reload', () => {
    const store = new CoreMemoryStore();
    const first = store.sealFrom([deep('Patience carries the mesh through winter.')], null, 1000);
    expect(first).toHaveLength(1);
    const seal = first[0].seal;
    expect(store.sealFrom([deep('Patience carries the mesh through winter.', ['a', 'b', 'c'], 9)], null, 2000)).toEqual([]);
    expect(store.list()[0]).toMatchObject({ seal, sealedAt: 1000, weight: 4 });
    const restored = new CoreMemoryStore();
    restored.restore(JSON.parse(JSON.stringify(store.serialize())));
    expect(restored.list()).toEqual(store.list());
    restored.restore([{ text: 1 }, null, 'x']);
    expect(restored.size).toBe(1);
  });

  it('keeps the deepest engravings when over capacity', () => {
    const store = new CoreMemoryStore();
    const lines = Array.from({ length: MAX_CORE_MEMORIES + 5 }, (_, i) => deep(`Memory number ${i} settles into quiet ledgers.`, ['a', 'b'], 3 + (i % 7)));
    store.sealFrom(lines, null, 1);
    expect(store.size).toBe(MAX_CORE_MEMORIES);
    // Ten lines weigh 3; the five lightest of them gave way.
    expect(store.list().filter(m => m.weight === 3)).toHaveLength(5);
  });
});

describe('Attentional routing (Phase 4)', () => {
  const engine = {
    getAllNeurons: () => [{ peerId: 'busy' }, { peerId: 'quiet' }],
    getPeerScore: (id: string) => (id === 'busy' ? 10 : 2),
  };

  it('normalizes voices against the strongest synapse', () => {
    const route = routingFromNeurons(engine);
    expect(route(['busy'])).toBe(1);
    expect(route(['quiet'])).toBeCloseTo(0.2);
    expect(route(['stranger'])).toBe(0);
    expect(route(undefined)).toBe(0);
  });

  it('orders an eligible band: core first, then routing, then relevance', () => {
    const band = [
      { text: 'a', voices: ['quiet'] },
      { text: 'b', voices: ['busy'] },
      { text: 'c', voices: [] },
    ];
    expect(routeCandidates(band, undefined, routingFromNeurons(engine)).map(c => c.text)).toEqual(['b', 'a', 'c']);
    expect(routeCandidates(band, new Set(['c']), routingFromNeurons(engine)).map(c => c.text)).toEqual(['c', 'b', 'a']);
    expect(routeCandidates(band).map(c => c.text)).toEqual(['a', 'b', 'c']);
  });

  it('lets a single reply prefer an engraved line within the relevance band', () => {
    const fusion = new DualLearningFusion();
    fusion.languageLearner.rememberExpressions('The tide keeps every promise.', 1, 'memory', 'x');
    fusion.languageLearner.rememberExpressions('The tide remembers its shore.', 4, 'memory', ['x', 'y']);
    fusion.coreMemories.sealFrom(fusion.languageLearner.getExpressions(), null);
    expect(fusion.coreMemories.size).toBe(1);
    const text = fusion.generateText(['post_created'], { recentPosts: ['Tell me about the tide'], currentEnergy: 0.5, creativityActive: 1, massScore: 0 });
    expect(text).toBe('The tide remembers its shore.');
  });

  it('lets the arc unearth an engraved memory first', () => {
    const l = new SemanticLattice();
    for (let i = 0; i < 4; i++) {
      l.ingest('Patience waiting.', 0.8);
    }
    const expressions = [
      deep('Patience is a quiet kind of courage.', ['a']),
      deep('Waiting teaches quiet resolve.', ['a']),
      deep('Waiting turns small hours into harvest.', ['a', 'b']),
    ];
    const arc = composeArc({
      prompt: 'Tell me about patience', expressions, semantic: l, maxChars: 400, maxTotalChars: 1600,
      coreMemories: new Set(['Waiting turns small hours into harvest.']),
    })!;
    expect(arc.paragraphs[1]).toMatch(/^Waiting turns small hours into harvest\./);
  });
});
