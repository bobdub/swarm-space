import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';

interface ConnectionHealthPanelProps {
  snapshot: NodeDashboardSnapshot;
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return '—';
  }
  const delta = Date.now() - value;
  if (delta < 1000) {
    return 'moments ago';
  }
  if (delta < 60_000) {
    return `${Math.floor(delta / 1000)}s ago`;
  }
  if (delta < 3_600_000) {
    const mins = Math.floor(delta / 60_000);
    return `${mins}m ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  return `${hours}h ago`;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  healthy: 'default',
  degraded: 'destructive',
  stale: 'secondary',
};

export function ConnectionHealthPanel({ snapshot }: ConnectionHealthPanelProps) {
  const { connectionHealth } = snapshot;

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Connection health</h2>
          <p className="text-sm text-muted-foreground">
            Active peer sessions with their latest activity, RTT, and health state.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          Last handshake {formatTimestamp(connectionHealth.lastHandshakeAt)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Healthy</p>
          <p className="mt-1 text-lg font-semibold">{connectionHealth.summary.healthy}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Degraded</p>
          <p className="mt-1 text-lg font-semibold text-amber-500">{connectionHealth.summary.degraded}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Stale</p>
          <p className="mt-1 text-lg font-semibold">{connectionHealth.summary.stale}</p>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/70">
        <ScrollArea className="h-56">
          <div className="divide-y divide-border/30 text-sm">
            {connectionHealth.connections.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No active peers. Connections will appear here once the mesh links to other nodes.</p>
            ) : (
              connectionHealth.connections.map((connection) => (
                <div key={connection.peerId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{connection.peerId}</p>
                    <p className="text-xs text-muted-foreground">
                      {connection.userId ?? 'Unknown user'} · Last activity {formatTimestamp(connection.lastActivity ?? connection.connectedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-mono">{connection.avgRttMs != null ? `${connection.avgRttMs.toFixed(0)} ms` : '—'}</p>
                      <p className="text-[11px] text-muted-foreground">RTT</p>
                    </div>
                    <Badge variant={STATUS_VARIANTS[connection.status] ?? 'secondary'} className="text-xs capitalize">
                      {connection.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
