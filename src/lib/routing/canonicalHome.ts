/**
 * Single source of truth for "where should this user land".
 *
 * Logged-in users always belong on /brain (the lobby gives P2P time to settle
 * in the background). Guests stay on the marketing root. Anywhere else in the
 * app that needs a "go home" target should call this — never hard-code "/" or
 * "/profile" again.
 */
import type { UserMeta } from "@/lib/auth";

export const GUEST_HOME = "/";
export const MEMBER_HOME = "/brain";

export function getCanonicalHome(user: UserMeta | null | undefined): string {
  return user ? MEMBER_HOME : GUEST_HOME;
}

/**
 * Should we treat this `from`/redirect target as "no real preference"?
 * Bare root + the legacy /index alias collapse to canonical home so we
 * never bounce a logged-in user back to the marketing page.
 */
export function isHomelessRedirect(path: string | null | undefined): boolean {
  if (!path) return true;
  const normalized = path.split("?")[0].split("#")[0];
  return normalized === "/" || normalized === "/index" || normalized === "";
}

export function resolvePostAuthTarget(
  user: UserMeta | null | undefined,
  preferred?: string | null,
): string {
  if (preferred && !isHomelessRedirect(preferred)) {
    return preferred;
  }
  return getCanonicalHome(user);
}

/**
 * Canonicalize route paths for subsystems that key behavior off pathname.
 * `/` and `/index` must collapse to the logged-in home so discovery, auth,
 * and navigation do not split users across different boot rooms.
 */
export function canonicalizePathnameForUser(
  pathname: string | null | undefined,
  user: UserMeta | null | undefined,
): string {
  if (isHomelessRedirect(pathname)) {
    return getCanonicalHome(user);
  }

  const normalized = pathname?.split('?')[0].split('#')[0] ?? '';
  return normalized || getCanonicalHome(user);
}