import { useState, useEffect } from "react";
import { getCurrentUser, attemptSessionRestore, UserMeta } from "@/lib/auth";

/**
 * Reactive hook for authentication state.
 * On mount, attempts to restore a session from IndexedDB if localStorage
 * was wiped (cache clear, Brave Shields, browser restart, etc.).
 * Listens to storage + custom events for cross-tab / in-tab reactivity.
 */
export function useAuth() {
  // Synchronous read from localStorage — if a user is already present we can
  // skip the loading gate entirely. The async IndexedDB restore below only
  // matters when localStorage was wiped (cache clear, Brave Shields, etc.).
  // Without this, redirects gated on `!isLoading && user` (e.g. Index → /brain)
  // stall when `attemptSessionRestore()` is blocked by a DB upgrade or a slow
  // IndexedDB open, leaving the user stranded on the marketing page.
  const initialUser = getCurrentUser();
  const [user, setUser] = useState<UserMeta | null>(initialUser);
  const [isLoading, setIsLoading] = useState(initialUser === null);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const restored = await attemptSessionRestore();
        if (!cancelled) setUser(restored);
      } catch {
        if (!cancelled) setUser(getCurrentUser());
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    // Only run the async restore if we don't already have a user synchronously.
    // Otherwise we'd needlessly block on IndexedDB and risk stalling redirects.
    if (initialUser === null) {
      restore();
    }

    const sync = () => setUser(getCurrentUser());

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "me") sync();
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("user-login", sync);
    window.addEventListener("user-logout", sync);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("user-login", sync);
      window.removeEventListener("user-logout", sync);
    };
  }, []);

  return { user, isLoading };
}

/** Dispatch custom event when user logs in */
export function notifyUserLogin() {
  window.dispatchEvent(new Event("user-login"));
}

/** Dispatch custom event when user logs out */
export function notifyUserLogout() {
  window.dispatchEvent(new Event("user-logout"));
}
