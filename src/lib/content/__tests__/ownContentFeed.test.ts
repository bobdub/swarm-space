import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Post } from '@/types';

vi.mock('@/lib/projects', () => ({
  filterPostsByProjectMembership: async (posts: Post[]) => posts,
}));

import { fetchHomeFeed, setMyContentOnly, getMyContentOnly, getShowNetworkContent } from '@/lib/feed';
import { isOwnPost } from '@/lib/content/ownContent';
import {
  _resetUnsupportedPostsForTest,
  isManifestUnsupported,
  isPostUnsupported,
  listUnsupportedPosts,
  resumeSupportingPost,
  stopSupportingPost,
} from '@/lib/content/unsupportedPostsStore';

const ME = 'user-me';
const DEVICE_KEY = 'device-ed25519-key';

function post(id: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    author: 'user-peer',
    type: 'text',
    content: `post ${id}`,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    ...extra,
  } as Post;
}

const deps = (posts: Post[]) => ({
  loadPosts: async () => posts,
  getUser: () => ({ id: ME, username: 'me', publicKey: 'p256-key' }) as never,
  resolveIdentity: async () => ({ userId: ME, publicKey: 'p256-key', deviceSignerKey: DEVICE_KEY, aliasIds: ['user-retired'] }),
  loadBlockedUserIds: async () => [],
  loadHiddenPostIds: async () => [],
  loadFollowingIds: async () => [],
});

describe('My Content Only toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetUnsupportedPostsForTest();
  });

  it('is the inverse of Show Network Content and defaults ON', () => {
    expect(getMyContentOnly()).toBe(true);
    setMyContentOnly(false);
    expect(getShowNetworkContent()).toBe(true);
    expect(getMyContentOnly()).toBe(false);
  });

  it('ON hides walled network posts (no paywall loophole)', async () => {
    setMyContentOnly(true);
    const feed = await fetchHomeFeed('all', deps([
      post('mine', { author: ME }),
      post('walled-peer', { walled: true, _origin: 'synced' }),
      post('plain-peer', { _origin: 'synced' }),
    ]));
    expect(feed.map((p) => p.id)).toEqual(['mine']);
  });

  it('ON keeps posts owned by key, merge alias or this device signer', async () => {
    setMyContentOnly(true);
    const feed = await fetchHomeFeed('all', deps([
      post('by-pubkey', { author: 'p256-key' }),
      post('by-alias', { author: 'user-retired' }),
      post('by-device', { author: 'legacy-id', _origin: 'local', signerPublicKey: DEVICE_KEY }),
      post('peer-signed-elsewhere', { author: 'legacy-id', _origin: 'synced', signerPublicKey: DEVICE_KEY }),
    ]));
    expect(feed.map((p) => p.id).sort()).toEqual(['by-alias', 'by-device', 'by-pubkey']);
  });

  it('OFF shows network posts', async () => {
    setMyContentOnly(false);
    const feed = await fetchHomeFeed('all', deps([post('mine', { author: ME }), post('peer', { _origin: 'synced' })]));
    expect(feed.map((p) => p.id).sort()).toEqual(['mine', 'peer']);
  });

  it('isOwnPost trims ids and rejects without identity', () => {
    expect(isOwnPost({ author: ` ${ME} ` }, { userId: ME })).toBe(true);
    expect(isOwnPost({ author: ME }, null)).toBe(false);
  });
});

describe('Stop Support', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetUnsupportedPostsForTest();
  });

  it('hides the post from feeds and indexes its media until resumed', async () => {
    setMyContentOnly(false);
    await stopSupportingPost({ postId: 'peer', source: 'feed', author: 'user-peer', content: 'hi', manifestIds: ['m1'] });
    expect(isPostUnsupported('peer')).toBe(true);
    expect(isManifestUnsupported('m1')).toBe(true);
    expect(listUnsupportedPosts().map((e) => e.postId)).toEqual(['peer']);
    expect(localStorage.getItem('swarm:unsupported-posts:v1')).toContain('peer');

    const hidden = await fetchHomeFeed('all', deps([post('peer', { _origin: 'synced' }), post('other', { _origin: 'synced' })]));
    expect(hidden.map((p) => p.id)).toEqual(['other']);

    await resumeSupportingPost('peer');
    expect(isPostUnsupported('peer')).toBe(false);
    expect(isManifestUnsupported('m1')).toBe(false);
    const back = await fetchHomeFeed('all', deps([post('peer', { _origin: 'synced' })]));
    expect(back.map((p) => p.id)).toEqual(['peer']);
  });
});
