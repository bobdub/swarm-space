/**
 * Guest Mode
 *
 * Provisions an ephemeral, per-tab guest identity so an unauthenticated
 * visitor arriving via a share link can start the P2P mesh in the
 * background and receive shared content without signing up first.
 *
 * The guest identity:
 *  - is generated with real keys so peer signalling works,
 *  - lives only in memory + sessionStorage (never persisted to IndexedDB),
 *  - is flagged `_guest: true` so app code can skip it when writing
 *    profile/credit/token records,
 *  - is torn down on sign-up handoff or on `stopGuestMode()`.
 *
 * We only touch localStorage `"me"` if it's empty — a returning user who
 * happens to open a share link keeps their real identity intact.
 */

import { genIdentityKeyPair, computeUserId } from '@/lib/crypto';
import type { UserMeta } from '@/lib/auth';
import { isGuestUser } from './guestAccess';
export { isGuestUser } from './guestAccess';

const GUEST_FLAG_KEY = 'preview:guest-active';
const GUEST_ME_KEY = 'me';
let guestIdentityPromise: Promise<GuestIdentity | null> | null = null;

export interface GuestIdentity extends UserMeta {
  _guest: true;
  guestName?: string;
}

export function isGuestActive(): boolean {
  return sessionStorage.getItem(GUEST_FLAG_KEY) === '1';
}

export function setGuestName(userId: string, name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!normalized) return false;
  try {
    const current = JSON.parse(localStorage.getItem(GUEST_ME_KEY) || 'null');
    if (!isGuestUser(current) || current.id !== userId) return false;
    localStorage.setItem(GUEST_ME_KEY, JSON.stringify({ ...current, guestName: normalized, displayName: normalized }));
    window.dispatchEvent(new Event('user-login'));
    return true;
  } catch { return false; }
}

/**
 * Provision a guest identity if none exists. Never overwrites a real one.
 * Returns the identity in memory; also dispatches `user-login` so useP2P
 * can pick it up and enable the mesh.
 */
export async function ensureGuestIdentity(): Promise<GuestIdentity | null> {
  if (guestIdentityPromise) return guestIdentityPromise;
  guestIdentityPromise = provisionGuestIdentity();
  try {
    return await guestIdentityPromise;
  } finally {
    guestIdentityPromise = null;
  }
}

async function provisionGuestIdentity(): Promise<GuestIdentity | null> {
  const existing = localStorage.getItem(GUEST_ME_KEY);
  if (existing) {
    // Respect any pre-existing identity (real or guest).
    try {
      const parsed = JSON.parse(existing) as UserMeta & { _guest?: boolean };
      return parsed._guest ? (parsed as GuestIdentity) : null;
    } catch { /* fall through and mint one */ }
  }

  try {
    const keys = await genIdentityKeyPair();
    const userId = await computeUserId(keys.publicKey);
    // A member may have signed in while guest keys were being generated.
    // Never replace that account (or a guest another entry flow created).
    const current = localStorage.getItem(GUEST_ME_KEY);
    if (current) {
      try {
        const parsed: unknown = JSON.parse(current);
        return isGuestUser(parsed) ? parsed : null;
      } catch { return null; }
    }
    const guest: GuestIdentity = {
      id: userId,
      username: `guest-${userId.slice(0, 6)}`,
      displayName: 'Guest',
      publicKey: keys.publicKey,
      wrappedKeyRef: `preview:guest:${userId}`,
      createdAt: new Date().toISOString(),
      _guest: true,
    };

    localStorage.setItem(GUEST_ME_KEY, JSON.stringify(guest));
    sessionStorage.setItem(GUEST_FLAG_KEY, '1');
    sessionStorage.setItem(`${GUEST_ME_KEY}:guestKeys`, JSON.stringify({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    }));

    window.dispatchEvent(new Event('user-login'));
    console.log('[guestMode] Ephemeral guest identity provisioned', userId.slice(0, 8));
    return guest;
  } catch (err) {
    console.error('[guestMode] Failed to provision guest identity', err);
    return null;
  }
}

/** Tear down the guest identity — call before a real sign-up. */
export function stopGuestMode(): void {
  if (!isGuestActive()) return;
  const raw = localStorage.getItem(GUEST_ME_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { _guest?: boolean };
      if (parsed._guest) localStorage.removeItem(GUEST_ME_KEY);
    } catch { /* ignore */ }
  }
  sessionStorage.removeItem(GUEST_FLAG_KEY);
  sessionStorage.removeItem(`${GUEST_ME_KEY}:guestKeys`);
  console.log('[guestMode] Guest identity cleared');
}