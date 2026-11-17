import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Repeat } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadUnifiedHistory } from "@/lib/history/loadUnifiedHistory";
import {
  filterHistory,
  historyAssets,
  HISTORY_KIND_LABELS,
  SETTLEMENT_LABELS,
  shortParty,
  type HistoryKind,
  type HistoryLeg,
  type UnifiedHistoryEntry,
} from "@/lib/history/unifiedHistory";

const ALL = "all";
const REFRESH_EVENTS = ["credit-transaction", "blockchain-transaction", "wallet-tip-updated"] as const;

interface UnifiedHistoryProps {
  userId: string;
  /** Start filtered to one asset, e.g. CREDITS. */
  asset?: string;
  /** Hide the asset picker and keep the view on `asset`. */
  lockAsset?: boolean;
  title?: string;
  description?: string;
  limit?: number;
}

function formatAmount(leg: HistoryLeg): string {
  const value = leg.amount.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return `${leg.direction === "in" ? "+" : "−"}${value} ${leg.ticker}`;
}

function EntryIcon({ entry }: { entry: UnifiedHistoryEntry }) {
  if (entry.legs.length > 1) return <Repeat className="h-4 w-4 text-primary mt-0.5 shrink-0" />;
  return entry.legs[0].direction === "in"
    ? <ArrowDownLeft className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
    : <ArrowUpRight className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />;
}

export function UnifiedHistory({
  userId,
  asset: initialAsset,
  lockAsset = false,
  title = "Transaction History",
  description = "Credits and SWARM activity in one place. Each asset keeps its own balance and rules.",
  limit = 200,
}: UnifiedHistoryProps) {
  const [entries, setEntries] = useState<UnifiedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState(initialAsset ?? ALL);
  const [kind, setKind] = useState<HistoryKind | typeof ALL>(ALL);

  const load = useCallback(async () => {
    try {
      setEntries(await loadUnifiedHistory(userId));
    } catch (error) {
      console.error("[UnifiedHistory] Failed to load history:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const refresh = () => void load();
    for (const name of REFRESH_EVENTS) window.addEventListener(name, refresh);
    return () => { for (const name of REFRESH_EVENTS) window.removeEventListener(name, refresh); };
  }, [load]);

  const assets = useMemo(() => historyAssets(entries), [entries]);
  const kinds = useMemo(
    () => (Object.keys(HISTORY_KIND_LABELS) as HistoryKind[]).filter(k => entries.some(e => e.kind === k)),
    [entries],
  );
  const visible = useMemo(
    () => filterHistory(entries, {
      asset: asset === ALL ? undefined : asset,
      kind: kind === ALL ? undefined : kind,
    }).slice(0, limit),
    [entries, asset, kind, limit],
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {!lockAsset && (
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by asset">
                <SelectValue placeholder="All assets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All assets</SelectItem>
                {assets.map(a => <SelectItem key={a.asset} value={a.asset}>{a.ticker}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={kind} onValueChange={v => setKind(v as HistoryKind | typeof ALL)}>
            <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by type">
              <SelectValue placeholder="All activity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All activity</SelectItem>
              {kinds.map(k => <SelectItem key={k} value={k}>{HISTORY_KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No transactions yet</div>
          ) : (
            <ul className="space-y-2">
              {visible.map(entry => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 p-3 border rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <EntryIcon entry={entry} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm leading-tight break-words">{entry.label}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {HISTORY_KIND_LABELS[entry.kind]}
                        </Badge>
                        {[...new Set(entry.legs.map(l => l.settlement))].map(s => (
                          <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                            {SETTLEMENT_LABELS[s]}
                          </Badge>
                        ))}
                        {entry.counterparty && (
                          <span className="text-[10px] text-muted-foreground" title={entry.counterparty}>
                            {entry.legs[0].direction === "in" ? "from" : "to"} {shortParty(entry.counterparty)}
                          </span>
                        )}
                      </div>
                      {entry.note && <p className="text-xs text-muted-foreground mt-1 break-words">{entry.note}</p>}
                      <p className="text-[10px] text-muted-foreground mt-0.5" title={new Date(entry.timestamp).toLocaleString()}>
                        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {entry.legs.map((leg, i) => (
                      <p
                        key={i}
                        className={`font-semibold text-sm tabular-nums ${leg.direction === "in" ? "text-emerald-500" : "text-orange-500"}`}
                      >
                        {formatAmount(leg)}
                      </p>
                    ))}
                    {entry.fee && <p className="text-[10px] text-muted-foreground">Fee: {entry.fee}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
