import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useP2PContext } from "@/contexts/P2PContext";
import type { P2PDiagnosticLevel, P2PDiagnosticSource } from "@/lib/p2p/diagnostics";
import type { P2PStats } from "@/lib/p2p/manager";

interface StatsRecord {
  snapshot: P2PStats;
  recordedAt: number;
}

const LEVEL_OPTIONS: Array<"all" | P2PDiagnosticLevel> = ["all", "info", "warn", "error"];

export function P2PDebugPanel() {
  const { stats, diagnostics, clearDiagnostics, subscribeToStats, openNodeDashboard } = useP2PContext();
  const [statsHistory, setStatsHistory] = useState<StatsRecord[]>(() => [
    { snapshot: stats, recordedAt: Date.now() },
  ]);
  const [levelFilter, setLevelFilter] = useState<"all" | P2PDiagnosticLevel>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | P2PDiagnosticSource>("all");

  useEffect(() => {
    const unsubscribe = subscribeToStats((next) => {
      setStatsHistory((prev) => {
        const nextHistory = [...prev, { snapshot: next, recordedAt: Date.now() }];
        return nextHistory.slice(-50);
      });
    });
    return unsubscribe;
  }, [subscribeToStats]);

  useEffect(() => {
    setStatsHistory((prev) => {
      if (prev.length === 0) {
        return [{ snapshot: stats, recordedAt: Date.now() }];
      }
      return prev;
    });
  }, [stats]);

  const uniqueSources = useMemo(() => {
    const values = new Set<P2PDiagnosticSource>();
    diagnostics.forEach((event) => values.add(event.source));
    return Array.from(values).sort();
  }, [diagnostics]);

  const filteredDiagnostics = useMemo(() => {
    return diagnostics.filter((event) => {
      if (levelFilter !== "all" && event.level !== levelFilter) {
        return false;
      }
      if (sourceFilter !== "all" && event.source !== sourceFilter) {
        return false;
      }
      return true;
    });
  }, [diagnostics, levelFilter, sourceFilter]);

  const latestFailureRate = stats.connectionAttempts > 0
    ? stats.failedConnectionAttempts / stats.connectionAttempts
    : 0;
  const latestRendezvousRate = stats.rendezvousAttempts > 0
    ? stats.rendezvousSuccesses / stats.rendezvousAttempts
    : 0;
  const historyToRender = useMemo(() => statsHistory.slice(-12).reverse(), [statsHistory]);

  const handleResetHistory = () => {
    setStatsHistory([{ snapshot: stats, recordedAt: Date.now() }]);
  };

  return (
    <Card className="p-4 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-base font-semibold">Mesh Diagnostics</h4>
          <p className="text-xs text-muted-foreground">
            Live telemetry snapshots and the most recent diagnostic events published by the networking stack.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={openNodeDashboard}>
            View node dashboard
          </Button>
          <Button variant="outline" size="sm" onClick={handleResetHistory}>
            Reset history
          </Button>
          <Button variant="ghost" size="sm" onClick={clearDiagnostics}>
            Clear diagnostics
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="space-y-1">
          <span className="text-muted-foreground">Connection attempts</span>
          <span className="text-lg font-semibold">{stats.connectionAttempts}</span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Failed attempts</span>
          <span className={`text-lg font-semibold ${latestFailureRate > 0.4 ? "text-amber-400" : ""}`}>
            {stats.failedConnectionAttempts} ({Math.round(latestFailureRate * 100)}%)
          </span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Rendezvous success</span>
          <span className={`text-lg font-semibold ${latestRendezvousRate < 0.5 && stats.rendezvousAttempts > 0 ? "text-amber-400" : ""}`}>
            {stats.rendezvousSuccesses}/{stats.rendezvousAttempts || 0}
          </span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Beacon latency</span>
          <span className={`text-lg font-semibold ${stats.lastBeaconLatencyMs && stats.lastBeaconLatencyMs > 10_000 ? "text-amber-400" : ""}`}>
            {stats.lastBeaconLatencyMs != null ? `${(stats.lastBeaconLatencyMs / 1000).toFixed(1)}s` : "—"}
          </span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Time to first peer</span>
          <span className="text-lg font-semibold">
            {stats.timeToFirstPeerMs != null ? `${(stats.timeToFirstPeerMs / 1000).toFixed(1)}s` : "—"}
          </span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Relay count</span>
          <span className="text-lg font-semibold">{stats.relayCount}</span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Bytes uploaded</span>
          <span className="text-lg font-semibold">{stats.bytesUploaded.toLocaleString()}</span>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">Bytes downloaded</span>
          <span className="text-lg font-semibold">{stats.bytesDownloaded.toLocaleString()}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-semibold">Telemetry history</h5>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Showing last {historyToRender.length} samples
          </span>
        </div>
        <div className="rounded-md border border-border/40 bg-background/80 max-h-48 overflow-y-auto">
          {historyToRender.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">History empty. Waiting for next stats sample…</p>
          ) : (
            <ul className="divide-y divide-border/30 text-xs">
              {historyToRender.map((record) => {
                const { snapshot } = record;
                const failureRate = snapshot.connectionAttempts > 0
                  ? snapshot.failedConnectionAttempts / snapshot.connectionAttempts
                  : 0;
                const rendezvousRate = snapshot.rendezvousAttempts > 0
                  ? snapshot.rendezvousSuccesses / snapshot.rendezvousAttempts
                  : 0;
                const beaconLatency = snapshot.lastBeaconLatencyMs ?? 0;
                const degraded = failureRate > 0.4 || snapshot.rendezvousFailureStreak > 0 || beaconLatency > 10_000;
                return (
                  <li key={`${record.recordedAt}-${snapshot.connectedPeers}`} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {new Date(record.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {snapshot.status}
                        </Badge>
                        {degraded && (
                          <Badge variant="destructive" className="text-[10px]">Degraded</Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                      <span>Peers: {snapshot.connectedPeers}/{snapshot.discoveredPeers}</span>
                      <span>Failures: {snapshot.failedConnectionAttempts}</span>
                      <span>Rendezvous: {snapshot.rendezvousSuccesses}/{snapshot.rendezvousAttempts}</span>
                      <span>Beacon: {snapshot.lastBeaconLatencyMs != null ? `${(snapshot.lastBeaconLatencyMs / 1000).toFixed(1)}s` : "—"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h5 className="text-sm font-semibold">Diagnostics</h5>
          <div className="flex flex-wrap gap-2">
            <Select value={levelFilter} onValueChange={(value: "all" | P2PDiagnosticLevel) => setLevelFilter(value)}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all" ? "All levels" : option.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sourceFilter}
              onValueChange={(value: "all" | P2PDiagnosticSource) => setSourceFilter(value)}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {uniqueSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/80 max-h-60 overflow-y-auto">
          {filteredDiagnostics.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No diagnostic events match the selected filters.
            </p>
          ) : (
            <ul className="divide-y divide-border/30 text-xs">
              {filteredDiagnostics.map((event) => (
                <li key={event.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={event.level === "error" ? "destructive" : event.level === "warn" ? "secondary" : "outline"}
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {event.level}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-xs">{event.source}</span>
                    <span className="text-[11px] text-muted-foreground">{event.code}</span>
                  </div>
                  <p className="text-[12px] text-foreground/90">{event.message}</p>
                  {event.context && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(event.context, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

