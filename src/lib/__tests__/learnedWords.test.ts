// @ts-expect-error - bun:test types not available in TypeScript
import { describe, expect, it } from 'bun:test';
import { LearnedWordRegistry } from '@/lib/utils/learnedWords';

describe('LearnedWordRegistry', () => {
  it('responds with the learned word when recalled', () => {
    const registry = new LearnedWordRegistry();
    registry.learn('hello', { learnedAt: 1_000 });

    const response = registry.respond('hello', 2_000);

    expect(response).toBe('hello');

    const snapshot = registry.recall('hello');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usageCount).toBe(1);
    expect(snapshot?.lastUsedAt).toBe(2_000);
    expect(snapshot?.learnedAt).toBe(1_000);
  });

  it('ignores words that have not been learned', () => {
    const registry = new LearnedWordRegistry();
    registry.learn('hello');

    expect(registry.respond('goodbye')).toBeNull();
    expect(registry.recall('goodbye')).toBeNull();
    expect(registry.has('goodbye')).toBe(false);
  });

  it('normalizes lookups but preserves the learned representation', () => {
    const registry = new LearnedWordRegistry();
    registry.learn('Hello');

    const response = registry.respond('  hello  ');

    expect(response).toBe('Hello');
    const snapshot = registry.recall('HELLO');
    expect(snapshot?.word).toBe('Hello');
    expect(snapshot?.usageCount).toBe(1);
  });

  it('lists learned words ordered by the time they were recorded', () => {
    const registry = new LearnedWordRegistry();
    registry.learn('alpha', { learnedAt: 3_000 });
    registry.learn('beta', { learnedAt: 5_000 });
    registry.learn('gamma', { learnedAt: 4_000 });

    const words = registry.list();
    expect(words.map((entry) => entry.word)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('forgets words when requested', () => {
    const registry = new LearnedWordRegistry();
    registry.learn('hello');

    expect(registry.forget('hello')).toBe(true);
    expect(registry.respond('hello')).toBeNull();
    expect(registry.forget('hello')).toBe(false);
  });
});
