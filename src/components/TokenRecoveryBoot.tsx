import { useEffect } from "react";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { recoverCreatorTokenFromChain } from "@/lib/blockchain/tokenRecovery";

export function TokenRecoveryBoot() {
  const { user, isReady } = useAuthReady();
  useEffect(() => {
    if (!isReady || !user?.id) return;
    let cancelled = false;
    // Run immediately — no delay — so UI queries see the restored token.
    (async () => {
      try {
        const result = await recoverCreatorTokenFromChain(user.id);
        if (cancelled) return;
        if (result.status === "recovered" && result.token) {
          toast.success(`Creator token ${result.token.ticker} restored from local chain snapshot`);
          window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { source: "recovery" } }));
        }
      } catch (err) {
        console.warn("[TokenRecoveryBoot] failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [isReady, user?.id]);
  return null;
}