import { afterEach, describe, expect, it } from 'vitest';
import { cadenceWeight, clearChainMark, forkPoint, getChainMark, planAdoption, planCatchup, saveChainMark } from '../chainCatchup';

const chainOf = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, hash: `h${i}` }));

describe('chain catch-up sync', () => {
  afterEach(() => localStorage.clear());

  it('sends only blocks after a matching mark, in pages', () => {
    const pages = planCatchup(chainOf(300), { index: 180, hash: 'h180' }, 50);
    expect(pages.map((p) => p.blocks.length)).toEqual([50, 50, 19]);
    expect(pages[0].fromIndex).toBe(181);
    expect(pages[0].full).toBe(false);
    expect(pages[2].blocks.at(-1)?.index).toBe(299);
    expect(pages.every((p) => p.tip?.index === 299 && p.totalLength === 300)).toBe(true);
  });

  it('falls back to the full chain when the mark does not match', () => {
    const pages = planCatchup(chainOf(120), { index: 100, hash: 'someone-else' }, 50);
    expect(pages[0].fromIndex).toBe(0);
    expect(pages[0].full).toBe(true);
    expect(pages.reduce((n, p) => n + p.blocks.length, 0)).toBe(120);
  });

  it('falls back to the full chain with no mark or a mark past our tip', () => {
    expect(planCatchup(chainOf(10), null)[0].full).toBe(true);
    expect(planCatchup(chainOf(10), { index: 50, hash: 'h50' })[0].full).toBe(true);
  });

  it('sends one empty page when the asker is already at our tip', () => {
    const pages = planCatchup(chainOf(10), { index: 9, hash: 'h9' });
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toHaveLength(0);
    expect(pages[0].tip).toEqual({ index: 9, hash: 'h9' });
  });

  it('remembers and forgets a peer mark', () => {
    expect(getChainMark('peer-a')).toBeNull();
    saveChainMark('peer-a', { index: 42, hash: 'h42' });
    expect(getChainMark('peer-a')).toEqual({ index: 42, hash: 'h42' });
    clearChainMark('peer-a');
    expect(getChainMark('peer-a')).toBeNull();
  });
});

describe('chain catch-up sync (older peers)', () => {
  it('can send the whole chain as one unpaged message', () => {
    const pages = planCatchup(chainOf(300), undefined, Infinity);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toHaveLength(300);
  });
});

describe('shared chain adoption', () => {
  type Tx = { id: string };
  const block = (index: number, hash: string, prev: string, txs: string[] = []) => ({
    index, hash, previousHash: prev, transactions: txs.map((id): Tx => ({ id })),
  });
  const never = () => { throw new Error('fork choice should not be asked'); };

  it('finds where two chains split', () => {
    expect(forkPoint(chainOf(5), chainOf(5))).toBe(5);
    expect(forkPoint(chainOf(5), [...chainOf(3), { index: 3, hash: 'x' }])).toBe(3);
  });

  it('converges chains that only share genesis on the longest one, keeping our transactions', () => {
    const local = [block(0, 'g', '0'), block(1, 'a1', 'g', ['mine-1', 'shared']), block(2, 'a2', 'a1', ['reward-a'])];
    const incoming = [block(0, 'g', '0'), block(1, 'b1', 'g', ['shared']), block(2, 'b2', 'b1'), block(3, 'b3', 'b2')];
    const plan = planAdoption(local, incoming, never);
    expect(plan.replace).toBe(true);
    expect(plan.forkPoint).toBe(1);
    expect(plan.requeue.map((t) => t.id)).toEqual(['mine-1', 'reward-a']);
  });

  it('breaks an equal-length tie by the lowest tip hash, the same way on every peer', () => {
    const a = [block(0, 'g', '0'), block(1, 'aaa', 'g')];
    const b = [block(0, 'g', '0'), block(1, 'bbb', 'g')];
    expect(planAdoption(b, a, never).replace).toBe(true);
    expect(planAdoption(a, b, never).replace).toBe(false);
  });

  it('asks fork choice once chains share more than genesis', () => {
    const local = [block(0, 'g', '0'), block(1, 's', 'g'), block(2, 'a', 's')];
    const incoming = [block(0, 'g', '0'), block(1, 's', 'g'), block(2, 'b', 's'), block(3, 'c', 'b')];
    expect(planAdoption(local, incoming, () => 'keep').replace).toBe(false);
    expect(planAdoption(local, incoming, () => 'replace').replace).toBe(true);
  });

  it('never adopts a different genesis or a shorter copy of our own chain', () => {
    const local = [block(0, 'g', '0'), block(1, 's', 'g')];
    expect(planAdoption(local, [block(0, 'other', '0'), block(1, 'x', 'other'), block(2, 'y', 'x')], never).replace).toBe(false);
    expect(planAdoption(local, [block(0, 'g', '0')], never).replace).toBe(false);
  });
});

describe('cadence-weighted chain choice', () => {
  type Tx = { id: string };
  const T0 = Date.UTC(2026, 10, 21, 0, 0, 0);
  const NOW = T0 + 24 * 60 * 60 * 1000;
  const run = (prefix: string, prev: string, startIndex: number, times: number[]) => {
    let p = prev;
    return times.map((t, i) => {
      const b = { index: startIndex + i, hash: `${prefix}${i}`, previousHash: p, transactions: [] as Tx[], timestamp: new Date(t).toISOString() };
      p = b.hash;
      return b;
    });
  };
  const genesis = { index: 0, hash: 'g', previousHash: '0', transactions: [] as Tx[], timestamp: new Date(T0).toISOString() };
  const never = () => { throw new Error('fork choice should not be asked'); };

  it('counts one block per 30 s slot, so a burst counts once', () => {
    const burst = Array.from({ length: 100 }, (_, i) => ({ timestamp: T0 + 31_000 + i * 100 }));
    expect(cadenceWeight(burst, T0, NOW).weight).toBe(1);
    const paced = Array.from({ length: 10 }, (_, i) => ({ timestamp: T0 + (i + 1) * 30_000 }));
    expect(cadenceWeight(paced, T0, NOW).weight).toBe(10);
  });

  it('ignores blocks from the future or out of order, and marks dark gaps as new epochs', () => {
    const w = cadenceWeight([
      { timestamp: T0 + 30_000 },
      { timestamp: T0 + 10_000 }, // before its parent
      { timestamp: NOW + 10 * 60_000 }, // future
      { timestamp: T0 + 30_000 + 60 * 60_000 }, // after an hour of silence
    ], T0, NOW);
    expect(w).toEqual({ weight: 2, epochs: 2 });
  });

  it('a paced chain beats a longer spammed one', () => {
    const paced = [genesis, ...run('p', 'g', 1, Array.from({ length: 10 }, (_, i) => T0 + (i + 1) * 30_000))];
    const spam = [genesis, ...run('s', 'g', 1, Array.from({ length: 500 }, (_, i) => T0 + 30_000 + i * 50))];
    expect(planAdoption(paced, spam, never, NOW).replace).toBe(false);
    expect(planAdoption(spam, paced, never, NOW).replace).toBe(true);
  });
});
