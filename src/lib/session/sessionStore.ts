/**
 * sessionStore — the single source of truth for "who is signed in".
 *
 * Why this exists:
 *  - `useAuth` and `useAuthReady` each ran their own restore and cached their
 *    own answer, so two parts of the same page could disagree.
 *  - A blocked / slow IndexedDB made restore return `null`, which the app read
 *    as *signed out* instead of *not known yet* — users were kicked out of a
 *    session they never left, with no retry once the database freed up.
 *
 * The store models three states — `unknown`, `signed-in`, `signed-out` — runs
 * the restore at most once (with bounded retries while storage is unavailable)
 * and keeps every tab in agreement over a BroadcastChannel.
 */

import {
  getCurrentUser,
  hasIntentionalSignOut,
  restoreSessionAttempt,
  type UserMeta,
} from "@/lib/auth";

export type SessionStatus = "unknown" | "signed-in" | "signed-out";

export interface SessionSnapshot {
  status: SessionStatus;
  user: UserMeta | null;
  /** True while storage could not be read and a retry is pending. */
  storageUnavailable: boolean;
}

type Listener = (snapshot: SessionSnapshot) => void;

const CHANNEL_NAME = "swarm-session";
const MAX_RETRIES = 5;

let snapshot: SessionSnapshot = {
  status: "unknown",
  user: null,
  storageUnavailable: false,
};

const listeners = new Set<Listener>();
let restorePromise: Promise<SessionSnapshot> | null = null;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let channel: BroadcastChannel | null = null;
let wired = false;

function emit(next: SessionSnapshot): void {
  snapshot = next;
  listeners.forEach((l) => {
    try {
      l(next);
    } catch {
      /* ignore listener errors */
    }
  });
}

function setSignedIn(user: UserMeta): void {
  emit({ status: "signed-in", user, storageUnavailable: false });
}

function setSignedOut(): void {
  emit({ status: "signed-out", user: null, storageUnavailable: false });
}

function setUnknown(storageUnavailable: boolean): void {
  emit({ status: "unknown", user: null, storageUnavailable });
}

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Re-read localStorage and publish whatever it says. */
function syncFromStorage(): void {
  const user = getCurrentUser();
  if (user) {
    setSignedIn(user);
    return;
  }
  if (hasIntentionalSignOut()) {
    setSignedOut();
    return;
  }
  // Session entry vanished without an explicit sign-out — try to recover
  // rather than declaring the user signed out.
  restorePromise = null;
  retries = 0;
  setUnknown(false);
  void ensureSessionRestore();
}

function scheduleRetry(): void {
  if (retryTimer || retries >= MAX_RETRIES) return;
  const delay = Math.min(8000, 750 * 2 ** retries);
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    restorePromise = null;
    void ensureSessionRestore();
  }, delay);
}

function wireGlobalListeners(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;

  window.addEventListener("user-login", () => {
    const user = getCurrentUser();
    if (user) {
      setSignedIn(user);
      getChannel()?.postMessage({ type: "signed-in", userId: user.id });
    }
  });

  window.addEventListener("user-logout", () => {
    setSignedOut();
    getChannel()?.postMessage({ type: "signed-out" });
  });

  window.addEventListener("storage", (e) => {
    if (e.key === "me" || e.key === "session-signed-out") syncFromStorage();
  });

  // The local database finished an upgrade / became reachable again — if we
  // never resolved the session, try once more immediately.
  window.addEventListener("db-upgrade-resolved", () => {
    if (snapshot.status === "unknown") {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      restorePromise = null;
      void ensureSessionRestore();
    }
  });

  const ch = getChannel();
  if (ch) {
    ch.onmessage = () => syncFromStorage();
  }
}

/**
 * Resolve the session exactly once per page load (retrying while local
 * storage is unavailable). Safe to call from anywhere.
 */
export function ensureSessionRestore(): Promise<SessionSnapshot> {
  wireGlobalListeners();
  if (restorePromise) return restorePromise;

  // Fast path — the quick session entry is intact.
  const current = getCurrentUser();
  if (current) {
    setSignedIn(current);
    restorePromise = Promise.resolve(snapshot);
    return restorePromise;
  }

  // The user signed out on purpose; never silently restore them.
  if (hasIntentionalSignOut()) {
    setSignedOut();
    restorePromise = Promise.resolve(snapshot);
    return restorePromise;
  }

  restorePromise = restoreSessionAttempt()
    .then((result) => {
      if (result.status === "restored") {
        setSignedIn(result.user);
      } else if (result.status === "none") {
        setSignedOut();
      } else {
        // 'unavailable' — storage could not be read. Stay `unknown` so the UI
        // shows "restoring", and try again shortly.
        setUnknown(true);
        scheduleRetry();
      }
      return snapshot;
    })
    .catch(() => {
      setUnknown(true);
      scheduleRetry();
      return snapshot;
    });

  return restorePromise;
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

export function subscribeSession(listener: Listener): () => void {
  wireGlobalListeners();
  listeners.add(listener);
  try {
    listener(snapshot);
  } catch {
    /* ignore */
  }
  void ensureSessionRestore();
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function __resetSessionStoreForTests(): void {
  snapshot = { status: "unknown", user: null, storageUnavailable: false };
  restorePromise = null;
  retries = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  listeners.clear();
}
