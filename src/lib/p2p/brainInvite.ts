/** A user-opened invite is a manual dial, never a Cell Bus/backoff override. */
export type BrainInviteState = {
  peerId: string | null;
  phase: 'idle' | 'starting' | 'connecting' | 'connected' | 'unavailable' | 'invalid';
  startedAt: number;
};

let state: BrainInviteState = { peerId: null, phase: 'idle', startedAt: 0 };
let attemptedUrl = '';
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
  publish({ peerId, phase: peerId ? 'starting' : 'invalid', startedAt: Date.now() });
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
  if (attemptedUrl === key) return false;
  prepareBrainInvite(options.pathname, options.hash);
  if (!options.selfId) return false;
  attemptedUrl = key;
  const peerId = parseBrainInvite(options.pathname, options.hash);
  if (!peerId || peerId === options.selfId || options.isBlocked(peerId)) {
    publish({ peerId, phase: 'invalid', startedAt: Date.now() });
    return false;
  }
  // Publish before dialing so synchronous connection callbacks cannot be overwritten.
  publish({ peerId, phase: 'connecting', startedAt: Date.now() });
  try {
    if (options.dial(peerId)) return true;
  } catch { /* A refused request is not a connection. */ }
  publish({ ...state, phase: 'unavailable' });
  return false;
}

export function updateBrainInviteConnection(connected: boolean) {
  if (!state.peerId || state.phase === 'invalid' || state.phase === 'idle') return;
  if (connected && state.phase !== 'connected') publish({ ...state, phase: 'connected' });
  else if (!connected && (state.phase === 'connected' || Date.now() - state.startedAt >= 30_000)) {
    if (state.phase !== 'unavailable') publish({ ...state, phase: 'unavailable' });
  }
}

export function retryBrainInvite() {
  attemptedUrl = '';
  publish({ ...state, phase: 'starting', startedAt: Date.now() });
}