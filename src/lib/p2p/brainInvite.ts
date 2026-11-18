/** A user-opened invite is a manual dial, never a Cell Bus/backoff override. */
export type BrainInviteState = {
  peerId: string | null;
  phase: 'idle' | 'starting' | 'connecting' | 'syncing' | 'connected' | 'unavailable' | 'invalid';
  startedAt: number;
  /** When the host DataChannel first opened; null until then. */
  connectedAt: number | null;
};

let state: BrainInviteState = { peerId: null, phase: 'idle', startedAt: 0, connectedAt: null };
let attemptedUrl = '';
let attemptCount = 0;
let lastAttemptAt = 0;
// Cold private-tab joins need warm-up: guest key provisioning, signaling and
// ICE can outlast a single dial. Knock a few times before giving up.
const MAX_ATTEMPTS = 4;
const REDIAL_INTERVAL_MS = 12_000;
const UNAVAILABLE_AFTER_MS = 60_000;
/** How long a local node may refuse to dial (still starting) before the invite is "unavailable". */
export const REFUSED_GRACE_MS = 20_000;
let firstRefusedAt = 0;
const listeners = new Set<() => void>();
const publish = (next: BrainInviteState) => {
  state = next;
  listeners.forEach(listener => listener());
};
export const getBrainInviteState = () => state;
export const subscribeBrainInvite = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * Paths that carry a `#peer-…` invite in their hash.
 * - `/brain/join` dials the host and opens the Brain room.
 * - `/connect` only dials the sharer as a peer node: no Brain, no profile.
 */
export const BRAIN_JOIN_PATH = '/brain/join';
export const PEER_CONNECT_PATH = '/connect';
const INVITE_PATHS = new Set([BRAIN_JOIN_PATH, PEER_CONNECT_PATH]);

export function isInvitePath(pathname: string): boolean {
  return INVITE_PATHS.has(pathname.replace(/\/$/, ''));
}

const PEER_ID_PATTERN = /^peer-[a-zA-Z0-9_-]{1,120}$/;

function normalizePeerId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const id = decodeURIComponent(raw.replace(/^#/, '')).trim();
    return PEER_ID_PATTERN.test(id) ? id : null;
  } catch { return null; }
}

export type InviteLocation = { path: string; peerId: string | null };

/**
 * Find an invite in any URL shape a share service or preview may produce:
 * - `/connect#peer-…` (canonical)
 * - `/#/connect#peer-…` or `/#/connect/#peer-…` (hash routing wrappers)
 * - `/connect?peer=peer-…` or `/#/connect?peer=peer-…` (query fallback)
 * Returns null when the URL is not an invite route at all.
 */
export function resolveInviteLocation(pathname: string, hash: string, search = ''): InviteLocation | null {
  if (isInvitePath(pathname)) {
    const query = new URLSearchParams(search).get('peer');
    return { path: pathname.replace(/\/$/, ''), peerId: normalizePeerId(hash) ?? normalizePeerId(query) };
  }
  // Hash routing: the route lives inside the fragment, e.g. `#/connect#peer-x`.
  const routed = /^#!?(\/[^#?]*)(\?[^#]*)?(#.*)?$/.exec(hash);
  if (!routed || !isInvitePath(routed[1])) return null;
  const query = new URLSearchParams(routed[2] ?? '').get('peer') ?? new URLSearchParams(search).get('peer');
  return { path: routed[1].replace(/\/$/, ''), peerId: normalizePeerId(routed[3]) ?? normalizePeerId(query) };
}

/**
 * The canonical `path#peer` form for a non-canonical invite URL, or null when
 * the URL is already canonical or not an invite. Rewriting before the router
 * mounts lets every reader (router, startup dial, AuthGuard) see one shape.
 */
export function canonicalInviteHref(pathname: string, hash: string, search = ''): string | null {
  const invite = resolveInviteLocation(pathname, hash, search);
  if (!invite?.peerId) return null;
  const params = new URLSearchParams(search);
  params.delete('peer');
  const rest = params.toString();
  const canonical = `${invite.path}${rest ? `?${rest}` : ''}#${encodeURIComponent(invite.peerId)}`;
  return canonical === `${pathname}${search}${hash}` ? null : canonical;
}

export function parseBrainInvite(pathname: string, hash: string, search = ''): string | null {
  return resolveInviteLocation(pathname, hash, search)?.peerId ?? null;
}

export function brainInviteUrl(origin: string, peerId: string): string {
  return `${origin}${BRAIN_JOIN_PATH}#${encodeURIComponent(peerId)}`;
}

/** A plain peer-connect link: opening it only dials the sharer's node. */
export function peerConnectUrl(origin: string, peerId: string): string {
  return `${origin}${PEER_CONNECT_PATH}#${encodeURIComponent(peerId)}`;
}

export function prepareBrainInvite(pathname: string, hash: string) {
  if (!resolveInviteLocation(pathname, hash)) return;
  const peerId = parseBrainInvite(pathname, hash);
  if (state.peerId === peerId && state.phase !== 'idle') return;
  attemptedUrl = '';
  attemptCount = 0;
  lastAttemptAt = 0;
  firstRefusedAt = 0;
  publish({ peerId, phase: peerId ? 'starting' : 'invalid', startedAt: Date.now(), connectedAt: null });
}

/** Called immediately on signaling readiness, before general discovery starts. */
export function dialBrainInviteFirst(options: {
  pathname: string;
  hash: string;
  selfId: string | null;
  isBlocked: (peerId: string) => boolean;
  dial: (peerId: string) => boolean;
}): boolean {
  if (!resolveInviteLocation(options.pathname, options.hash)) return false;
  const key = options.pathname + options.hash;
  if (attemptedUrl === key) {
    // A dial request is not a handshake: while still connecting, knock again
    // on a slow interval instead of waiting for the user to press Retry.
    const mayRedial =
      state.phase === 'connecting' &&
      attemptCount < MAX_ATTEMPTS &&
      Date.now() - lastAttemptAt >= REDIAL_INTERVAL_MS;
    if (!mayRedial) return false;
  }
  prepareBrainInvite(options.pathname, options.hash);
  if (!options.selfId) return false;
  if (attemptedUrl !== key) {
    attemptedUrl = key;
    attemptCount = 0;
  }
  attemptCount += 1;
  lastAttemptAt = Date.now();
  const peerId = parseBrainInvite(options.pathname, options.hash);
  if (!peerId || peerId === options.selfId || options.isBlocked(peerId)) {
    publish({ peerId, phase: 'invalid', startedAt: Date.now(), connectedAt: null });
    return false;
  }
  // Publish before dialing so synchronous connection callbacks cannot be overwritten.
  publish({ peerId, phase: 'connecting', startedAt: Date.now(), connectedAt: null });
  try {
    if (options.dial(peerId)) { firstRefusedAt = 0; return true; }
  } catch { /* A refused request is not a connection. */ }
  // A refused request usually means the local node is still warming up
  // (signaling, guest keys). Keep the invite buffered and let the next
  // readiness tick ask again; only a sustained refusal is "unavailable".
  const nowTs = Date.now();
  if (!firstRefusedAt) firstRefusedAt = nowTs;
  if (nowTs - firstRefusedAt >= REFUSED_GRACE_MS) {
    publish({ ...state, phase: 'unavailable' });
    return false;
  }
  attemptedUrl = '';
  attemptCount = Math.max(0, attemptCount - 1);
  publish({ ...state, phase: 'starting' });
  return false;
}

export function updateBrainInviteConnection(connected: boolean) {
  if (!state.peerId || state.phase === 'invalid' || state.phase === 'idle') return;
  if (connected) {
    // The DataChannel is open, but usernames, presence and room state still
    // need a beat to exchange — say "syncing" until the host is named.
    if (state.phase !== 'syncing' && state.phase !== 'connected') {
      publish({ ...state, phase: 'syncing', connectedAt: Date.now() });
    }
    return;
  }
  if (state.phase === 'connected' || state.phase === 'syncing' || Date.now() - state.startedAt >= UNAVAILABLE_AFTER_MS) {
    if (state.phase !== 'unavailable') publish({ ...state, phase: 'unavailable' });
  }
}

/** The host's identity/presence has resolved (or enough time passed) — the room is truly live. */
export function markBrainInviteSynced() {
  if (state.phase === 'syncing') publish({ ...state, phase: 'connected' });
}

export function retryBrainInvite() {
  attemptedUrl = '';
  attemptCount = 0;
  lastAttemptAt = 0;
  firstRefusedAt = 0;
  publish({ ...state, phase: 'starting', startedAt: Date.now(), connectedAt: null });
}
