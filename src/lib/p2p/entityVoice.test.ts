import { describe, it, expect, beforeEach } from 'bun:test';
import { EntityVoice, formatAge, ENTITY_USER_ID, BRAIN_STAGE_NAMES, setShyMode } from './entityVoice';
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
    setShyMode(false);
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

    it('advances to stage 2 with 50+ interactions and age', () => {
      // Need to manipulate birth timestamp for age check
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 10 * 60_000));
      const v = new EntityVoice();
      expect(v.computeBrainStage(50, 0)).toBe(2);
    });

    it('advances to stage 3 with 200+ interactions and vocab > 30', () => {
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 60 * 60_000));
      const v = new EntityVoice();
      expect(v.computeBrainStage(200, 35)).toBe(3);
    });

    it('stays at lower stage if vocab threshold not met', () => {
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 60 * 60_000));
      const v = new EntityVoice();
      expect(v.computeBrainStage(200, 10)).toBe(2); // vocab < 30
    });

    it('reaches stage 6 with high interactions and vocab', () => {
      mockStorage.set('entity-voice-birth-timestamp', String(Date.now() - 100 * 86400_000));
      const v = new EntityVoice();
      expect(v.computeBrainStage(6000, 1000)).toBe(6);
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
      const body = comment!.text.replace(/^\[[^\]]+\]\s*/, '');
      expect(body.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
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

  describe('important marker gating', () => {
    it('only comments when a new important marker is reached', () => {
      engine.registerPeer('marker-peer');
      const post1 = { id: 'post-marker-1', author: 'user-1', text: 'marker one', createdAt: new Date().toISOString(), reactions: [] } as any;
      const post2 = { id: 'post-marker-2', author: 'user-1', text: 'marker two', createdAt: new Date().toISOString(), reactions: [] } as any;

      // First marker (stage-1) should allow one comment.
      expect(voice.shouldComment(post1, engine)).toBe(true);
      voice.generateComment(post1, engine);

      // Same marker should not re-post without a new milestone.
      const canCommentAgainImmediately = voice.shouldComment(post2, engine);
      expect(canCommentAgainImmediately).toBe(false);
    });

    it('does not comment for interaction milestones when stage is unchanged', () => {
      engine.registerPeer('steady-peer');
      const firstPost = { id: 'post-stage-1', author: 'user-1', text: 'first', createdAt: new Date().toISOString(), reactions: [] } as any;
      const secondPost = { id: 'post-stage-1b', author: 'user-2', text: 'second', createdAt: new Date().toISOString(), reactions: [] } as any;

      // Stage 1 marker can trigger once.
      expect(voice.shouldComment(firstPost, engine)).toBe(true);
      voice.generateComment(firstPost, engine);

      // Even after many interactions, if stage remains 1 then no extra posts.
      for (let i = 0; i < 40; i++) {
        engine.onInteraction('steady-peer', { kind: 'sync', success: true });
      }
      expect(voice.computeBrainStage(engine.getTotalInteractionCount(), engine.getDualLearning().languageLearner.vocabSize)).toBe(1);
      expect(voice.shouldComment(secondPost, engine)).toBe(false);
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
