import { useEffect, useState } from "react";
import { getCreatorMarketRate } from "@/lib/blockchain/marketVault";

/** Keep the last quote during refresh; only creator-market events change its rate. */
export function useCreatorMarketRate(tokenId: string): number {
  const [snapshot, setSnapshot] = useState<{ tokenId: string; rate: number } | null>(null);
  useEffect(() => {
    if (!tokenId) return;
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const current = ++revision;
      try {
        const rate = await getCreatorMarketRate(tokenId);
        if (!disposed && current === revision) {
          setSnapshot((previous) => previous?.tokenId === tokenId && previous.rate === rate
            ? previous : { tokenId, rate });
        }
      } catch {
        if (!disposed && current === revision) setSnapshot({ tokenId, rate: 0 });
      }
    };
    const onMarketUpdate = (event: Event) => {
      const changedId = (event as CustomEvent<{ tokenId?: string }>).detail?.tokenId;
      if (changedId && changedId !== tokenId) return;
      ++revision;
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 250);
    };
    void refresh();
    window.addEventListener("creator-vault-update", onMarketUpdate);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("creator-vault-update", onMarketUpdate);
    };
  }, [tokenId]);
  return snapshot?.tokenId === tokenId ? snapshot.rate : 0;
}