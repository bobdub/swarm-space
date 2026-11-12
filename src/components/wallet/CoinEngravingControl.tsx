import { useEffect, useState } from "react";
import { Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { SwarmCoin } from "@/lib/blockchain/types";
import { getCurrentEngraving, sealLocalContent } from "@/lib/blockchain/contentPayload";
import { canSealEngraving, engravingTier, ENGRAVING_CAPACITY_BYTES, ENGRAVING_MB } from "@/lib/blockchain/engravingTiers";

export function CoinEngravingControl({ userId }: { userId: string }) {
  const [coin, setCoin] = useState<SwarmCoin | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getCurrentEngraving(userId).then((next) => {
      if (active) setCoin(next);
    }).catch(() => { if (active) setCoin(null); }); };
    refresh();
    window.addEventListener("coin-engraving-update", refresh);
    window.addEventListener("swarm-coin-minted", refresh);
    const timer = setInterval(refresh, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("coin-engraving-update", refresh);
      window.removeEventListener("swarm-coin-minted", refresh);
    };
  }, [userId]);
  const bytes = coin?.sealBytes ?? 0;
  const load = Math.min(100, bytes / ENGRAVING_CAPACITY_BYTES * 100);
  const seal = async () => {
    if (!coin || busy) return;
    setBusy(true);
    try {
      const sealed = await sealLocalContent(userId, "manual", coin.coinId);
      if (sealed) toast.success("Coin sealed");
      else toast.error("Coin is no longer available to seal");
      setCoin(await getCurrentEngraving(userId));
    } catch { toast.error("Could not seal coin"); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 border-b pb-5" aria-label="Coin engraving">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stamp className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Coin engraving</h3>
          {bytes > 0 && <Badge variant="outline" className="capitalize">{engravingTier(bytes)}</Badge>}
        </div>
        <Button size="sm" onClick={seal} disabled={busy || !coin || !canSealEngraving(coin, "manual")}
          title="Seal from 1 MB">
          <Stamp className="mr-2 h-4 w-4" />{busy ? "Sealing…" : "Seal coin"}
        </Button>
      </div>
      <div className="flex justify-between gap-2 text-sm tabular-nums">
        <span className="text-muted-foreground">Current load</span><span>{load.toFixed(2)}%</span>
      </div>
      <Progress value={load} aria-label="Current coin load" />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{(bytes / ENGRAVING_MB).toFixed(2)} MB / 1 GiB</span>
        <span>{coin ? "Minimum seal: 1 MB" : "No open coin"}</span>
      </div>
    </section>
  );
}