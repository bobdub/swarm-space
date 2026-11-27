import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getStandLedger, type StandLedgerEntry } from "@/lib/world/tradingStand/standLedger";
import { getTradingGood } from "@/lib/world/tradingStand/pricing";
import { TRADING_STAND_EVENT } from "@/lib/world/tradingStand/tradingStandStore";

const KIND_LABEL: Record<StandLedgerEntry["kind"], string> = {
  bought: "Bought",
  sold: "Sold",
  donated: "Stocked",
  "owner-share": "Your 15%",
};

function fmtAmount(e: StandLedgerEntry): string {
  if (!e.currency) return "";
  const n = e.currency === "SWARM" ? e.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : Math.round(e.amount).toLocaleString();
  const sign = e.kind === "sold" || e.kind === "owner-share" ? "+" : "−";
  return `${sign}${n} ${e.currency}`;
}

/**
 * Trading Stand ledger: every stand trade you made, read off the
 * blockchain. Each row says whether it is in a mined block yet.
 */
export function StandLedgerPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<StandLedgerEntry[]>([]);

  useEffect(() => {
    if (!user?.id) { setRows([]); return; }
    let live = true;
    const load = () => { void getStandLedger(user.id).then((r) => { if (live) setRows(r); }).catch(() => {}); };
    load();
    window.addEventListener(TRADING_STAND_EVENT, load);
    window.addEventListener("blockchain-transaction", load);
    const timer = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.removeEventListener(TRADING_STAND_EVENT, load);
      window.removeEventListener("blockchain-transaction", load);
      window.clearInterval(timer);
    };
  }, [user?.id]);

  return (
    <Card className="border-primary/20" data-testid="stand-ledger">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-4 w-4 text-amber-500" />
          Trading Stand Ledger
        </CardTitle>
        <CardDescription>
          Every stand trade you made, read from the blockchain. New trades wait for the next block.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">No Trading Stand trades yet.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              {rows.map((e) => {
                const good = e.good ? getTradingGood(e.good) : undefined;
                return (
                  <div key={e.operationId} data-testid="stand-ledger-row"
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {KIND_LABEL[e.kind]} {e.qty > 0 ? `${e.qty} ` : ""}{good ? `${good.icon} ${good.label}` : ""}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {e.at ? new Date(e.at).toLocaleString() : ""} · {e.standKey}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {fmtAmount(e) && <span className="tabular-nums">{fmtAmount(e)}</span>}
                      <Badge variant={e.mined ? "default" : "outline"} className="text-[10px]">
                        {e.mined ? "Mined" : "Awaiting block"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
