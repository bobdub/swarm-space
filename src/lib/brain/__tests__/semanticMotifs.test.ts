import { describe, it, expect } from 'vitest';
import { extractMotifs, assembleSentence, resonance } from '../semanticMotifs';
import { SemanticLattice } from '../../uqrc/semanticBasins';
import { DualLearningFusion } from '../../p2p/dualLearningFusion';

const mem = (text: string, weight = 2) => ({ text, weight, source: 'memory' as const });

const LINES = [
  'When the mesh grows quiet, the pulse carries what was left unmined.',
  'The ledger keeps every block, and memory settles like silt in the ledger.',
  'In the spaces between nodes, a signal waits for its peer.',
  'The miner remembers each block it sealed.',
  'While the miner sleeps, blocks drift through the night.',
];

function trainedLattice(): SemanticLattice {
  const lattice = new SemanticLattice();
  for (let i = 0; i < 4; i++) {
    for (const line of LINES) lattice.ingest(line, 0.8);
    lattice.ingest('The pulse of the mesh carries memory into the ledger.', 0.8);
    lattice.ingest('Quiet mesh nights let the pulse and the miner rest.', 0.8);
  }
  return lattice;
}

describe('Semantic motifs (Phase 2)', () => {
  it('cuts learned sentences into attunement, core and anchor clauses', () => {
    const motifs = extractMotifs(LINES.map(t => mem(t)));
    const by = (role: string) => motifs.filter(m => m.role === role).map(m => m.text);
    expect(by('attunement')).toEqual(['When the mesh grows quiet', 'In the spaces between nodes', 'While the miner sleeps']);
    expect(by('core')).toContain('the pulse carries what was left unmined');
    expect(by('core')).toContain('The miner remembers each block it sealed');
    expect(by('anchor')).toEqual(['and memory settles like silt in the ledger']);
  });

  it('never cuts symbolic expressions', () => {
    const motifs = extractMotifs([mem('The UQRC operator is 𝒪_UQRC(u) = ν Δ u + ℛ u + L_S u, which describes diffusion.')]);
    expect(motifs).toEqual([]);
  });

  it('assembles a novel sentence from resonant clauses of different lines', () => {
    const lattice = trainedLattice();
    const motifs = extractMotifs(LINES.map(t => mem(t)));
    const result = assembleSentence(motifs, { prompt: 'What does the pulse hold?', semantic: lattice, maxChars: 400 });
    expect(result).not.toBeNull();
    // The core's own attunement ("When the mesh grows quiet") is refused: same source.
    expect(result!.text).toBe('While the miner sleeps, the pulse carries what was left unmined, and memory settles like silt in the ledger.');
    expect(LINES).not.toContain(result!.text);
    expect(new Set(result!.motifs.map(m => m.source)).size).toBeGreaterThanOrEqual(2);
    expect(result!.resonance).toBeGreaterThanOrEqual(0.2);
  });

  it('rejects joins without phase resonance', () => {
    const lattice = new SemanticLattice(); // no evidence at all
    const motifs = extractMotifs([
      mem('When the orchard sleeps, the pulse carries light.'),
      mem('Rivers bend south, and granite dreams of salt.'),
      mem('The pulse carries what was left unmined.'),
    ]);
    const core = motifs.find(m => m.role === 'core' && m.text.startsWith('The pulse'))!;
    const anchor = motifs.find(m => m.role === 'anchor')!;
    expect(resonance(core, anchor, lattice)).toBe(0);
    // Only the original line's own attunement shares a word, but same-source joins are refused.
    expect(assembleSentence(motifs, { prompt: 'tell me about the pulse', semantic: lattice, maxChars: 400 })).toBeNull();
  });

  it('stays silent for prompts with no topical or basin support', () => {
    const lattice = trainedLattice();
    const motifs = extractMotifs(LINES.map(t => mem(t)));
    expect(assembleSentence(motifs, { prompt: 'Explain quasars', semantic: lattice, maxChars: 400 })).toBeNull();
  });

  it('does not repeat avoided sentences', () => {
    const lattice = trainedLattice();
    const motifs = extractMotifs(LINES.map(t => mem(t)));
    const first = assembleSentence(motifs, { prompt: 'What does the pulse hold?', semantic: lattice, maxChars: 400 })!;
    const second = assembleSentence(motifs, { prompt: 'What does the pulse hold?', semantic: lattice, maxChars: 400, avoid: [first.text] });
    expect(second?.text).not.toBe(first.text);
  });

  it('is used by DualLearningFusion only when no whole expression matches', () => {
    const fusion = new DualLearningFusion();
    const learner = fusion.languageLearner;
    for (let i = 0; i < 4; i++) {
      for (const line of LINES) learner.ingestText(line, 0.8, 90);
      learner.ingestText('The pulse of the mesh carries memory into the ledger.', 0.8, 90);
    }
    // Exact topical whole expression exists → returned unchanged.
    const whole = fusion.generateText(['post_created'], { recentPosts: ['Tell me about the miner'], currentEnergy: 0.5, creativityActive: 1 });
    expect(learner.getExpressions().map(e => e.text)).toContain(whole);
  });

  it('lets create intent speak an assembled sentence grounded in a prompt topic', () => {
    const fusion = new DualLearningFusion();
    const learner = fusion.languageLearner;
    for (let i = 0; i < 4; i++) {
      for (const line of LINES) learner.ingestText(line, 0.8, 90);
      learner.ingestText('The pulse of the mesh carries memory into the ledger.', 0.8, 90);
      learner.ingestText('Quiet mesh nights let the pulse and the miner rest.', 0.8, 90);
    }
    const base = { recentPosts: ['What does the pulse hold?'], currentEnergy: 0.9, creativityActive: 1 };
    const created = fusion.generateText(['post_created'], { ...base, intent: 'create' });
    expect(learner.getExpressions().map(e => e.text)).not.toContain(created);
    expect(created).toMatch(/the pulse carries what was left unmined/);
    // Engage keeps whole learned expressions.
    const engaged = fusion.generateText(['post_created'], { ...base, intent: 'engage' });
    expect(learner.getExpressions().map(e => e.text)).toContain(engaged);
  });
});
