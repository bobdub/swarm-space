import type { UserMeta } from '@/lib/auth';

export function isGuestUser(user: unknown): user is UserMeta & { _guest: true; guestName?: string } {
  return !!user && typeof user === 'object' && (user as { _guest?: boolean })._guest === true;
}

export function canUseMemberFeatures(user: unknown): boolean {
  return !!user && !isGuestUser(user);
}

export function guestSignupRequired(user: unknown, pathname: string): boolean {
  return isGuestUser(user) && ['/profile', '/wallet', '/create'].includes(pathname.replace(/\/$/, ''));
}

export function brainDisplayName(user: UserMeta): string {
  return isGuestUser(user) ? user.guestName?.trim() || 'Guest' : user.username;
}
/** Link into the existing sign-up wizard, returning the guest to `redirect` afterwards. */
export function guestSignupHref(redirect = '/explore'): string {
  return `/auth?signup=1&redirect=${encodeURIComponent(redirect)}`;
}
