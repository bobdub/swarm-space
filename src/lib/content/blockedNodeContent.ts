/**
 * blockedNodeContent — what this node refuses to carry for a blocked node.
 *
 * Blocking a node does two things: the mesh refuses its connection, and this
 * node stops supporting its content. The second half lives here. Each
 * blocked node is remembered with the account ids it posts as; any post by
 * those authors is treated like a Stop Support post:
 *   - posts already held are added to the Stop Support list (tagged with the
 *     blocked node), so feeds drop them and the mesh stops serving, seeding
 *     and relaying them and their media,
 *   - new copies from any peer are refused at the door.
 * Unblocking resumes exactly the posts the block stopped, nothing else.
 *
 * A localStorage record keeps the set readable synchronously from the first
 * frame, so render paths and the mesh never let a blocked author through.
 */
import {
  listUnsupportedPosts,
  isPostUnsupported,
  resumeSupportingPost,
  stopSupportingPost,
} from './unsupportedPostsStore';

export interface BlockedNodeRecord {
  peerId: string;
  /** Account ids this node posts as, learned from its contact entry or gossip. */
  userIds: string[];
  blockedAt: number;
}

const STORAGE_KEY = 'swarm:blocked-node-content:v1';
const MAX_USER_IDS = 16;

let records = new Map<string, BlockedNodeRecord>();
let authorIndex = new Set<string>();
const listeners = new Set<() => void>();

function rebuild(): void {
  authorIndex = new Set();
  for (const r of records.values()) r.userIds.forEach((id) => authorIndex.add(id));
}

function load(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return;
    for (const raw of parsed as Array<Partial<BlockedNodeRecord>>) {
      if (!raw || typeof raw.peerId !== 'string' || !raw.peerId) continue;
      const userIds = Array.isArray(raw.userIds)
        ? raw.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_USER_IDS)
        : [];
      records.set(raw.peerId, { peerId: raw.peerId, userIds, blockedAt: typeof raw.blockedAt === 'number' ? raw.blockedAt : Date.now() });
    }
  } catch { /* corrupt record — start empty */ }
  rebuild();
}

function save(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (records.size === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify([...records.values()]));
  } catch { /* quota — the in-memory set still applies this session */ }
}

function emit(): void {
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

load();

/** True when this author's content belongs to a node this device blocked. */
export function isAuthorBlocked(author: string | null | undefined): boolean {
  return Boolean(author) && authorIndex.has(author as string);
}

export function listBlockedNodeContent(): BlockedNodeRecord[] {
  return [...records.values()];
}

export function subscribeBlockedNodeContent(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Remember a blocked node and the account ids it posts as. Returns the ids
 * that were not known before, so the caller only sweeps for what's new.
 */
export function recordBlockedNode(peerId: string, userIds: Array<string | null | undefined> = []): string[] {
  if (!peerId) return [];
  const record = records.get(peerId) ?? { peerId, userIds: [], blockedAt: Date.now() };
  const added: string[] = [];
  for (const id of userIds) {
    if (!id || record.userIds.includes(id) || record.userIds.length >= MAX_USER_IDS) continue;
    record.userIds.push(id);
    added.push(id);
  }
  const isNew = !records.has(peerId);
  records.set(peerId, record);
  if (isNew || added.length) { rebuild(); save(); emit(); }
  return added;
}

/** Forget a blocked node. Returns its record, if there was one. */
export function forgetBlockedNode(peerId: string): BlockedNodeRecord | undefined {
  const record = records.get(peerId);
  if (!record) return undefined;
  records.delete(peerId);
  rebuild();
  save();
  emit();
  return record;
}

/**
 * Stop supporting every post this device holds from the given authors,
 * tagged with the blocked node so unblocking can give exactly these back.
 * Posts the user already stopped supporting themselves are left as they are.
 */
export async function stopSupportingNodeContent(peerId: string, userIds: string[]): Promise<number> {
  if (!userIds.length) return 0;
  const authors = new Set(userIds);
  let posts: Array<{ id?: string; author?: string }> = [];
  try {
    const { getAll } = await import('@/lib/store');
    posts = await getAll<{ id?: string; author?: string }>('posts');
  } catch { return 0; }
  let n = 0;
  for (const post of posts) {
    if (!post.id || !post.author || !authors.has(post.author) || isPostUnsupported(post.id)) continue;
    // Stop only while still blocked: an unblock mid-sweep must not leave strays.
    if (!records.has(peerId)) break;
    await stopSupportingPost({ postId: post.id, source: 'block', blockedNode: peerId });
    n++;
  }
  return n;
}

/** Give back the posts a block stopped; the node's new posts flow again. */
export async function resumeNodeContent(peerId: string): Promise<number> {
  const stopped = listUnsupportedPosts().filter((e) => e.source === 'block' && e.blockedNode === peerId);
  for (const entry of stopped) await resumeSupportingPost(entry.postId);
  return stopped.length;
}

export function _resetBlockedNodeContentForTest(): void {
  records = new Map();
  rebuild();
  listeners.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
