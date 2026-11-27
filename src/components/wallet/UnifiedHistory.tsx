import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadUnifiedHistory } from "@/lib/history/loadUnifiedHistory";
import {
  filterHistory,
  historyAssets,
  HISTORY_KIND_LABELS,
  ledgerRows,
  SETTLEMENT_LABELS,
  type HistoryKind,
  type UnifiedHistoryEntry,
} from "@/lib/history/unifiedHistory";

const ALL = "all";
// A mined block clears Pending tags: the mesh announces it as a pool update or a mined block.
const REFRESH_EVENTS = ["credit-transaction", "blockchain-transaction", "wallet-tip-updated", "reward-pool-update", "swarm-block-mined"] as const;

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

export function UnifiedHistory({
  userId,
  asset: initialAsset,
  lockAsset = false,
  title = "Transaction History",
  description = "One ledger for Credits, SWARM and every other asset. Each asset keeps its own balance and rules.",
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
  const rows = useMemo(
    () => ledgerRows(
      filterHistory(entries, { kind: kind === ALL ? undefined : kind }),
      asset === ALL ? undefined : asset,
    ).slice(0, limit),
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
        {/* A native scroll box, not ScrollArea: Radix's viewport sizes its content to the
            widest row and only scrolls vertically, which cut the columns off on phones. */}
        <div className="max-h-[500px] overflow-auto overscroll-x-contain" data-testid="ledger-scroll">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No transactions yet</div>
          ) : (
            <>
            <p className="mb-2 text-[10px] text-muted-foreground sm:hidden">Swipe the table sideways to see every column.</p>
            <Table className="min-w-[30rem] whitespace-nowrap text-xs sm:text-sm [&_th]:h-10 [&_th]:px-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_td]:p-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Weight-type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.key}
                    title={`${row.detail} · ${SETTLEMENT_LABELS[row.settlement]}${row.pending ? " · Pending: waiting to be mined into a block" : ""}`}>
                    <TableCell className="font-medium">{row.ticker}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {row.action}
                        {row.pending && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-500 border-amber-500/50">
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground" title={new Date(row.timestamp).toLocaleString()}>
                        {formatDistanceToNow(new Date(row.timestamp), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className={row.direction === "Incoming" ? "text-emerald-500" : "text-orange-500"}>
                      {row.direction}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.weight === "Rare" || row.weight === "Legendary" ? "default" : "outline"}
                        className="text-[10px] px-1.5 py-0">
                        {row.weight}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {row.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
