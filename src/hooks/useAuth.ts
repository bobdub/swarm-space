import { useState, useEffect } from "react";
import { getCurrentUser, attemptSessionRestore, UserMeta } from "@/lib/auth";

/**
 * Reactive hook for authentication state.
 * On mount, attempts to restore a session from IndexedDB if localStorage
 * was wiped (cache clear, Brave Shields, browser restart, etc.).
 * Listens to storage + custom events for cross-tab / in-tab reactivity.
 */
export function useAuth() {
  const [user, setUser] = useState<UserMeta | null>(getCurrentUser());
  const [isLoading, setIsLoading] = useState(true);

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

    restore();

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
