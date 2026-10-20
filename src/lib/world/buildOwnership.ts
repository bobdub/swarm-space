/** Ownership is identity-based, never based on who cached the record. */
export function ownsPlacement(record: { actorId: string }, actorId?: string | null): boolean {
  return Boolean(actorId && record.actorId === actorId);
}

export function ownsPendingBuild(
  record: { ownerId?: string; universeKey?: string },
  actorId?: string,
  universeKey = 'global',
): boolean {
  // Unattributed historical drafts are retained but cannot be adopted by another account.
  return Boolean(actorId && record.ownerId === actorId && record.universeKey === universeKey);
}