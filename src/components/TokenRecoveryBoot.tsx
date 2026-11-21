import { useEffect } from "react";
import { notifySystem } from "@/lib/notifications";
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
          void notifySystem({
            userId: user.id,
            type: "system",
            title: `Creator token ${result.token.ticker} restored.`,
            content: "It was rebuilt from your local chain snapshot.",
            link: "/wallet",
            linkLabel: "Open wallet",
          });
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