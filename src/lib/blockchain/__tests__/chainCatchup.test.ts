import { afterEach, describe, expect, it } from 'vitest';
import { clearChainMark, getChainMark, planCatchup, saveChainMark } from '../chainCatchup';

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
