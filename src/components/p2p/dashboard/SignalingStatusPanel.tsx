import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';

function formatLatency(latencyMs: number | null): string {
  if (latencyMs == null) {
    return '—';
  }
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(1)}s`;
  }
  return `${latencyMs.toFixed(0)} ms`;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) {
    return '—';
  }
  const delta = Date.now() - ms;
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

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

interface SignalingStatusPanelProps {
  snapshot: NodeDashboardSnapshot;
}

export function SignalingStatusPanel({ snapshot }: SignalingStatusPanelProps) {
  const { signaling, rendezvous, metrics } = snapshot;
  const rendezvousBadgeVariant = rendezvous.enabled ? 'default' : 'secondary';

  return (
    <Card className="space-y-4 border-primary/30 bg-background/60 p-5 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Signaling status</h2>
          <p className="text-sm text-muted-foreground">
            Signaling server connection and rendezvous mesh discovery status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={signaling.endpointLabel ? 'default' : 'secondary'} className="text-xs uppercase tracking-wide">
            {signaling.endpointLabel ? 'Connected' : 'Offline'}
          </Badge>
          <Badge variant={rendezvousBadgeVariant} className="text-xs uppercase tracking-wide">
            {rendezvous.enabled ? 'Mesh on' : 'Mesh off'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Primary signaling endpoint</p>
          <p className="mt-1 text-sm font-medium">{signaling.endpointLabel ?? 'Not connected'}</p>
          {signaling.endpointUrl && (
            <p className="text-xs text-muted-foreground break-all">{signaling.endpointUrl}</p>
          )}
          {signaling.endpointId && (
            <p className="mt-2 text-[11px] text-muted-foreground">ID: {signaling.endpointId}</p>
          )}
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Beacon latency</p>
          <p className={`mt-1 text-lg font-semibold ${metrics.lastBeaconLatencyMs && metrics.lastBeaconLatencyMs > 10_000 ? 'text-amber-500' : ''}`}>
            {formatLatency(metrics.lastBeaconLatencyMs)}
          </p>
          <p className="text-xs text-muted-foreground">Measured from the latest rendezvous sync</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Rendezvous success</p>
          <p className="mt-1 text-lg font-semibold">{formatPercent(rendezvous.successRate)}</p>
          <p className="text-xs text-muted-foreground">{rendezvous.peerCount} peers · Failure streak {rendezvous.failureStreak}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last rendezvous sync</p>
          <p className="mt-1 text-lg font-semibold">{formatDuration(rendezvous.lastSync)}</p>
          <p className="text-xs text-muted-foreground">Time to first peer {metrics.timeToFirstPeerMs != null ? `${(metrics.timeToFirstPeerMs / 1000).toFixed(1)}s` : '—'}</p>
        </div>
      </div>
    </Card>
  );
}
