import { describe, it, expect } from 'vitest';
import { composeArc, phaseContinuity, MIN_CONTINUITY } from '../discursiveArc';
import { SemanticLattice } from '../../uqrc/semanticBasins';
import { DualLearningFusion } from '../../p2p/dualLearningFusion';

const mem = (text: string, weight = 2) => ({ text, weight, source: 'memory' as const });

// A small learned world: patience ↔ waiting ↔ mining ↔ peers.
const LINES = [
  'Patience is a quiet kind of courage.',
  'Waiting for a block teaches the miner patience.',
  'The miner listens for peers across the mesh.',
  'Every peer that returns brings patience back to the mesh.',
];
const TRAINING = [
  ...LINES,
  'Patience and waiting walk together.',
  'The miner keeps waiting for the next block.',
  'Peers find the miner when the mesh is calm.',
];

function lattice(): SemanticLattice {
  const l = new SemanticLattice();
  for (let i = 0; i < 4; i++) for (const t of TRAINING) l.ingest(t, 0.8);
  return l;
}

const ctx = (prompt: string, semantic = lattice(), lines = LINES) => ({
  prompt,
  expressions: lines.map(t => mem(t)),
  semantic,
  maxChars: 400,
  maxTotalChars: 1600,
});

describe('Discursive arc (Phase 3)', () => {
  it('composes Echo → Traverse → Crystallize without repeating a sentence', () => {
    const arc = composeArc(ctx('How do I find patience?'))!;
    expect(arc.stop).toBe('complete');
    expect(arc.paragraphs).toHaveLength(3);
    // ¶1 is on the prompt topic.
    expect(arc.paragraphs[0].toLowerCase()).toContain('patience');
    // ¶2 travels to something ¶1 did not hold.
    const p1 = new Set(arc.paragraphs[0].toLowerCase().match(/\p{L}+/gu));
    expect(arc.paragraphs[1].toLowerCase().match(/\p{L}+/gu)!.some(w => w.length > 3 && !p1.has(w))).toBe(true);
    // ¶3 returns to the prompt topic.
    expect(arc.paragraphs[2].toLowerCase()).toContain('patience');
    const sentences = arc.paragraphs.flatMap(p => p.split(/(?<=[.!?])\s+/));
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const c of arc.continuity) expect(c).toBeGreaterThanOrEqual(MIN_CONTINUITY);
  });

  it('halts at the shear when the next act has no phase continuity', () => {
    // ¶1 is reached through a bridge (ocean → storm, the strongest well);
    // the traversal finds another neighbour (tide) whose line shares nothing
    // with the echo and has no learned tension to it.
    const l = new SemanticLattice();
    for (let i = 0; i < 8; i++) l.ingest('Ocean tide.', 0.8);
    for (let i = 0; i < 3; i++) l.ingest('Ocean storm.', 0.8);
    const lines = ['Every tide returns what the shore remembers.', 'A storm gathers over granite.'];
    const arc = composeArc(ctx('Tell me about the ocean', l, lines))!;
    expect(arc.paragraphs).toEqual(['A storm gathers over granite.']);
    expect(arc.stop).toBe('shear');
    expect(phaseContinuity(lines[0], lines[1], l)).toBe(0);
  });

  it('returns null when nothing supports the opening echo', () => {
    expect(composeArc(ctx('Explain quasars'))).toBeNull();
  });

  it('stops after the echo when there is nowhere to travel', () => {
    const arc = composeArc(ctx('How do I find patience?', new SemanticLattice()))!;
    expect(arc.paragraphs).toHaveLength(1);
    expect(arc.stop).toBe('unsupported');
  });

  it('respects the whole-arc character budget', () => {
    const arc = composeArc({ ...ctx('How do I find patience?'), maxTotalChars: 60 })!;
    // The echo always stands; later acts must fit the budget.
    expect(arc.paragraphs).toHaveLength(1);
  });
});

describe('Arc in DualLearningFusion', () => {
  function trained(): DualLearningFusion {
    const fusion = new DualLearningFusion();
    for (let i = 0; i < 4; i++) for (const t of TRAINING) fusion.languageLearner.ingestText(t, 0.8, 90);
    return fusion;
  }
  const base = { recentPosts: ['How do I find patience?'], currentEnergy: 0.5, creativityActive: 1, intent: 'reflect' as const };

  it('speaks in paragraphs when the manifold is heavy enough', () => {
    const text = trained().generateText(['post_created'], { ...base, massScore: 0.8 });
    expect(text.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the single-sentence path for a light manifold', () => {
    const fusion = trained();
    const text = fusion.generateText(['post_created'], { ...base, massScore: 0.2 });
    expect(text).not.toContain('\n');
    expect(fusion.languageLearner.getExpressions().map(e => e.text)).toContain(text);
  });
});
