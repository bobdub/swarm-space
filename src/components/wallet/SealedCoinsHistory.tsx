import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getSealedCoinHistory, type SealedCoinRecord } from "@/lib/blockchain/sealedCoins";
import { ENGRAVING_MB } from "@/lib/blockchain/engravingTiers";

export function SealedCoinsHistory({ userId }: { userId: string }) {
  const [rows, setRows] = useState<SealedCoinRecord[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getSealedCoinHistory(userId).then((r) => { if (active) setRows(r); }).catch(() => {}); };
    refresh();
    window.addEventListener("coin-engraving-update", refresh);
    window.addEventListener("swarm-coin-minted", refresh);
    return () => { active = false; window.removeEventListener("coin-engraving-update", refresh); window.removeEventListener("swarm-coin-minted", refresh); };
  }, [userId]);
  return (
    <section className="space-y-3 border-b pb-5" aria-label="Sealed coins">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Sealed coins</h3>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sealed coins yet.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.coinId} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono">{r.coinId}</span>
                <Badge variant="secondary" className="capitalize">{r.tier}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums">
                <span>{(r.bytes / ENGRAVING_MB).toFixed(2)} MB · {r.entries} entries</span>
                <span>{r.sealedAt ? new Date(r.sealedAt).toLocaleString() : "—"}</span>
              </div>
              {r.merkleRoot && <p className="mt-1 truncate font-mono text-muted-foreground">{r.merkleRoot}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
