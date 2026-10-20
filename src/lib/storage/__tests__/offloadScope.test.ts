import { describe, it, expect } from 'vitest';
import { clearableStoresFor } from '../offload';

describe('clear scope', () => {
  it('media scope keeps posts and comments', () => {
    expect(clearableStoresFor('media')).not.toContain('posts');
    expect(clearableStoresFor('media')).not.toContain('comments');
  });
  it('everything scope clears posts and comments but never identity or wallet', () => {
    const s = clearableStoresFor('everything');
    expect(s).toEqual(expect.arrayContaining(['posts', 'comments']));
    for (const k of ['users', 'meta', 'blockchain', 'tokenBalances', 'swarmCoins']) expect(s).not.toContain(k);
  });
});
