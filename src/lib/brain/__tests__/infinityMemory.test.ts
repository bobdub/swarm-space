import { describe, it, expect } from 'vitest';
import { selectEvictions, toPiece, isPrivatePost, MEMORY_MAX_TEXT } from '../infinityMemory';

describe('infinityMemory', () => {
  it('keeps at most 2000 pieces, evicting oldest first', () => {
    const pieces = Array.from({ length: 2003 }, (_, i) => ({ id: `p${i}`, ts: i }));
    expect(selectEvictions(pieces)).toEqual(['p0', 'p1', 'p2']);
    expect(selectEvictions(pieces.slice(0, 2000))).toEqual([]);
  });

  it('clips text to 1000 characters', () => {
    const p = toPiece({ id: 'a', kind: 'post', text: 'x'.repeat(1500) });
    expect(p!.text.length).toBe(MEMORY_MAX_TEXT);
    expect(MEMORY_MAX_TEXT).toBe(1000);
  });

  it('skips walled and encrypted posts', () => {
    expect(isPrivatePost({ walled: true })).toBe(true);
    expect(isPrivatePost({ encrypted: true })).toBe(true);
    expect(isPrivatePost({ content: 'hi' })).toBe(false);
  });
});
