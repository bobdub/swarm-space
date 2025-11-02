import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';

interface NodeStatusOverviewProps {
  snapshot: NodeDashboardSnapshot;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(value * 100)}%`;
}

export function NodeStatusOverview({ snapshot }: NodeStatusOverviewProps) {
  const { status, metrics, peerId, signaling, rendezvous } = snapshot;
  const statusVariant = status === 'online'
    ? 'default'
    : status === 'waiting'
      ? 'secondary'
      : 'outline';

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Node status</h2>
          <p className="text-sm text-muted-foreground">
            Live telemetry from your local swarm node and its signaling endpoint.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant} className="text-xs uppercase tracking-wide">
            {status}
          </Badge>
          {peerId && (
            <span className="text-xs font-mono text-muted-foreground">{peerId}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Uptime</p>
          <p className="mt-1 text-lg font-semibold">{formatDuration(metrics.uptimeMs)}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Data uploaded</p>
          <p className="mt-1 text-lg font-semibold">{formatBytes(metrics.bytesUploaded)}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Data downloaded</p>
          <p className="mt-1 text-lg font-semibold">{formatBytes(metrics.bytesDownloaded)}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Average RTT</p>
          <p className="mt-1 text-lg font-semibold">
            {metrics.avgRttMs > 0 ? `${metrics.avgRttMs.toFixed(0)} ms` : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Signaling endpoint</p>
          <p className="mt-1 text-sm font-medium">
            {signaling.endpointLabel ?? 'Not connected'}
          </p>
          {signaling.endpointUrl && (
            <p className="text-xs text-muted-foreground break-all">{signaling.endpointUrl}</p>
          )}
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Rendezvous peers</p>
          <p className="mt-1 text-lg font-semibold">{rendezvous.peerCount}</p>
          <p className="text-xs text-muted-foreground">
            Success rate {formatPercent(rendezvous.successRate)}
          </p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Failure streak</p>
          <p className={`mt-1 text-lg font-semibold ${rendezvous.failureStreak > 0 ? 'text-amber-500' : ''}`}>
            {rendezvous.failureStreak}
          </p>
          <p className="text-xs text-muted-foreground">
            Last sync {rendezvous.lastSync ? formatDuration(Date.now() - rendezvous.lastSync) + ' ago' : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Relay count</p>
          <p className="mt-1 text-lg font-semibold">{metrics.relayCount}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Ping count</p>
          <p className="mt-1 text-lg font-semibold">{metrics.pingCount}</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Connection failure rate</p>
          <p className="mt-1 text-lg font-semibold">{formatPercent(metrics.failureRate)}</p>
        </div>
      </div>
    </Card>
  );
}
