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
  const percent = Math.max(0, Math.min(1, value));
  return `${Math.round(percent * 100)}%`;
}

function formatBandwidth(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) {
    return '0 kbps';
  }
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }
  return `${kbps.toFixed(0)} kbps`;
}

function formatRelativeTime(timestamp: number | null): string {
  if (!Number.isFinite(timestamp ?? NaN) || !timestamp) {
    return 'never';
  }
  const delta = Date.now() - timestamp;
  if (delta < 0) {
    return 'just now';
  }
  if (delta < 60_000) {
    return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  }
  if (delta < 3_600_000) {
    const minutes = Math.floor(delta / 60_000);
    return `${minutes}m ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) {
    const minutes = Math.floor((delta % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m ago`;
  }
  const days = Math.floor(delta / 86_400_000);
  return `${days}d ago`;
}

export function NodeStatusOverview({ snapshot }: NodeStatusOverviewProps) {
  const { status, metrics, peerId, peers } = snapshot;
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Connected peers</p>
          <p className="mt-1 text-lg font-semibold">{peers.connected.length}</p>
          <p className="text-xs text-muted-foreground">Current active mesh links</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Discovered peers</p>
          <p className="mt-1 text-lg font-semibold">{peers.totalDiscovered}</p>
          <p className="text-xs text-muted-foreground">From gossip and rendezvous</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending approvals</p>
          <p className="mt-1 text-lg font-semibold">{peers.pending.length}</p>
          <p className="text-xs text-muted-foreground">Queued by manual accept</p>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bandwidth</p>
          <p className="mt-1 text-lg font-semibold">{formatBandwidth(metrics.bandwidthKbps)}</p>
          <p className="text-xs text-muted-foreground">Average transfer since session start</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Packet loss</p>
          <p className="mt-1 text-lg font-semibold">{formatPercent(metrics.avgPacketLoss)}</p>
          <p className="text-xs text-muted-foreground">Across active peer pings</p>
        </div>
        <div className="rounded-md border border-border/40 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Handshake confidence</p>
          <p className="mt-1 text-lg font-semibold">{formatPercent(metrics.handshakeConfidence)}</p>
          <p className="text-xs text-muted-foreground">Responsive peers acknowledging handshakes</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Alternate transports</h3>
            <p className="text-xs text-muted-foreground">
              Last fallback {formatRelativeTime(snapshot.transports.lastFallbackAt)}.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {snapshot.transports.fallbackTotal} fallbacks
          </Badge>
        </div>
        {snapshot.transports.status.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/40 bg-background/70 p-3 text-xs text-muted-foreground">
            Alternate transports are disabled. Enable WebTorrent or GUN experiments to observe fallback activity.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.transports.status.map((transport) => {
              const badgeVariant = transport.state === 'error'
                ? 'destructive'
                : transport.state === 'degraded'
                  ? 'secondary'
                  : 'outline';
              return (
                <div
                  key={transport.id}
                  className="rounded-md border border-border/40 bg-background/70 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {transport.label}
                    </p>
                    <Badge variant={badgeVariant} className="text-[10px] uppercase">
                      {transport.state}
                    </Badge>
                  </div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Enabled</dt>
                      <dd className="font-medium">{transport.enabled ? 'Yes' : 'No'}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Connected peers</dt>
                      <dd className="font-medium">{transport.connectedPeers}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Fallbacks</dt>
                      <dd className="font-medium">{transport.fallbackCount}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Last fallback</dt>
                      <dd className="font-medium">{formatRelativeTime(transport.lastFallbackAt)}</dd>
                    </div>
                     {transport.lastError && (
                      <div className="pt-1 text-[11px] text-amber-600 dark:text-amber-500">
                        Last error: {transport.lastError}
                        {transport.id === 'peerjs' && transport.lastError === 'timeout' && (
                          <span className="block mt-0.5">Peer connection timeout (signaling OK)</span>
                        )}
                      </div>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
