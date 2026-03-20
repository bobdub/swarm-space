/**
 * useAuthGate — Interaction lockdown for unauthenticated users.
 *
 * Returns a guard function that either runs the callback (if logged in)
 * or shows a prompt directing the user to create an account.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useAuthGate() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const requireAuth = useCallback(
    (action: string, callback?: () => void) => {
      if (user) {
        callback?.();
        return true;
      }

      toast("Create an account to " + action, {
        action: {
          label: "Sign Up",
          onClick: () => navigate("/auth"),
        },
      });
      return false;
    },
    [user, navigate]
  );

  const isLocked = !user;

  return { requireAuth, isLocked, user };
}
