import { useEffect } from "react";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { recoverCreatorTokenFromChain } from "@/lib/blockchain/tokenRecovery";

/**
 * On login, attempt to reconstruct the user's creator token from the local
 * chain if the `profileTokens` row is missing (e.g. after a partial data loss).
 * Idempotent — no toast when nothing was missing.
 */
export function TokenRecoveryBoot() {
  const { user, isReady } = useAuthReady();
  useEffect(() => {
    if (!isReady || !user?.id) return;
    const id = window.setTimeout(async () => {
      try {
        const result = await recoverCreatorTokenFromChain(user.id);
        if (result.status === "recovered" && result.token) {
          toast.success(`Creator token ${result.token.ticker} restored from local chain snapshot`);
        }
      } catch (err) {
        console.warn("[TokenRecoveryBoot] failed:", err);
      }
    }, 2500);
    return () => window.clearTimeout(id);
  }, [isReady, user?.id]);
  return null;
}