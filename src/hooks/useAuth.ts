import { useState, useEffect } from "react";
import { getCurrentUser, getStoredAccounts, restoreLocalAccount, UserMeta } from "@/lib/auth";

/**
 * Reactive hook for authentication state
 * Listens to storage events and provides current user
 */
export function useAuth() {
  const [user, setUser] = useState<UserMeta | null>(getCurrentUser());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const attemptAutoRestore = async () => {
      try {
        // If localStorage already has an active user, we're done.
        const current = getCurrentUser();
        if (current) {
          if (!cancelled) setUser(current);
          return;
        }

        // If localStorage was cleared but IndexedDB still has identities,
        // auto-restore ONLY when there is exactly one choice.
        const accounts = await getStoredAccounts();
        if (accounts.length === 1) {
          await restoreLocalAccount(accounts[0].id);
        }

        if (!cancelled) {
          setUser(getCurrentUser());
        }
      } catch {
        if (!cancelled) {
          setUser(getCurrentUser());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    attemptAutoRestore();

    // Listen for storage changes (login/logout from other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "me") {
        setUser(getCurrentUser());
      }
    };

    // Listen for custom login events
    const handleLoginEvent = () => {
      setUser(getCurrentUser());
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("user-login", handleLoginEvent);
    window.addEventListener("user-logout", handleLoginEvent);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("user-login", handleLoginEvent);
      window.removeEventListener("user-logout", handleLoginEvent);
    };
  }, []);

  return { user, isLoading };
}

/**
 * Dispatch custom event when user logs in
 */
export function notifyUserLogin() {
  window.dispatchEvent(new Event("user-login"));
}

/**
 * Dispatch custom event when user logs out
 */
export function notifyUserLogout() {
  window.dispatchEvent(new Event("user-logout"));
}
