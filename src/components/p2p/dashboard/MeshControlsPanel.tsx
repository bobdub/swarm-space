import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import type { P2PControlState } from '@/lib/p2p/manager';

interface MeshControlsPanelProps {
  snapshot: NodeDashboardSnapshot;
  onToggleMesh: (enabled: boolean) => void;
  onRefreshPeers: () => void;
  onControlChange: (key: keyof P2PControlState, value: boolean) => void;
}

export function MeshControlsPanel({
  snapshot,
  onToggleMesh,
  onRefreshPeers,
  onControlChange,
}: MeshControlsPanelProps) {
  const { rendezvous, controls } = snapshot;
  const disabledReason = rendezvous.disabledReason;

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mesh controls</h2>
          <p className="text-sm text-muted-foreground">
            Shape traffic flow, pause rendezvous routing, and trigger peer refreshes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="toggle-mesh"
            checked={rendezvous.enabled}
            onCheckedChange={onToggleMesh}
            aria-label="Toggle rendezvous mesh"
          />
          <label htmlFor="toggle-mesh" className="text-xs text-muted-foreground">
            Rendezvous mesh {rendezvous.enabled ? 'enabled' : 'disabled'}
          </label>
        </div>
      </div>

      {!rendezvous.enabled && (
        <div className="rounded-md border border-border/40 bg-destructive/10 p-3 text-sm text-destructive">
          Mesh routing is offline {disabledReason && `due to ${disabledReason} safeguards`}. Existing peers remain connected.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Auto-connect peers</span>
            <Switch
              checked={controls.autoConnect}
              onCheckedChange={(value) => onControlChange('autoConnect', value)}
              aria-label="Toggle auto-connect"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Manual approval queue</span>
            <Switch
              checked={controls.manualAccept}
              onCheckedChange={(value) => onControlChange('manualAccept', value)}
              aria-label="Toggle manual approval"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Isolate node</span>
            <Switch
              checked={controls.isolate}
              onCheckedChange={(value) => onControlChange('isolate', value)}
              aria-label="Toggle isolation"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Pause network</span>
            <Switch
              checked={controls.paused}
              onCheckedChange={(value) => onControlChange('paused', value)}
              aria-label="Toggle pause"
            />
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/70 p-3 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Mesh health</p>
            <p className="mt-1 text-lg font-semibold">{snapshot.connectionHealth.summary.total} tracked peers</p>
            <p className="text-xs text-muted-foreground">
              {snapshot.connectionHealth.summary.healthy} healthy · {snapshot.connectionHealth.summary.degraded} degraded · {snapshot.connectionHealth.summary.stale} stale
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRefreshPeers}>
              Refresh peers
            </Button>
            {disabledReason && (
              <Badge variant="destructive" className="text-xs">
                {disabledReason}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
