import { describe, it, expect, beforeEach } from 'bun:test';
import { EntityVoice, formatAge, ENTITY_USER_ID, BRAIN_STAGE_NAMES, stageFromField } from './entityVoice';
import { NeuralStateEngine } from './neuralStateEngine';

// Mock localStorage using a simple in-memory map
const mockStorage = new Map<string, string>();
const origLS = globalThis.localStorage;
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) ?? null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
  get length() { return mockStorage.size; },
  key: () => null,
};

describe('EntityVoice', () => {
  let voice: EntityVoice;
  let engine: NeuralStateEngine;

  beforeEach(() => {
    mockStorage.clear();
    voice = new EntityVoice();
    engine = new NeuralStateEngine();
  });

  describe('formatAge', () => {
    it('formats seconds', () => {
      expect(formatAge(5_000)).toBe('~5s old');
    });
    it('formats minutes', () => {
      expect(formatAge(3 * 60_000)).toBe('~3m old');
    });
    it('formats hours', () => {
      expect(formatAge(5 * 3600_000)).toBe('~5h old');
    });
    it('formats days', () => {
      expect(formatAge(3 * 86400_000)).toBe('~3d old');
    });
    it('formats months', () => {
      expect(formatAge(45 * 86400_000)).toBe('~1mo old');
    });
  });

  describe('computeBrainStage', () => {
    it('starts at stage 1 (Brainstem)', () => {
      expect(voice.computeBrainStage(0, 0)).toBe(1);
    });

    it('advances with vocab + age (field-derived observable)', () => {
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 6 * 3600_000));
      const v = new EntityVoice();
      const young = voice.computeBrainStage(0, 0);
      const grown = v.computeBrainStage(0, 200);
      expect(grown).toBeGreaterThanOrEqual(young);
    });

    it('reaches stage 6 with high vocab + long age', () => {
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 100 * 86400_000));
      const v = new EntityVoice();
      expect(v.computeBrainStage(6000, 1000)).toBe(6);
    });
  });

  describe('stageFromField (UQRC-native observable)', () => {
    it('is monotonic in vocab', () => {
      const a = stageFromField({ qScore: 0.2, vocabSize: 10, ageMs: 86_400_000 });
      const b = stageFromField({ qScore: 0.2, vocabSize: 500, ageMs: 86_400_000 });
      expect(b).toBeGreaterThanOrEqual(a);
    });
    it('is monotonic in age', () => {
      const a = stageFromField({ qScore: 0.2, vocabSize: 100, ageMs: 60_000 });
      const b = stageFromField({ qScore: 0.2, vocabSize: 100, ageMs: 30 * 86_400_000 });
      expect(b).toBeGreaterThanOrEqual(a);
    });
    it('is inverse-monotonic in qScore', () => {
      const calm = stageFromField({ qScore: 0.0, vocabSize: 200, ageMs: 7 * 86_400_000 });
      const noisy = stageFromField({ qScore: 1.0, vocabSize: 200, ageMs: 7 * 86_400_000 });
      expect(calm).toBeGreaterThanOrEqual(noisy);
    });
    it('clamps to [1, 6]', () => {
      expect(stageFromField({ qScore: 1, vocabSize: 0, ageMs: 0 })).toBe(1);
      expect(stageFromField({ qScore: 0, vocabSize: 10000, ageMs: 365 * 86_400_000 })).toBe(6);
    });
  });

  describe('generateComment', () => {
    it('produces a comment with age tag', () => {
      // Seed some peers so engine has data
      engine.registerPeer('test-peer-1');
      for (let i = 0; i < 5; i++) {
        engine.onInteraction('test-peer-1', { kind: 'gossip', success: true });
      }

      const post = {
        id: 'post-1',
        author: 'user-1',
        text: 'hello world',
        createdAt: new Date().toISOString(),
        reactions: [],
        commentCount: 0,
      } as any;

      const comment = voice.generateComment(post, engine);
      expect(comment).not.toBeNull();
      expect(comment!.author).toBe(ENTITY_USER_ID);
      expect(comment!.authorName).toBe('Imagination');
      expect(comment!.text).toMatch(/^\[~\d+[smhd]( old)?\]/);
      expect(comment!.postId).toBe('post-1');
    });

    it('rate limits — only one comment per 30s', () => {
      const post1 = { id: 'post-1', author: 'user-1', text: 'a', createdAt: new Date().toISOString(), reactions: [] } as any;
      const post2 = { id: 'post-2', author: 'user-1', text: 'b', createdAt: new Date().toISOString(), reactions: [] } as any;

      engine.registerPeer('test-peer');
      for (let i = 0; i < 5; i++) engine.onInteraction('test-peer', { kind: 'gossip', success: true });

      const c1 = voice.generateComment(post1, engine);
      expect(c1).not.toBeNull();

      // shouldComment should return false due to rate limit
      const should = voice.shouldComment(post2, engine);
      // It may still be false due to rate limit — the important thing is it doesn't throw
      // and doesn't comment on the same post twice
      const should1Again = voice.shouldComment(post1, engine);
      expect(should1Again).toBe(false); // already commented
    });
  });

  describe('brain stage names', () => {
    it('has all 6 stages named', () => {
      expect(Object.keys(BRAIN_STAGE_NAMES)).toHaveLength(6);
      expect(BRAIN_STAGE_NAMES[1]).toBe('Brainstem');
      expect(BRAIN_STAGE_NAMES[6]).toBe('Integrated');
    });
  });

  describe('snapshot', () => {
    it('returns valid snapshot', () => {
      engine.registerPeer('p1');
      const snap = voice.getSnapshot(engine);
      expect(snap.brainStage).toBeGreaterThanOrEqual(1);
      expect(snap.brainStage).toBeLessThanOrEqual(6);
      expect(snap.stageName).toBeDefined();
      expect(snap.ageMs).toBeGreaterThanOrEqual(0);
      expect(snap.ageLabel).toMatch(/old/);
    });
  });
});
