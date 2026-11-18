/**
 * SWARM link resolution — decides whether a URL points somewhere inside
 * this app (a post, a profile, the wallet…) or out to the wider web.
 *
 * Internal links must navigate in-app through React Router: a full page
 * load would tear down the WebRTC mesh and end any running Brain meeting
 * (Brain sync lives in memory only). External links always open
 * separately, in a new tab.
 */

/** Public hosts that serve this same app. The current origin always counts. */
export const SWARM_APP_HOSTS: readonly string[] = [
  'swarm-space.lovable.app',
  'swarm-space.network',
  'www.swarm-space.network',
];

/** Paths that look like files (`/whitepaper.pdf`) are served, not routed. */
const FILE_EXTENSION = /\.[a-z0-9]{2,5}$/i;

function currentOrigin(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return window.location.origin;
}

/**
 * Returns the in-app path (`/posts/abc?x=1#y`) for a SWARM link, or `null`
 * when the URL is external, not http(s), or not a routable page.
 */
export function resolveSwarmPath(
  href: string | null | undefined,
  origin: string | null = currentOrigin(),
): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw) return null;
  // Same-page anchors are left to the browser.
  if (raw.startsWith('#')) return null;

  let url: URL;
  try {
    url = new URL(raw, origin ?? 'http://swarm.invalid');
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const sameOrigin = origin !== null && url.origin === origin;
  const relative = origin === null && url.host === 'swarm.invalid';
  const knownHost = SWARM_APP_HOSTS.includes(url.hostname.toLowerCase());
  if (!sameOrigin && !relative && !knownHost) return null;

  if (FILE_EXTENSION.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isSwarmLink(href: string | null | undefined, origin?: string | null): boolean {
  return resolveSwarmPath(href, origin === undefined ? currentOrigin() : origin) !== null;
}

/** http(s) links that leave the app. mailto:, tel: and friends are not included. */
export function isExternalWebLink(href: string | null | undefined, origin?: string | null): boolean {
  if (!href) return false;
  const o = origin === undefined ? currentOrigin() : origin;
  const raw = href.trim();
  if (!raw || raw.startsWith('#')) return false;
  let url: URL;
  try {
    url = new URL(raw, o ?? 'http://swarm.invalid');
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (o !== null && url.origin === o) return false;
  if (o === null && url.host === 'swarm.invalid') return false;
  return !SWARM_APP_HOSTS.includes(url.hostname.toLowerCase());
}

/** A click the browser should handle itself (new tab, new window, download…). */
export function isModifiedClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}
