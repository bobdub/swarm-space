/**
 * Content Lookup Protocol
 *
 * Same-origin (BroadcastChannel) discovery: "who has this postId?".
 * Any tab/peer with the content in local store answers with its peerId
 * + handle. Preview guests use this to render content from a fallback
 * host when the original creator is offline.
 *
 * Cross-peer discovery over WebRTC piggy-backs on the manager's
 * post-sync / ensureManifest paths (see useP2P). This module is
 * intentionally transport-light so guests can benefit even without a
 * fully-booted mesh.
 */

import type { Post, UserMeta } from '@/types';
import { get } from '@/lib/store';

const CHANNEL = 'swarm-content-lookup-v1';

type LookupMsg =
  | { type: 'content-lookup'; postId: string; requesterId: string; at: number }
  | {
      type: 'content-host-ack';
      postId: string;
      requesterId: string;
      peerId: string | null;
      handle: string | null;
      post: Post;
      at: number;
    };

export interface HostAck {
  peerId: string | null;
  handle: string | null;
  post: Post;
}

let listenerChannel: BroadcastChannel | null = null;
let responderStarted = false;

/** Ask any other tab/peer on this origin if they have `postId`. */
export function requestContentHost(
  postId: string,
  opts: { timeoutMs?: number; requesterId?: string } = {}
): Promise<HostAck[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const requesterId = opts.requesterId ?? `req-${Math.random().toString(36).slice(2, 10)}`;

  return new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') {
      resolve([]);
      return;
    }
    const acks: HostAck[] = [];
    const ch = new BroadcastChannel(CHANNEL);
    const seen = new Set<string>();

    ch.onmessage = (ev) => {
      const msg = ev.data as LookupMsg;
      if (!msg || msg.type !== 'content-host-ack') return;
      if (msg.requesterId !== requesterId) return;
      const key = `${msg.peerId ?? 'unknown'}:${msg.post?.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      acks.push({ peerId: msg.peerId, handle: msg.handle, post: msg.post });
    };

    const req: LookupMsg = { type: 'content-lookup', postId, requesterId, at: Date.now() };
    try { ch.postMessage(req); } catch { /* ignore */ }

    setTimeout(() => {
      try { ch.close(); } catch { /* ignore */ }
      resolve(acks);
    }, timeoutMs);
  });
}

/**
 * Start the local responder — any post in the local IndexedDB store
 * that matches an incoming lookup gets returned to the requester.
 * Idempotent.
 */
export function startContentLookupResponder(): void {
  if (responderStarted || typeof BroadcastChannel === 'undefined') return;
  responderStarted = true;

  listenerChannel = new BroadcastChannel(CHANNEL);
  listenerChannel.onmessage = async (ev) => {
    const msg = ev.data as LookupMsg;
    if (!msg || msg.type !== 'content-lookup') return;

    try {
      const post = await get<Post>('posts', msg.postId);
      if (!post) return;

      // Look up local identity for the "hosted by" badge — best effort.
      let peerId: string | null = null;
      let handle: string | null = null;
      try {
        const raw = localStorage.getItem('me');
        if (raw) {
          const me = JSON.parse(raw) as UserMeta;
          handle = me.username ?? me.displayName ?? null;
        }
        peerId = localStorage.getItem('p2p-peer-id') ?? null;
      } catch { /* ignore */ }

      const ack: LookupMsg = {
        type: 'content-host-ack',
        postId: msg.postId,
        requesterId: msg.requesterId,
        peerId,
        handle,
        post,
        at: Date.now(),
      };
      listenerChannel?.postMessage(ack);
    } catch (err) {
      console.warn('[contentLookup] responder failed', err);
    }
  };

  console.log('[contentLookup] responder started');
}

export function stopContentLookupResponder(): void {
  try { listenerChannel?.close(); } catch { /* ignore */ }
  listenerChannel = null;
  responderStarted = false;
}