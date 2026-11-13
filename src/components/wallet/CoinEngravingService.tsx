import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isGuestUser } from "@/lib/preview/guestAccess";

/** Quiet app-wide check: navigation never stops a coin's settling window. */
export function CoinEngravingService() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || isGuestUser(user)) return;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        const { ensureEngravingCoin, packLocalContent, sealLocalContent } = await import("@/lib/blockchain/contentPayload");
        if (stopped) return;
        await ensureEngravingCoin(user.id);
        if (stopped) return;
        await packLocalContent(user.id);
        if (!stopped) await sealLocalContent(user.id, "idle");
      } catch (error) { console.warn("[engraving] settling check failed", error); }
      finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, 15_000);
    void check();
    return () => { stopped = true; clearInterval(timer); };
  }, [user?.id]);
  return null;
}