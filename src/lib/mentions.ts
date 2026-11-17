/**
 * Mention system — parse @username tokens and resolve candidates from
 * the swarm library + local IndexedDB users.
 */

import { affinityScore, getConnectionAffinity } from '@/lib/p2p/connectionAffinity';
import type { MentionBinding } from '@/types';
import { ENTITY_USER_ID, ENTITY_DISPLAY_NAME } from '@/lib/p2p/entityVoice';

// ── Types ────────────────────────────────────────────────────────────

export interface MentionMatch {
  username: string;
  startIndex: number;
  endIndex: number;
}

export interface MentionCandidate {
  userId: string;
  peerId?: string;
  displayName: string;
  username: string;
  avatarRef?: string;
  trustScore: number;
  isEntity: boolean;
  discriminator?: string;
  connectedDurationMs?: number;
  affinity?: number;
}

// ── Entity trigger names ────────────────────────────────────────────

export const ENTITY_TRIGGER_NAMES = ['infinity', 'imagination'];

/** Check if text contains an @mention of the network entity */
export function containsEntityMention(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ENTITY_TRIGGER_NAMES.some(name => {
    const idx = lower.indexOf(`@${name}`);
    if (idx === -1) return false;
    // Ensure it's a word boundary (not part of a longer word)
    const afterIdx = idx + name.length + 1;
    if (afterIdx < lower.length && /\w/.test(lower[afterIdx])) return false;
    return true;
  });
}

// ── Parse ────────────────────────────────────────────────────────────

const MENTION_REGEX = /@(\w+)/g;

/** Extract all @username tokens from text */
export function parseMentions(text: string): MentionMatch[] {
  if (!text) return [];
  const matches: MentionMatch[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_REGEX.source, 'g');
  while ((m = re.exec(text)) !== null) {
    matches.push({
      username: m[1],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return matches;
}

// ── Resolve candidates ──────────────────────────────────────────────

/** Resolve mention candidates from swarm library + local DB */
export async function resolveMentionCandidates(query: string, limit = 6): Promise<MentionCandidate[]> {
  const q = query.toLowerCase().trim();
  if (!q) return getEntityCandidates();

  const candidates: MentionCandidate[] = [];
  const seen = new Set<string>();

  // Entity candidates always first
  for (const name of ENTITY_TRIGGER_NAMES) {
    if (name.startsWith(q)) {
      candidates.push({
        userId: ENTITY_USER_ID,
        displayName: ENTITY_DISPLAY_NAME,
        username: name.charAt(0).toUpperCase() + name.slice(1),
        trustScore: 100,
        isEntity: true,
      });
      seen.add(ENTITY_USER_ID + name);
    }
  }

  // Swarm mesh library
  const connectedPeerIds = new Set<string>();
  let owner = '';
  const excluded = new Set<string>();
  try {
    const me = JSON.parse(localStorage.getItem('me') || 'null');
    owner = me?._guest ? '' : me?.id || '';
    const { getAll } = await import('@/lib/store');
    const connections = await getAll<import('@/lib/connections').Connection>('connections');
    for (const c of connections) {
      const other = c.userId === owner ? c.connectedUserId : c.connectedUserId === owner ? c.userId : '';
      if (other && ['blocked', 'ignored', 'removed'].includes(c.status)) excluded.add(other);
    }
  } catch { /* no local relationship records */ }
  try {
    const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone');
    const sm = getSwarmMeshStandalone();
    const library = sm.getLibrary();
    // Build set of currently connected peer IDs for trust boost
    try {
      const peers = sm.getConnectedPeers();
      for (const p of peers) connectedPeerIds.add(p);
    } catch { /* ignore */ }
    for (const peer of library) {
      if (!peer.userId || excluded.has(peer.userId) || peer.userId === owner) continue;
      const dn = (peer.displayName || peer.username || peer.nodeId || '').toLowerCase();
      const un = (peer.username || peer.nodeId || '').toLowerCase();
      if (dn.startsWith(q) || un.startsWith(q)) {
        const key = peer.userId;
        if (!seen.has(key)) {
          seen.add(key);
          const baseTrust = computePeerTrust(peer as unknown as Record<string, unknown>);
          // 80% trust boost for currently connected peers
          const isConnected = connectedPeerIds.has(peer.peerId);
          const boostedTrust = isConnected ? Math.min(100, Math.round(baseTrust * 1.8)) : baseTrust;
          candidates.push({
            userId: peer.userId,
            discriminator: peer.discriminator,
            connectedDurationMs: getConnectionAffinity(owner, peer.userId).connectedDurationMs,
            affinity: affinityScore(owner, peer.userId),
            peerId: peer.peerId,
            displayName: peer.displayName || peer.username || peer.nodeId,
            username: peer.username || peer.nodeId || peer.peerId,
            avatarRef: peer.avatarRef,
            trustScore: boostedTrust,
            isEntity: false,
          });
        }
      }
    }
  } catch { /* swarm not available */ }

  // Local IndexedDB users
  try {
    const { getAll } = await import('@/lib/store');
    const users = await getAll<{
      id: string;
      username?: string;
      displayName?: string;
      profile?: { avatarRef?: string };
    }>('users');
    for (const u of users) {
      if (excluded.has(u.id) || u.id === owner) continue;
      const dn = (u.displayName || u.username || '').toLowerCase();
      const un = (u.username || '').toLowerCase();
      if (dn.startsWith(q) || un.startsWith(q)) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          candidates.push({
            userId: u.id,
            connectedDurationMs: getConnectionAffinity(owner, u.id).connectedDurationMs,
            affinity: affinityScore(owner, u.id),
            displayName: u.displayName || u.username || u.id,
            username: u.username || u.id,
            avatarRef: u.profile?.avatarRef,
            trustScore: 50,
            isEntity: false,
          });
        }
      }
    }
  } catch { /* db not available */ }

  // Sort: entity first, then by trust score descending
  candidates.sort((a, b) => {
    if (a.isEntity && !b.isEntity) return -1;
    if (!a.isEntity && b.isEntity) return 1;
    return (b.affinity ?? 0) - (a.affinity ?? 0) || b.trustScore - a.trustScore || a.userId.localeCompare(b.userId);
  });

  return candidates.slice(0, limit);
}

function getEntityCandidates(): MentionCandidate[] {
  return ENTITY_TRIGGER_NAMES.map(name => ({
    userId: ENTITY_USER_ID,
    displayName: ENTITY_DISPLAY_NAME,
    username: name.charAt(0).toUpperCase() + name.slice(1),
    trustScore: 100,
    isEntity: true,
  }));
}

function computePeerTrust(peer: Record<string, unknown>): number {
  let score = 30;
  if (typeof peer.lastSeen === 'number') {
    const age = Date.now() - peer.lastSeen;
    if (age < 60_000) score += 40;
    else if (age < 300_000) score += 25;
    else if (age < 3600_000) score += 10;
  }
  if (typeof peer.connectionCount === 'number') {
    score += Math.min(30, peer.connectionCount * 3);
  }
  return Math.min(100, score);
}

// ── Username → UserId Resolution ────────────────────────────────────

export interface ResolvedUser {
  userId: string;
  displayName: string;
}

/**
 * Resolve a @username to a userId by searching swarm library + local IndexedDB.
 * Entity trigger names always resolve to ENTITY_USER_ID.
 */
export async function resolveUsernameToId(username: string): Promise<ResolvedUser | null> {
  const lower = username.toLowerCase();

  // Entity triggers
  if (ENTITY_TRIGGER_NAMES.includes(lower)) {
    return { userId: ENTITY_USER_ID, displayName: ENTITY_DISPLAY_NAME };
  }

  // Search every match: the popover's 6-row cap must not hide the exact handle.
  const candidates = await resolveMentionCandidates(username, Infinity);
  const exact = candidates.find(c => c.username.toLowerCase() === lower);
  return exact ? { userId: exact.userId, displayName: exact.displayName } : null;
}

// ── Cached mention map (refreshes every 30s) ───────────────────────
let _mentionCache: Map<string, string> | null = null;
let _mentionCacheTs = 0;
const MENTION_CACHE_TTL = 30_000;

/** Build a sync cache of username→userId from swarm library (for render-time lookups) */
export function buildMentionCache(): Map<string, string> {
  const now = Date.now();
  if (_mentionCache && now - _mentionCacheTs < MENTION_CACHE_TTL) {
    return _mentionCache;
  }

  const cache = new Map<string, string>();
  // Entity triggers
  for (const name of ENTITY_TRIGGER_NAMES) {
    cache.set(name.toLowerCase(), ENTITY_USER_ID);
  }
  try {
    const raw = localStorage.getItem('swarm-mesh-connection-library');
    if (raw) {
      const peers = JSON.parse(raw) as Array<{ userId?: string; username?: string; displayName?: string }>;
      const owner = JSON.parse(localStorage.getItem('me') || 'null')?.id || '';
      peers.sort((a, b) => affinityScore(owner, b.userId || '') - affinityScore(owner, a.userId || ''));
      for (const peer of peers) {
        const id = peer.userId;
        if (!id) continue;
        if (peer.username && !cache.has(peer.username.toLowerCase())) cache.set(peer.username.toLowerCase(), id);
        if (peer.displayName && !cache.has(peer.displayName.toLowerCase())) cache.set(peer.displayName.toLowerCase(), id);
      }
    }
  } catch { /* ignore */ }

  _mentionCache = cache;
  _mentionCacheTs = now;
  return cache;
}

/** Keep ranges through a single edit; a touched token loses its old identity. */
export function rebaseMentions(before: string, after: string, bindings: MentionBinding[]): MentionBinding[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return bindings.flatMap(m => {
    if (m.endIndex <= start) return [m];
    if (m.startIndex >= oldEnd) return [{ ...m, startIndex: m.startIndex + delta, endIndex: m.endIndex + delta }];
    return [];
  }).filter(m => after.slice(m.startIndex, m.endIndex) === `@${m.username}`);
}
export function insertMention(text: string, bindings: MentionBinding[], candidate: MentionCandidate, start: number, end: number, suffix = ' ') {
  const token = `@${candidate.username}`;
  const next = text.slice(0, start) + token + suffix + text.slice(end);
  const remaining = bindings.filter(m => m.endIndex <= start || m.startIndex >= end);
  return { text: next, mentions: [...rebaseMentions(text, next, remaining), {
    userId: candidate.userId, username: candidate.username, discriminator: candidate.discriminator,
    startIndex: start, endIndex: start + token.length,
  }].sort((a, b) => a.startIndex - b.startIndex), cursor: start + token.length + suffix.length };
}
/**
 * Bindings arrive inside posts/comments from other peers, so treat them as
 * untrusted: wrong shapes, non-integer ranges, ranges that don't cover the
 * exact `@handle` token, and second claims on the same token are dropped.
 */
export function validMentionBindings(text: string, bindings: unknown): MentionBinding[] {
  if (!Array.isArray(bindings)) return [];
  const claimed = new Set<number>();
  const valid: MentionBinding[] = [];
  for (const raw of bindings) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Partial<MentionBinding>;
    if (typeof m.userId !== 'string' || !m.userId.trim()) continue;
    if (typeof m.username !== 'string' || !/^\w+$/.test(m.username)) continue;
    if (!Number.isSafeInteger(m.startIndex) || !Number.isSafeInteger(m.endIndex)) continue;
    const start = m.startIndex as number, end = m.endIndex as number;
    if (start < 0 || end !== start + m.username.length + 1 || end > text.length) continue;
    if (text.slice(start, end) !== `@${m.username}`) continue;
    // A token continuing past the handle (e.g. "@Mike" inside "@Mikey") is a different tag.
    if (/\w/.test(text[end] ?? '')) continue;
    if (claimed.has(start)) continue;
    claimed.add(start);
    valid.push({
      userId: m.userId, username: m.username, startIndex: start, endIndex: end,
      ...(typeof m.discriminator === 'string' && /^[\da-f]{8}$/i.test(m.discriminator) ? { discriminator: m.discriminator } : {}),
    });
  }
  return valid;
}
export async function bindMentions(text: string, selected: MentionBinding[] = []): Promise<MentionBinding[]> {
  const valid = validMentionBindings(text, selected);
  const result: MentionBinding[] = [];
  for (const m of parseMentions(text)) {
    const explicit = valid.find(b => b.startIndex === m.startIndex && b.endIndex === m.endIndex);
    if (explicit) { result.push(explicit); continue; }
    const resolved = await resolveUsernameToId(m.username);
    if (resolved) result.push({ ...m, userId: resolved.userId });
  }
  return result;
}
export function trimMentionBindings(text: string, bindings: MentionBinding[]) {
  const leading = text.length - text.trimStart().length;
  return validMentionBindings(text.trim(), validMentionBindings(text, bindings).map(m => ({ ...m, startIndex: m.startIndex - leading, endIndex: m.endIndex - leading })));
}
export function mentionRecipient(text: string, start: number, username: string, bindings?: unknown, legacy?: Map<string, string>) {
  const binding = validMentionBindings(text, bindings).find(m => m.startIndex === start && m.username === username);
  // New payloads are authoritative: unknown tokens must not be reinterpreted by a reader's address book.
  return binding?.userId ?? (bindings === undefined ? legacy?.get(username.toLowerCase()) : undefined);
}
export function mentionNotificationRecipients(bindings: unknown, author: string) {
  const list = Array.isArray(bindings) ? bindings.filter((m): m is MentionBinding => !!m && typeof m === 'object' && typeof m.userId === 'string' && !!m.userId) : [];
  return [...new Set(list.filter(m => m.userId !== author && m.userId !== ENTITY_USER_ID).map(m => m.userId))];
}
