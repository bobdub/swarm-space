import type { GroupWareDecision, GroupWareMembership, GroupWarePolicy } from './types';

export interface PolicyInput {
  policy: GroupWarePolicy;
  requesterPeerId: string;
  hostPeerId: string;
  memberCount: number;
  maxMembers: number;
  blocked: ReadonlySet<string>;
  existingMembers: ReadonlySet<string>;
}

/** Pure host-side decision for an incoming access request. */
export function decideAccess(i: PolicyInput): GroupWareDecision {
  if (!i.requesterPeerId || i.requesterPeerId === i.hostPeerId) return 'deny';
  if (i.blocked.has(i.requesterPeerId)) return 'deny';
  if (i.existingMembers.has(i.requesterPeerId)) return 'grant';
  if (i.policy === 'closed') return 'deny';
  if (i.memberCount >= i.maxMembers) return 'deny';
  return i.policy === 'open' ? 'grant' : 'pending';
}

/** Structural + time validity (signature is checked separately). */
export function isMembershipCurrent(m: GroupWareMembership, now = Date.now()): boolean {
  if (!m.nodeId || !m.hostPeerId || !m.memberPeerId) return false;
  if (m.issuedAt > now + 60_000) return false;
  if (m.expiresAt !== null && m.expiresAt <= now) return false;
  return true;
}

const ROLE_RANK = { reader: 0, writer: 1, admin: 2 } as const;
export function roleAllows(role: GroupWareMembership['role'], op: string): boolean {
  const needed = op === 'get' || op === 'head' || op === 'health' ? 'reader' : op === 'put' ? 'writer' : 'admin';
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}
