/**
 * Mention system — parse @username tokens and resolve candidates from
 * the swarm library + local IndexedDB users.
 */

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
export async function resolveMentionCandidates(query: string): Promise<MentionCandidate[]> {
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
  try {
    const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone');
    const sm = getSwarmMeshStandalone();
    const library = sm.getLibrary();
    for (const peer of library) {
      const dn = (peer.displayName || peer.username || peer.nodeId || '').toLowerCase();
      const un = (peer.username || peer.nodeId || '').toLowerCase();
      if (dn.startsWith(q) || un.startsWith(q)) {
        const key = peer.peerId || peer.nodeId;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({
            userId: peer.nodeId || peer.peerId,
            peerId: peer.peerId,
            displayName: peer.displayName || peer.username || peer.nodeId,
            username: peer.username || peer.nodeId || peer.peerId,
            avatarRef: peer.avatarRef,
            trustScore: computePeerTrust(peer as unknown as Record<string, unknown>),
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
      const dn = (u.displayName || u.username || '').toLowerCase();
      const un = (u.username || '').toLowerCase();
      if (dn.startsWith(q) || un.startsWith(q)) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          candidates.push({
            userId: u.id,
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
    return b.trustScore - a.trustScore;
  });

  return candidates.slice(0, 6);
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
