import { describe, it, expect } from 'vitest';
import { SemanticLattice, extractTriad, MAX_SEMANTIC_WORDS } from '../semanticBasins';
import { rankExpressions } from '../../brain/infinityPersonality';
import { LanguageLearner } from '../../p2p/languageLearner';

function teach(lattice: SemanticLattice, times = 6): void {
  for (let i = 0; i < times; i++) {
    lattice.ingest('The ocean tide returns to the shore.', 0.8);
    lattice.ingest('Hearth flame gives shelter through winter.', 0.8);
  }
}

describe('SemanticLattice (Phase 1 basins)', () => {
  it('pulls co-occurring words together and leaves strangers without tension', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    expect(lattice.tension('ocean', 'tide')).toBeGreaterThan(0.3);
    expect(lattice.tension('hearth', 'shelter')).toBeGreaterThan(0.3);
    // Never seen together: no supported tension, regardless of geometry.
    expect(lattice.tension('ocean', 'flame')).toBe(0);
    expect(lattice.related('ocean').map(r => r.word)).toContain('tide');
    expect(lattice.related('ocean').map(r => r.word)).not.toContain('flame');
  });

  it('requires repeated evidence before granting tension', () => {
    const lattice = new SemanticLattice();
    lattice.ingest('Lantern moss glows quietly.', 1);
    expect(lattice.evidence('lantern', 'moss')).toBe(1);
    expect(lattice.tension('lantern', 'moss')).toBe(0);
  });

  it('rejects chains whose neighbours share no tension', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    expect(lattice.isCoherentChain(['ocean', 'tide', 'shore'])).toBe(true);
    expect(lattice.isCoherentChain(['ocean', 'flame', 'shelter'])).toBe(false);
  });

  it('extracts subject–action–object triads', () => {
    expect(extractTriad('The pulse carries what was left unmined')).toEqual({ subject: 'pulse', action: 'carries', object: 'left' });
    expect(extractTriad('Memory settles like silt in the ledger')).toEqual({ subject: 'memory', action: 'settles', object: 'silt' });
    expect(extractTriad('The mesh will remember every peer')).toEqual({ subject: 'mesh', action: 'remember', object: 'peer' });
    expect(extractTriad('quiet blue')).toBeNull();
    const lattice = new SemanticLattice();
    lattice.ingest('Memory settles like silt in the ledger.', 1);
    expect(lattice.triadsFor(['silt'])[0]).toMatchObject({ subject: 'memory', action: 'settles', object: 'silt' });
  });

  it('round-trips through serialization', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    const restored = new SemanticLattice();
    restored.restore(JSON.parse(JSON.stringify(lattice.serialize())));
    expect(restored.size).toBe(lattice.size);
    expect(restored.tension('ocean', 'tide')).toBeCloseTo(lattice.tension('ocean', 'tide'), 2);
    restored.restore({ v: 99 });
    restored.restore(null);
    expect(restored.size).toBe(lattice.size);
  });

  it('stays bounded', () => {
    const lattice = new SemanticLattice();
    for (let i = 0; i < 400; i++) lattice.ingest(`alpha${i} beta${i} gamma${i} delta${i}.`, 0.5);
    expect(lattice.size).toBeLessThanOrEqual(MAX_SEMANTIC_WORDS);
  });
});

describe('Basin bridge in realization', () => {
  const expressions = [
    { text: 'Every tide returns what the shore remembers.', weight: 2, source: 'memory' as const },
    { text: 'A flame needs patience before it warms.', weight: 2, source: 'memory' as const },
  ];

  it('keeps exact topical matches unchanged', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    const exact = rankExpressions(expressions, { recentPosts: ['Tell me about the tide'], maxChars: 1000, semantic: lattice });
    expect(exact.map(e => e.text)).toEqual([expressions[0].text]);
  });

  it('reaches an expression through supported basin tension when no topic matches', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    const bridged = rankExpressions(expressions, { recentPosts: ['How is the ocean tonight?'], maxChars: 1000, semantic: lattice });
    expect(bridged.map(e => e.text)).toEqual([expressions[0].text]);
    // Without the lattice the old behaviour (silence) is preserved.
    expect(rankExpressions(expressions, { recentPosts: ['How is the ocean tonight?'], maxChars: 1000 })).toEqual([]);
  });

  it('stays silent when the prompt has no supported neighbours', () => {
    const lattice = new SemanticLattice();
    teach(lattice);
    expect(rankExpressions(expressions, { recentPosts: ['Explain quasars'], maxChars: 1000, semantic: lattice })).toEqual([]);
  });

  it('learns basins through the LanguageLearner ingestion path', () => {
    const learner = new LanguageLearner();
    for (let i = 0; i < 4; i++) learner.ingestText('The ocean tide returns to the shore.', 0.8, 90);
    expect(learner.semantic.tension('ocean', 'tide')).toBeGreaterThan(0.3);
    expect(learner.exportVocab()).not.toHaveProperty('ocean|tide');
  });
});
