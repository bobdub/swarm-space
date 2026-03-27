/**
 * Cross-Mode Content Bridge
 * 
 * Enables post/comment exchange between SWARM Mesh and Builder Mode users.
 * Both modes listen on a shared BroadcastChannel ("swarm-space-content")
 * for same-origin tab communication, and both hook into the same Gun relay
 * channels for cross-browser content delivery.
 * 
 * This ensures a Builder Mode user can see posts from a SWARM Mesh user
 * and vice versa, regardless of which P2P mode each is running.
 */

import { getAll, get, put } from '../store';
import type { Post } from '@/types';

const SHARED_CONTENT_CHANNEL = 'swarm-space-content';

interface ContentMessage {
  type: 'post_broadcast' | 'post_request' | 'post_sync';
  from: string; // Node ID of sender
  mode: 'swarm' | 'builder'; // Which mode the sender is using
  posts?: Post[];
  post?: Post;
  timestamp: number;
}

let channel: BroadcastChannel | null = null;
let localNodeId: string | null = null;
let listening = false;

/**
 * Start the content bridge — call from both SWARM Mesh and Builder Mode
 * on initialization.
 */
export function startContentBridge(nodeId: string): void {
  if (listening) return;
  localNodeId = nodeId;

  if (typeof BroadcastChannel === 'undefined') return;

  channel = new BroadcastChannel(SHARED_CONTENT_CHANNEL);
  channel.onmessage = (e) => {
    const msg = e.data as ContentMessage;
    if (!msg || msg.from === localNodeId) return;
    void handleIncomingContent(msg);
  };

  listening = true;
  console.log('[ContentBridge] 🌉 Cross-mode content bridge started for', nodeId);

  // Request posts from any other tabs/modes running
  broadcastContentMessage({
    type: 'post_request',
    from: nodeId,
    mode: getLocalMode(),
    timestamp: Date.now(),
  });
}

/**
 * Stop the content bridge
 */
export function stopContentBridge(): void {
  channel?.close();
  channel = null;
  localNodeId = null;
  listening = false;
}

/**
 * Broadcast a new post through the shared content channel
 */
export function bridgeBroadcastPost(post: Post): void {
  if (!listening || !localNodeId) return;

  broadcastContentMessage({
    type: 'post_broadcast',
    from: localNodeId,
    mode: getLocalMode(),
    post,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast all local posts (response to post_request)
 */
async function sendAllPosts(): Promise<void> {
  if (!localNodeId) return;

  try {
    const posts = await getAll<Post>('posts');
    if (posts.length === 0) return;

    broadcastContentMessage({
      type: 'post_sync',
      from: localNodeId,
      mode: getLocalMode(),
      posts,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn('[ContentBridge] Failed to send posts:', err);
  }
}

/**
 * Handle incoming content from the bridge
 */
async function handleIncomingContent(msg: ContentMessage): Promise<void> {
  switch (msg.type) {
    case 'post_request':
      // Another mode/tab is asking for our posts
      await sendAllPosts();
      break;

    case 'post_broadcast': {
      if (msg.post) {
        const saved = await upsertPost(msg.post);
        if (saved) {
          notifyFeed();
          console.log(`[ContentBridge] 📬 Received post ${msg.post.id} from ${msg.mode} node ${msg.from.slice(0, 8)}`);
        }
      }
      break;
    }

    case 'post_sync': {
      if (Array.isArray(msg.posts) && msg.posts.length > 0) {
        let count = 0;
        for (const post of msg.posts) {
          const saved = await upsertPost(post);
          if (saved) count++;
        }
        if (count > 0) {
          notifyFeed();
          console.log(`[ContentBridge] 📬 Synced ${count} posts from ${msg.mode} node ${msg.from.slice(0, 8)}`);
        }
      }
      break;
    }
  }
}

/**
 * Upsert a post — only save if new or newer
 */
async function upsertPost(post: Post): Promise<boolean> {
  try {
    // BUG-15: Tag bridge-received posts as 'synced' if not already tagged
    if (!post._origin) {
      post._origin = 'synced';
    }
    const existing = await get<Post>('posts', post.id);
    if (existing) {
      const existingTime = new Date(existing.createdAt).getTime();
      const incomingTime = new Date(post.createdAt).getTime();
      if (incomingTime <= existingTime) return false;
    }
    await put('posts', post);
    return true;
  } catch {
    return false;
  }
}

function notifyFeed(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('p2p-posts-updated'));
  }
}

function getLocalMode(): 'swarm' | 'builder' {
  try {
    const stored = localStorage.getItem('p2p-swarm-mesh-mode');
    return stored === 'true' ? 'swarm' : 'builder';
  } catch {
    return 'swarm';
  }
}

function broadcastContentMessage(msg: ContentMessage): void {
  try {
    channel?.postMessage(msg);
  } catch (err) {
    console.warn('[ContentBridge] Failed to broadcast:', err);
  }
}
