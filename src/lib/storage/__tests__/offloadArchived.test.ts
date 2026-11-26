import { describe, it, expect } from 'vitest';
import { planArchivedClear } from '../offload';

const contents = {
  postIds: ['post-1'],
  commentIds: ['c1', 'c2'],
  manifestIds: ['file-a', 'file-coin'],
  chunkRefs: ['ch-1', 'ch-coin'],
};

describe('free up space from a downloaded archive', () => {
  it('lists only what the zip holds', () => {
    const plan = planArchivedClear(contents);
    expect(plan.get('posts')).toEqual(['post-1']);
    expect(plan.get('comments')).toEqual(['c1', 'c2']);
    expect(plan.get('manifests')).toEqual(['file-a', 'file-coin']);
    expect(plan.get('replicas')).toEqual(['file-a', 'file-coin']);
    expect(plan.get('chunks')).toEqual(['ch-1', 'ch-coin']);
  });

  it('keeps files engraved into a coin', () => {
    const plan = planArchivedClear(contents, new Set(['file-coin', 'ch-coin']));
    expect(plan.get('manifests')).toEqual(['file-a']);
    expect(plan.get('replicas')).toEqual(['file-a']);
    expect(plan.get('chunks')).toEqual(['ch-1']);
  });

  it('never touches identity, keys, wallet or coins', () => {
    const stores = [...planArchivedClear(contents).keys()];
    for (const s of ['users', 'meta', 'blockchain', 'tokenBalances', 'swarmCoins']) expect(stores).not.toContain(s);
  });

  it('a media-only zip leaves posts and comments alone', () => {
    const plan = planArchivedClear({ ...contents, postIds: [], commentIds: [] });
    expect(plan.has('posts')).toBe(false);
    expect(plan.has('comments')).toBe(false);
  });
});

describe('clearArchivedLocal on a real store', () => {
  it('removes the archived rows, keeps everything else and engraved files', async () => {
    await import('fake-indexeddb/auto');
    const { put, get } = await import('@/lib/store');
    const { clearArchivedLocal } = await import('../offload');
    await put('posts', { id: 'post-1', author: 'me', content: 'in zip' });
    await put('posts', { id: 'post-2', author: 'me', content: 'not in zip' });
    await put('comments', { id: 'c1', postId: 'post-1', text: 'hi' });
    await put('manifests', { fileId: 'file-a', chunks: ['ch-1'] });
    await put('manifests', { fileId: 'file-coin', chunks: ['ch-coin'], _coinId: 'coin-1' });
    await put('chunks', { ref: 'ch-1', data: 'x' });
    await put('chunks', { ref: 'ch-coin', data: 'y' });
    await put('users', { id: 'me', username: 'me' });

    const result = await clearArchivedLocal({
      postIds: ['post-1'], commentIds: ['c1'], manifestIds: ['file-a', 'file-coin'], chunkRefs: ['ch-1', 'ch-coin'],
    });

    expect(result.removed).toBe(4);
    expect(await get('posts', 'post-1')).toBeUndefined();
    expect(await get('comments', 'c1')).toBeUndefined();
    expect(await get('manifests', 'file-a')).toBeUndefined();
    expect(await get('chunks', 'ch-1')).toBeUndefined();
    expect(await get('posts', 'post-2')).toBeDefined();
    expect(await get('manifests', 'file-coin')).toBeDefined();
    expect(await get('chunks', 'ch-coin')).toBeDefined();
    expect(await get('users', 'me')).toBeDefined();
  });
});
