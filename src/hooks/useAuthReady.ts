/**
 * useAuthReady — single, app-wide auth resolution gate.
 *
 * Why this exists:
 *  - `useAuth` exposes `{ user, isLoading }` but each consumer mounts at a
 *    different time, so per-page redirect effects fire on different ticks
 *    and Chrome / Brave can land users on `/profile` or `/explore` before
 *    the IndexedDB session restore resolves.
 *  - The P2P auto-enable effect in `useP2P` listens for `user-login`, but
 *    if the hook mounts AFTER `attemptSessionRestore` has already fired
 *    that event the listener is attached too late and P2P stays off.
 *
 * The fix: run `attemptSessionRestore` exactly once per page load behind a
 * module-level promise, and let every consumer subscribe to the same
 * resolution. Once `isReady` flips true, every component sees the same
 * `user` on the same render — no per-page rAF safety nets needed.
 */
import { useEffect, useState } from "react";
import {
  attemptSessionRestore,
  getCurrentUser,
  type UserMeta,
} from "@/lib/auth";

type Listener = (user: UserMeta | null) => void;

let restorePromise: Promise<UserMeta | null> | null = null;
let resolvedUser: UserMeta | null = null;
let isResolved = false;
const listeners = new Set<Listener>();

function emit(user: UserMeta | null): void {
  resolvedUser = user;
  listeners.forEach((l) => {
    try { l(user); } catch { /* ignore listener errors */ }
  });
}

function ensureRestore(): Promise<UserMeta | null> {
  if (restorePromise) return restorePromise;

  // Fast path — localStorage already has a session, skip async restore.
  const initial = getCurrentUser();
  if (initial) {
    isResolved = true;
    resolvedUser = initial;
    restorePromise = Promise.resolve(initial);
    return restorePromise;
  }

  restorePromise = attemptSessionRestore()
    .then((user) => {
      isResolved = true;
      emit(user);
      return user;
    })
    .catch(() => {
      isResolved = true;
      const fallback = getCurrentUser();
      emit(fallback);
      return fallback;
    });

  return restorePromise;
}

/**
 * Returns `{ user, isReady }` with the guarantee that across the whole app
 * `isReady` flips to true on the same tick for every subscriber. Safe to
 * call from any component; the underlying restore runs at most once.
 */
export function useAuthReady(): { user: UserMeta | null; isReady: boolean } {
  const [state, setState] = useState<{ user: UserMeta | null; isReady: boolean }>(() => ({
    user: resolvedUser ?? getCurrentUser(),
    isReady: isResolved,
  }));

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (cancelled) return;
      setState({ user: getCurrentUser(), isReady: true });
    };

    const onLogin = () => sync();
    const onLogout = () => {
      if (cancelled) return;
      setState({ user: null, isReady: true });
    };
    const listener: Listener = (user) => {
      if (cancelled) return;
      setState({ user, isReady: true });
    };

    listeners.add(listener);
    window.addEventListener("user-login", onLogin);
    window.addEventListener("user-logout", onLogout);

    void ensureRestore().then((user) => {
      if (cancelled) return;
      setState({ user: user ?? getCurrentUser(), isReady: true });
    });

    return () => {
      cancelled = true;
      listeners.delete(listener);
      window.removeEventListener("user-login", onLogin);
      window.removeEventListener("user-logout", onLogout);
    };
  }, []);

  return state;
}

/**
 * Imperative variant for non-React callers (e.g. effects in hooks that need
 * to wait for auth before kicking P2P). Resolves with the restored user.
 */
export function whenAuthReady(): Promise<UserMeta | null> {
  return ensureRestore();
}

/** Test-only reset. */
export function __resetAuthReadyForTests(): void {
  restorePromise = null;
  resolvedUser = null;
  isResolved = false;
  listeners.clear();
}