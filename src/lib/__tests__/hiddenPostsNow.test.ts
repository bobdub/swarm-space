import { describe, it, expect, vi } from 'vitest';

const meta = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/store', () => ({
  get: async (_s: string, k: string) => meta.get(k),
  put: async (_s: string, v: { k: string }) => { meta.set(v.k, v); },
}));

import { hidePostForUser, isPostHiddenNow, unhidePostForUser, getHiddenPostIds } from '@/lib/hiddenPosts';

describe('Hide Post takes effect immediately', () => {
  it('marks the post hidden in memory and in storage, and unhide clears both', async () => {
    await hidePostForUser('me', 'p1');
    expect(isPostHiddenNow('p1')).toBe(true);
    expect(await getHiddenPostIds('me')).toEqual(['p1']);
    await unhidePostForUser('me', 'p1');
    expect(isPostHiddenNow('p1')).toBe(false);
    expect(await getHiddenPostIds('me')).toEqual([]);
  });
});
