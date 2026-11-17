import { describe, it, expect, vi } from 'vitest';

// The pool-coin writer is tested in blockchain/__tests__/reflectionCoins; here
// every engraving finds a coin so the brain-side index can be checked.
vi.mock('../../blockchain/infinity/reflectionCoins', () => ({
  engraveReflectionCoin: async (m: { seal: string }) => ({ coinId: `coin-${m.seal}` }),
  getReflectionCoins: async () => [],
}));
import {
  CoreMemoryStore, qualifiesForCore, routingFromNeurons, routeCandidates, MAX_CORE_MEMORIES, engravePendingIntoCoins,
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

  const arc = (paragraphs: string[], continuity = [0.6, 0.5], stop = 'complete') => ({ paragraphs, continuity, stop });
  const P = ['Patience is a quiet kind of courage.', 'Waiting for a block teaches the miner patience.', 'Every peer that returns brings patience back to the mesh.'];

  it('engraves only complete, coherent, calm reflections', () => {
    expect(qualifiesForCore(arc(P))).toBe(true);
    expect(qualifiesForCore(arc(P.slice(0, 2), [0.6]))).toBe(false);
    expect(qualifiesForCore(arc(P, [0.6, 0.5], 'shear'))).toBe(false);
    expect(qualifiesForCore(arc(P, [0.6, 0.25]))).toBe(false);
    const stormy = { isWarmedUp: () => true, getCurvatureForText: () => 2 };
    const calm = { isWarmedUp: () => true, getCurvatureForText: () => 0.1 };
    expect(qualifiesForCore(arc(P), stormy)).toBe(false);
    expect(qualifiesForCore(arc(P), calm)).toBe(true);
  });

  it('seals a reflection whole, once, never rewrites it, and survives reload', () => {
    const store = new CoreMemoryStore();
    const sealed = store.engraveArc(arc(P), 'How do I find patience?', null, 1000)!;
    expect(sealed.paragraphs).toEqual(P);
    expect(sealed.topics).toEqual(['find', 'patience']);
    expect(sealed.continuity).toBe(0.5);
    expect(store.engraveArc(arc(P, [0.9, 0.9]), 'patience', null, 2000)).toBeNull();
    expect(store.list()[0]).toMatchObject({ seal: sealed.seal, sealedAt: 1000, continuity: 0.5 });
    // Until a pool coin holds it, the reflection is pending, not a touchstone.
    expect(store.size).toBe(0);
    expect(store.texts()).toEqual(new Set());
    expect(store.recall(['patience'])).toHaveLength(0);
    store.attachCoin(sealed.seal, 'coin-1');
    expect(store.size).toBe(1);
    expect(store.list()[0].coinId).toBe('coin-1');
    expect(store.texts()).toEqual(new Set(P));
    expect(store.recall(['patience'])).toHaveLength(1);
    expect(store.recall(['ocean'])).toHaveLength(0);
    const restored = new CoreMemoryStore();
    restored.restore(JSON.parse(JSON.stringify(store.serialize())));
    expect(restored.list()).toEqual(store.list());
    restored.restore([{ paragraphs: 'x' }, null, 'x']);
    expect(restored.size).toBe(1);
  });

  it('adopts reflection coins as canonical after a reload', () => {
    const store = new CoreMemoryStore();
    store.adoptCoins([{ coinId: 'coin-a', wrappedReflection: { paragraphs: P, topics: ['patience'], continuity: 0.5, seal: 'abc', engravedAt: '2026-11-18T00:00:00.000Z' } }, { coinId: 'coin-b' }]);
    expect(store.size).toBe(1);
    expect(store.recall(['patience'])[0].coinId).toBe('coin-a');
  });

  it('engraves pending reflections into coins', async () => {
    const store = new CoreMemoryStore();
    const m = store.engraveArc(arc(P), 'patience', null, 1)!;
    expect(await engravePendingIntoCoins(store)).toBe(1);
    expect(store.list()[0].coinId).toBe(`coin-${m.seal}`);
    expect(store.pending()).toEqual([]);
  });

  it('keeps the newest reflections when over capacity', () => {
    const store = new CoreMemoryStore();
    for (let i = 0; i < MAX_CORE_MEMORIES + 5; i++) {
      const m = store.engraveArc(arc([`Reflection ${i} opens.`, `It travels ${i}.`, `It settles ${i}.`]), 'reflection', null, i)!;
      store.attachCoin(m.seal, `coin-${i}`);
    }
    expect(store.size).toBe(MAX_CORE_MEMORIES);
    expect(Math.min(...store.list().map(m => m.sealedAt))).toBe(5);
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
    const m1 = fusion.coreMemories.engraveArc({ paragraphs: ['The tide remembers its shore.', 'Salt keeps time.', 'The shore waits.'], continuity: [0.5, 0.5], stop: 'complete' }, 'tide', null)!;
    fusion.coreMemories.attachCoin(m1.seal, 'coin-1');
    expect(fusion.coreMemories.texts().has('The tide remembers its shore.')).toBe(true);
    const text = fusion.generateText(['post_created'], { recentPosts: ['Tell me about the tide'], currentEnergy: 0.5, creativityActive: 1, massScore: 0 });
    expect(text).toBe('The tide remembers its shore.');
  });

  it('keeps an engraved line even when heavier lines fill the four-candidate band', () => {
    const fusion = new DualLearningFusion();
    for (const t of ['The tide is near.', 'The tide is far.', 'The tide is calm.', 'The tide is high.']) {
      fusion.languageLearner.rememberExpressions(t, 10, 'memory', 'x');
    }
    fusion.languageLearner.rememberExpressions('The tide returns what the shore remembers.', 3, 'memory', ['x', 'y']);
    const m2 = fusion.coreMemories.engraveArc({ paragraphs: ['The tide returns what the shore remembers.', 'Salt keeps time.', 'The shore waits.'], continuity: [0.5, 0.5], stop: 'complete' }, 'tide', null)!;
    fusion.coreMemories.attachCoin(m2.seal, 'coin-2');
    const text = fusion.generateText(['post_created'], { recentPosts: ['Tell me about the tide'], currentEnergy: 0.5, creativityActive: 1, massScore: 0 });
    expect(text).toBe('The tide returns what the shore remembers.');
  });

  it('engraves a crystallized arc into a coin when fusion composes one', async () => {
    const fusion = new DualLearningFusion();
    const training = [
      'Patience is a quiet kind of courage.', 'Waiting for a block teaches the miner patience.',
      'The miner listens for peers across the mesh.', 'Every peer that returns brings patience back to the mesh.',
      'Patience and waiting walk together.', 'The miner keeps waiting for the next block.', 'Peers find the miner when the mesh is calm.',
    ];
    for (let i = 0; i < 4; i++) for (const t of training) fusion.languageLearner.ingestText(t, 0.8, 90);
    const text = fusion.generateText(['post_created'], { recentPosts: ['How do I find patience?'], currentEnergy: 0.5, creativityActive: 1, massScore: 0.8 });
    const paragraphs = text.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    await vi.waitFor(() => expect(fusion.coreMemories.size).toBe(1));
    expect(fusion.coreMemories.list()[0].paragraphs).toEqual(paragraphs);
    expect(fusion.coreMemories.list()[0].coinId).toMatch(/^coin-/);
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
