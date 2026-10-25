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
const REDIAL_INTERVAL_MS = 10_000;
const UNAVAILABLE_AFTER_MS = 60_000;
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

export function parseBrainInvite(pathname: string, hash: string): string | null {
  if (pathname.replace(/\/$/, '') !== '/brain/join') return null;
  try {
    const id = decodeURIComponent(hash.replace(/^#/, '')).trim();
    return /^peer-[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : null;
  } catch { return null; }
}

export function brainInviteUrl(origin: string, peerId: string): string {
  return `${origin}/brain/join#${encodeURIComponent(peerId)}`;
}

export function prepareBrainInvite(pathname: string, hash: string) {
  if (pathname.replace(/\/$/, '') !== '/brain/join') return;
  const peerId = parseBrainInvite(pathname, hash);
  if (state.peerId === peerId && state.phase !== 'idle') return;
  attemptedUrl = '';
  attemptCount = 0;
  lastAttemptAt = 0;
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
  if (options.pathname.replace(/\/$/, '') !== '/brain/join') return false;
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
    if (options.dial(peerId)) return true;
  } catch { /* A refused request is not a connection. */ }
  publish({ ...state, phase: 'unavailable' });
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
  publish({ ...state, phase: 'starting', startedAt: Date.now(), connectedAt: null });
}
