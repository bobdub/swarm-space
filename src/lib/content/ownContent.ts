/**
 * Own-content identity — "is this post mine?" in one place.
 *
 * `post.author === user.id` alone was fragile: identity keys come in two
 * families (the P-256 identity key that derives `user.id`, and the device
 * Ed25519 key that signs posts), public keys travel as SPKI or raw base64,
 * and merged accounts leave posts behind under a retired id. A post counts
 * as the local identity's own when any of these hold:
 *
 *   1. its author is the signed-in user id (or a retired id merged into it),
 *   2. its author field carries the user's own identity public key,
 *   3. it was created on this device (`_origin: 'local'`) AND signed by this
 *      device's Ed25519 content key.
 *
 * Comparisons trim whitespace; ids and base64 keys are otherwise exact.
 */
import type { Post } from '@/types';
import { get } from '@/lib/store';
import { peekRendezvousPublicKey } from '@/lib/p2p/rendezvousIdentity';

export interface LocalIdentity {
  userId: string | null;
  /** The identity P-256 public key (base64 SPKI or raw). */
  publicKey?: string | null;
  /** This device's Ed25519 content-signing public key. */
  deviceSignerKey?: string | null;
  /** Retired account ids merged into `userId`. */
  aliasIds?: readonly string[];
}

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isOwnPost(
  post: Pick<Post, 'author'> & Partial<Pick<Post, '_origin' | 'signerPublicKey'>>,
  identity: LocalIdentity | null | undefined,
): boolean {
  if (!identity) return false;
  const author = norm(post.author);
  const userId = norm(identity.userId);
  if (author && userId && author === userId) return true;
  if (author && identity.aliasIds?.some((id) => norm(id) === author)) return true;
  const publicKey = norm(identity.publicKey);
  if (author && publicKey && author === publicKey) return true;
  const deviceKey = norm(identity.deviceSignerKey);
  if (post._origin === 'local' && deviceKey && norm(post.signerPublicKey) === deviceKey) return true;
  return false;
}

/** Gather the local identity for ownership checks (never generates keys). */
export async function resolveLocalIdentity(
  user: { id: string; publicKey?: string } | null | undefined,
): Promise<LocalIdentity> {
  const userId = user?.id ?? null;
  let aliasIds: string[] = [];
  if (userId) {
    try {
      const row = await get<{ k: string; v: Record<string, { retiringId?: string }> }>(
        'meta',
        `account:aliases:${userId}`,
      );
      aliasIds = Object.values(row?.v ?? {})
        .map((a) => a?.retiringId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    } catch {
      aliasIds = [];
    }
  }
  return {
    userId,
    publicKey: user?.publicKey ?? null,
    deviceSignerKey: peekRendezvousPublicKey(),
    aliasIds,
  };
}
