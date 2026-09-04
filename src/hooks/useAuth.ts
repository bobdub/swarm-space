import { useEffect, useState } from "react";
import type { UserMeta } from "@/lib/auth";
import {
  getSessionSnapshot,
  subscribeSession,
} from "@/lib/session/sessionStore";

/**
 * Reactive hook for authentication state.
 *
 * Thin subscriber over the shared session store — every consumer sees the
 * same answer on the same tick, and a session that can't be read yet reports
 * `isLoading` rather than pretending the user is signed out.
 */
export function useAuth() {
  const [state, setState] = useState<{ user: UserMeta | null; isLoading: boolean }>(() => {
    const snap = getSessionSnapshot();
    return { user: snap.user, isLoading: snap.status === "unknown" };
  });

  useEffect(() => {
    return subscribeSession((snap) => {
      setState({ user: snap.user, isLoading: snap.status === "unknown" });
    });
  }, []);

  return state;
}

/** Dispatch custom event when user logs in */
export function notifyUserLogin() {
  window.dispatchEvent(new Event("user-login"));
}

/** Dispatch custom event when user logs out */
export function notifyUserLogout() {
  window.dispatchEvent(new Event("user-logout"));
}
