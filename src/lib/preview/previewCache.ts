/**
 * Preview Cache
 *
 * In-memory + sessionStorage cache for content pulled during a preview
 * (share-link) session. Kept separate from the durable `posts` store so
 * guest visits never write user content into IndexedDB.
 */

import type { Post } from '@/types';

const KEY = 'preview:cache:v1';

interface Cache {
  posts: Record<string, { post: Post; hostPeerId?: string; hostHandle?: string; at: number }>;
}

function read(): Cache {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { posts: {} };
    return JSON.parse(raw) as Cache;
  } catch {
    return { posts: {} };
  }
}

function write(cache: Cache) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* quota */ }
}

export function cachePreviewPost(post: Post, host?: { peerId?: string; handle?: string }) {
  const cache = read();
  cache.posts[post.id] = {
    post,
    hostPeerId: host?.peerId,
    hostHandle: host?.handle,
    at: Date.now(),
  };
  write(cache);
}

export function getCachedPreviewPost(postId: string): { post: Post; hostPeerId?: string; hostHandle?: string } | null {
  const cache = read();
  const entry = cache.posts[postId];
  return entry ? { post: entry.post, hostPeerId: entry.hostPeerId, hostHandle: entry.hostHandle } : null;
}

export function clearPreviewCache() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}