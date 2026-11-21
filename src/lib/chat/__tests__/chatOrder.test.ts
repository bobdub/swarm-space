import { afterEach, describe, expect, it } from 'vitest';
import { causalOrder } from '../chatOrder';
import { causalNow, observeCausalTimestamp, resetCausalClock, setNetworkClockOffset } from '@/lib/time/networkClock';

describe('causal chat order', () => {
  afterEach(() => {
    resetCausalClock();
    setNetworkClockOffset(0);
  });

  it('shows a reply after its parent even when the reply has an earlier stamp', () => {
    const lines = [
      { id: 'reply', ts: 1_000, replyToId: 'parent' },
      { id: 'parent', ts: 1_050 },
      { id: 'other', ts: 1_020 },
    ];
    expect(causalOrder(lines).map((l) => l.id)).toEqual(['other', 'parent', 'reply']);
  });

  it('keeps a chain of replies in order', () => {
    const lines = [
      { id: 'c', ts: 10, replyToId: 'b' },
      { id: 'b', ts: 20, replyToId: 'a' },
      { id: 'a', ts: 30 },
    ];
    expect(causalOrder(lines).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by id so every peer shows the same order', () => {
    const a = [{ id: 'y', ts: 5 }, { id: 'x', ts: 5 }];
    const b = [{ id: 'x', ts: 5 }, { id: 'y', ts: 5 }];
    expect(causalOrder(a).map((l) => l.id)).toEqual(causalOrder(b).map((l) => l.id));
  });

  it('ignores missing parents and reply loops', () => {
    const lines = [
      { id: 'a', ts: 2, replyToId: 'b' },
      { id: 'b', ts: 1, replyToId: 'a' },
      { id: 'c', ts: 3, replyToId: 'gone' },
    ];
    expect(causalOrder(lines)).toHaveLength(3);
  });

  it('works with a key function for UI lines', () => {
    const lines = [
      { id: 'r', ts: 1, replyTo: { id: 'p' } },
      { id: 'p', ts: 2 },
    ];
    expect(causalOrder(lines, (l) => ({ id: l.id, ts: l.ts, replyToId: l.replyTo?.id })).map((l) => l.id)).toEqual(['p', 'r']);
  });
});

describe('causal stamps', () => {
  afterEach(() => resetCausalClock());

  it('stamps later than any line we have seen', () => {
    const seen = Date.now() + 30_000; // a peer whose clock runs 30 s ahead
    observeCausalTimestamp(seen);
    expect(causalNow()).toBeGreaterThan(seen);
  });

  it('never repeats a stamp', () => {
    const a = causalNow();
    const b = causalNow();
    expect(b).toBeGreaterThan(a);
  });

  it('caps how far a bad peer can push our stamps ahead', () => {
    const now = Date.now();
    observeCausalTimestamp(now + 24 * 60 * 60 * 1000, now);
    expect(causalNow() - now).toBeLessThan(3 * 60 * 1000);
  });
});
