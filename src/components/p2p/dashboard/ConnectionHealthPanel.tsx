import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import { NoPeersEmptyState } from './emptyStates';

interface ConnectionHealthPanelProps {
  snapshot: NodeDashboardSnapshot;
}

function formatTimestamp(value: number | null): string {
  if (!value) return '—';
  const delta = Date.now() - value;
  if (delta < 1000) return 'moments ago';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function speedToColor(speed: number): string {
  if (speed >= 70) return 'text-emerald-400';
  if (speed >= 40) return 'text-amber-400';
  return 'text-orange-400';
}

function trustToColor(trust: number): string {
  if (trust >= 0.8) return 'text-emerald-400';
  if (trust >= 0.5) return 'text-amber-400';
  return 'text-orange-400';
}

export function ConnectionHealthPanel({ snapshot }: ConnectionHealthPanelProps) {
  const { connectionHealth } = snapshot;
  const summary = connectionHealth.summary;

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Connection health</h2>
          <p className="text-sm text-muted-foreground">
            Active peer sessions — light, speed, and trust.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          Last handshake {formatTimestamp(connectionHealth.lastHandshakeAt)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Online Nodes */}
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Online Nodes</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 inline-block" />
            <p className="text-lg font-semibold">{summary.online ?? summary.healthy ?? 0}</p>
            <span className="text-xs text-muted-foreground">/ {summary.total}</span>
          </div>
          <Progress value={summary.total > 0 ? ((summary.online ?? summary.healthy ?? 0) / summary.total) * 100 : 0} aria-hidden="true" />
        </div>

        {/* Avg Speed */}
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Speed</p>
          <p className={`mt-1 text-lg font-semibold ${speedToColor(summary.avgSpeed ?? 0)}`}>
            {summary.avgSpeed ?? 0}
          </p>
          <Progress value={summary.avgSpeed ?? 0} aria-hidden="true" />
          <p className="text-xs text-muted-foreground mt-1">1–100 (inverse RTT)</p>
        </div>

        {/* Avg Trust */}
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Trust</p>
          <p className={`mt-1 text-lg font-semibold ${trustToColor(summary.avgTrust ?? 0)}`}>
            {Math.round((summary.avgTrust ?? 0) * 100)}%
          </p>
          <Progress value={(summary.avgTrust ?? 0) * 100} aria-hidden="true" />
          <p className="text-xs text-muted-foreground mt-1">Pong success ratio</p>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/70">
        <ScrollArea className="h-56">
          <div className="divide-y divide-border/30 text-sm">
            {connectionHealth.connections.length === 0 ? (
              <div className="p-4"><NoPeersEmptyState /></div>
            ) : (
              connectionHealth.connections.map((connection) => {
                const light = (connection as any).light ?? (connection.status === 'healthy');
                const speed = (connection as any).speed ?? (connection.avgRttMs != null ? Math.max(1, Math.min(100, Math.round(100 - Math.min(connection.avgRttMs, 990) / 10))) : 50);
                const trust = (connection as any).trust ?? 1;

                return (
                  <div key={connection.peerId} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${light ? 'bg-emerald-400' : 'bg-foreground/20'}`} />
                        <p className="text-sm font-medium truncate">{connection.peerId}</p>
                      </div>
                      <p className="text-xs text-muted-foreground ml-4">
                        {connection.userId ?? 'Unknown user'} · Last activity {formatTimestamp(connection.lastActivity ?? connection.connectedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className={`text-sm font-mono ${speedToColor(speed)}`}>{speed}</p>
                        <p className="text-[11px] text-muted-foreground">Speed</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-mono ${trustToColor(trust)}`}>{Math.round(trust * 100)}%</p>
                        <p className="text-[11px] text-muted-foreground">Trust</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
