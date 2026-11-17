/** UQRC-inspired coordinates, not a physical measurement or authentication proof.
 * N(u) = SHA256(JSON([version, Uu, lower(Wu)])).
 * The full userId remains authoritative; even a full digest can collide.
 * T(A,B) = log1p(hours together) + .25 log1p(sessions) + .1 exp(-idleDays/7).
 * Affinity is local observation, never a network-supplied trust assertion.
 */
export async function namespaceIdentity(userId: string, walletAddress: string) {
  if (!userId.trim() || !isPublicWalletAddress(walletAddress)) {
    throw new Error('A user identity and real public receiving address are required.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(['swarm-namespace-v1', userId, walletAddress.toLowerCase()]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const namespaceId = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { namespaceId, discriminator: namespaceId.slice(0, 8) };
}

export interface ConnectionAffinity {
  connectedDurationMs: number;
  sessions: number;
  lastInteractionAt: number;
}
const finitePositive = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;
export function connectionCurvature(history: Partial<ConnectionAffinity>, now = Date.now()): number {
  const hours = finitePositive(history.connectedDurationMs ?? 0) / 3_600_000;
  const sessions = finitePositive(history.sessions ?? 0);
  const last = finitePositive(history.lastInteractionAt ?? 0);
  const idleDays = finitePositive(now - last) / 86_400_000;
  return Math.log1p(hours) + .25 * Math.log1p(sessions) + (last > 0 ? .1 * Math.exp(-idleDays / 7) : 0);
}
/** A real, non-zero EVM public address (format only — not proof of ownership). */
export function isPublicWalletAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
}

/**
 * Peers relay namespace coordinates they did not compute. Accept them only when
 * they re-derive locally from the claimed userId + wallet anchor, so a relay
 * cannot pin someone else's #discriminator onto a duplicate handle.
 */
export async function verifyNamespaceIdentity(
  userId: unknown, walletAddress: unknown, namespaceId: unknown, discriminator: unknown,
): Promise<boolean> {
  if (typeof userId !== 'string' || !isPublicWalletAddress(walletAddress)) return false;
  if (typeof namespaceId !== 'string' || typeof discriminator !== 'string') return false;
  try {
    const derived = await namespaceIdentity(userId, walletAddress);
    return derived.namespaceId === namespaceId.toLowerCase() && derived.discriminator === discriminator.toLowerCase();
  } catch {
    return false;
  }
}
