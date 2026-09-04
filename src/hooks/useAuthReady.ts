/**
 * useAuthReady — single, app-wide auth resolution gate.
 *
 * Backed by `sessionStore`, which owns the one restore attempt per page load,
 * keeps tabs in agreement, and distinguishes "not known yet" from "signed
 * out". `isReady` only flips true once the session actually resolved, so no
 * screen renders a signed-out experience while storage is still unreadable.
 */
import { useEffect, useState } from "react";
import type { UserMeta } from "@/lib/auth";
import {
  ensureSessionRestore,
  getSessionSnapshot,
  subscribeSession,
  __resetSessionStoreForTests,
} from "@/lib/session/sessionStore";

export function useAuthReady(): { user: UserMeta | null; isReady: boolean } {
  const [state, setState] = useState<{ user: UserMeta | null; isReady: boolean }>(() => {
    const snap = getSessionSnapshot();
    return { user: snap.user, isReady: snap.status !== "unknown" };
  });

  useEffect(() => {
    return subscribeSession((snap) => {
      setState({ user: snap.user, isReady: snap.status !== "unknown" });
    });
  }, []);

  return state;
}

/**
 * Imperative variant for non-React callers (e.g. effects in hooks that need
 * to wait for auth before kicking P2P). Resolves with the restored user.
 */
export function whenAuthReady(): Promise<UserMeta | null> {
  return ensureSessionRestore().then((snap) => snap.user);
}

/** Test-only reset. */
export function __resetAuthReadyForTests(): void {
  __resetSessionStoreForTests();
}
