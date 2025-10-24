import { useState, useEffect } from "react";
import { getCurrentUser, UserMeta } from "@/lib/auth";

/**
 * Reactive hook for authentication state
 * Listens to storage events and provides current user
 */
export function useAuth() {
  const [user, setUser] = useState<UserMeta | null>(getCurrentUser());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
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
